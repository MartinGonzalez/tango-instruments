import {
  defineBackend,
  type InstrumentBackendContext,
} from "tango-api/backend";
import { DiaryStore, computeRawHash } from "./lib/diary-store.ts";
import { ActivityCollector } from "./lib/activity-collector.ts";
import { todayDateKey, formatDateDisplay } from "./lib/date-utils.ts";
import type { DiaryActivity, ActivityCategory, DiaryDateInfo, ProjectTask, DiarySummary } from "./types.ts";
import { debugLog, getDebugEntries, clearDebugEntries } from "./lib/debug-log.ts";

let store: DiaryStore | null = null;
let collector: ActivityCollector | null = null;
let startGeneration = 0;

// Nonce guard: prevents stale generations from emitting events after a newer one started
const generationNonce = new Map<string, number>();

const SUMMARY_PROMPT = `You are a diary summarizer for a developer's daily standup.

Given activities grouped by project, produce a JSON object with EXACTLY two top-level keys: "tldr" and "projects". No other top-level keys.

<output_format>
{
  "tldr": [
    "**Task name** — One-liner summary of what was done.",
    "**Another task** — Another one-liner summary."
  ],
  "projects": {
    "ProjectA": [
      { "name": "Task name", "sessionIds": ["sid1"], "description": "2-4 sentence summary." }
    ]
  }
}
</output_format>

<rules_for_tldr>
- This is a markdown bullet list grouped by project, with nested action points
- Top-level bullets are project names in bold: "**ProjectName**"
- Nested bullets are concise action points (past tense, under 100 chars each)
- Focus on what was shipped/done, not process details
- These are for copy-pasting into daily standup messages
- Example:
  ["**Tango App**", "  - Implemented task lifecycle API for backends", "  - Released v0.0.2-rc69", "**Diaries**", "  - Fixed backend suspension with keep-alive mode"]
</rules_for_tldr>

<rules_for_projects>
- CONSOLIDATE aggressively. Research, implementation, debugging, testing, and releasing for the same feature are ONE task, not separate ones.
- A developer typically works on 1-3 goals per project per day. Output 1-3 tasks per project unless the work is genuinely unrelated.
- "name": short goal title (3-8 words)
- "sessionIds": array of ALL session ID strings (from [sid:xxx] tags) across all sessions that contributed
- "description": 2-4 sentence prose summary in past tense, first person. Cover the full arc: what was investigated, what was built, what was shipped. Be specific about file names, tools, features.
- NEVER include raw prompts, questions, or AI responses in descriptions
- NEVER include session IDs or metadata in descriptions — only in the sessionIds field
</rules_for_projects>

Return ONLY the JSON object, no markdown fences, no preamble.

{{PROJECT_SECTIONS}}`;

async function onStart(ctx: InstrumentBackendContext): Promise<void> {
  debugLog("backend", "onStart", "Backend starting...");

  // Guard against double-start: clean up previous instance if onStop wasn't called
  if (collector) {
    debugLog("backend", "onStart", "Previous collector still active — stopping it first");
    collector.stop();
    collector = null;
  }

  const gen = ++startGeneration;
  store = new DiaryStore(ctx.host.storage);
  collector = new ActivityCollector(ctx, store);
  collector.start();
  debugLog("backend", "onStart", `Backend started OK (gen=${gen})`);
}

async function onStop(): Promise<void> {
  const gen = startGeneration;
  debugLog("backend", "onStop", `Backend stopping (gen=${gen})...`);
  if (collector) {
    collector.stop();
    collector = null;
  }
  // Only null store if this onStop belongs to the current generation
  // Prevents a stale onStop from wiping a newer onStart's store
  if (gen === startGeneration) {
    store = null;
  }
}

async function doGenerateSummary(
  ctx: InstrumentBackendContext,
  diaryStore: DiaryStore,
  date: string,
  raw: Awaited<ReturnType<DiaryStore["readRaw"]>> & {},
  nonce: number,
): Promise<void> {
  const allActivities = Object.values(raw.sections).flatMap((s) => s.activities);

  // Group by project
  const byProject = new Map<string, typeof allActivities>();
  for (const activity of allActivities) {
    const project = String(activity.metadata?.project ?? "Unknown");
    const existing = byProject.get(project) ?? [];
    existing.push(activity);
    byProject.set(project, existing);
  }

  // Collect manual notes from the existing summary so they survive regeneration
  const existingSummary = await diaryStore.readSummary(date);
  const manualTasksByProject = new Map<string, ProjectTask[]>();
  if (existingSummary?.projectTasks) {
    for (const [proj, tasks] of Object.entries(existingSummary.projectTasks)) {
      const manualTasks = tasks.filter((t) => t.manual);
      if (manualTasks.length > 0) {
        manualTasksByProject.set(proj, manualTasks);
      }
    }
  }

  // Build a single prompt with all projects
  const projectSections = [...byProject.entries()].map(([project, activities]) => {
    const contextEntries = activities.map((a) => {
      const sid = String(a.metadata?.sessionId ?? "").slice(0, 8);
      const tag = sid ? `[sid:${sid}] ` : "";
      if (a.source === "session") {
        const intent = String(a.title || "").slice(0, 300);
        const outcome = String(a.description || "").slice(0, 300);
        return `${tag}Intent: ${intent}\nOutcome: ${outcome}`;
      }
      return `${tag}[${a.category}] ${a.title}: ${a.description}`;
    }).join("\n\n");
    return `<project name="${project}">\n${contextEntries}\n</project>`;
  }).join("\n\n");

  let projectTasks: Record<string, ProjectTask[]> = {};
  let tldr: string[] = [];
  const markdownSections: string[] = [];

  try {
    const result = await ctx.host.sessions.query({
      prompt: SUMMARY_PROMPT.replace("{{PROJECT_SECTIONS}}", projectSections),
      model: "claude-haiku-4-5-20251001",
      tools: [],
    });

    const text = result.text.trim();
    const jsonStr = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    const parsed = JSON.parse(jsonStr);

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("Expected object with tldr and projects keys");
    }

    // Parse tldr
    if (Array.isArray(parsed.tldr)) {
      tldr = parsed.tldr.map(String);
    }

    // Parse projects (new format) or fall back to old flat format
    const projects = parsed.projects ?? parsed;
    for (const [key, tasks] of Object.entries(projects)) {
      if (key === "tldr") continue;
      if (!Array.isArray(tasks)) continue;
      projectTasks[key] = (tasks as { name?: string; sessionIds?: string[]; description?: string }[]).map((t) => ({
        name: String(t.name ?? "Untitled"),
        sessionIds: Array.isArray(t.sessionIds) ? t.sessionIds.map(String) : [],
        description: String(t.description ?? ""),
      }));
    }
  } catch {
    // Fallback: simple concatenation per project
    for (const [project, activities] of byProject) {
      const sessionIds = [...new Set(
        activities
          .map((a) => String(a.metadata?.sessionId ?? "").slice(0, 8))
          .filter(Boolean)
      )];
      projectTasks[project] = [{
        name: project,
        sessionIds,
        description: activities.map((a) => a.title).join(". "),
      }];
    }
  }

  for (const [project, tasks] of Object.entries(projectTasks)) {
    const taskMarkdown = tasks
      .map((t) => `### ${t.name}\n${t.description}`)
      .join("\n\n");
    markdownSections.push(`## ${project}\n${taskMarkdown}`);
  }

  // Merge manual tasks back into projectTasks and tldr
  for (const [proj, manualTasks] of manualTasksByProject) {
    if (!projectTasks[proj]) {
      projectTasks[proj] = [];
    }
    projectTasks[proj].push(...manualTasks);

    // Append manual notes to tldr
    const manualLines = manualTasks.map((t) => `  - ${t.description}`);
    if (manualLines.length > 0) {
      // Find if this project already has a header in tldr
      const headerIdx = tldr.findIndex((l) => l.includes(`**${proj}**`));
      if (headerIdx !== -1) {
        // Insert after last nested item for this project
        let insertAt = headerIdx + 1;
        while (insertAt < tldr.length && tldr[insertAt].startsWith("  ")) {
          insertAt++;
        }
        tldr.splice(insertAt, 0, ...manualLines);
      } else {
        // Add new project group
        tldr.push(`**${proj}**`, ...manualLines);
      }
    }
  }

  // Re-read raw to get current hash (activities may have arrived during Haiku calls)
  const currentRaw = await diaryStore.readRaw(date) ?? raw;
  const summary: DiarySummary = {
    date,
    generatedAt: new Date().toISOString(),
    rawHash: computeRawHash(currentRaw),
    dailySummary: markdownSections.join("\n\n"),
    tldr,
    projectTasks,
  };
  await diaryStore.writeSummary(summary);

  // Only emit completion if this is still the latest generation for this date
  if (generationNonce.get(date) !== nonce) {
    debugLog("backend", "regenerateSummary", `Stale generation for ${date} (nonce ${nonce} != ${generationNonce.get(date)}), skipping emit`);
    return;
  }

  ctx.emit({ event: "diary.generated", payload: { date } });
  debugLog("backend", "regenerateSummary", `Summary generated for ${date}`);
}

export default defineBackend({
  kind: "tango.instrument.backend.v2",
  onStart,
  onStop,
  actions: {
    getDiary: {
      input: {
        type: "object",
        properties: {
          date: { type: "string" },
        },
      },
      output: {
        type: "object",
        properties: {
          diary: {},
        },
      },
      handler: async (_ctx, input?: { date?: string }) => {
        if (!store) return { diary: null };
        const date = input?.date ?? todayDateKey();
        const diary = await store.readDiary(date);
        return { diary };
      },
    },

    listDiaryDates: {
      input: { type: "object", properties: {} },
      output: {
        type: "object",
        properties: {
          dates: { type: "array" },
        },
      },
      handler: async () => {
        if (!store) return { dates: [] };
        const dates = await store.listDiaryDates();
        const infos: DiaryDateInfo[] = [];

        for (const date of dates) {
          const diary = await store.readDiary(date);
          const activityCount = diary
            ? Object.values(diary.sections).reduce(
                (sum, s) => sum + s.activities.length,
                0
              )
            : 0;
          infos.push({
            date,
            displayDate: formatDateDisplay(date),
            activityCount,
            hasSummary: !!diary?.dailySummary,
          });
        }

        return { dates: infos };
      },
    },

    regenerateSummary: {
      input: {
        type: "object",
        properties: {
          date: { type: "string" },
        },
      },
      output: {
        type: "object",
        properties: {
          success: { type: "boolean" },
        },
      },
      handler: async (ctx, input?: { date?: string }) => {
        if (!store) return { success: false };
        const date = input?.date ?? todayDateKey();

        // Read raw data (separate file, no lock needed)
        const raw = await store.readRaw(date);
        if (!raw) return { success: false };

        const allActivities = Object.values(raw.sections).flatMap((s) => s.activities);
        if (allActivities.length === 0) return { success: false };

        // Increment nonce for this date — any in-flight generation for this date becomes stale
        const nonce = (generationNonce.get(date) ?? 0) + 1;
        generationNonce.set(date, nonce);

        // Signal frontend that generation started
        ctx.emit({ event: "diary.generating", payload: { date } });

        // Fire-and-forget: run generation in background
        doGenerateSummary(ctx, store, date, raw, nonce).catch((err) => {
          debugLog("backend", "regenerateSummary-error", String(err));
          // Only emit error if this generation is still the latest for this date
          if (generationNonce.get(date) === nonce) {
            ctx.emit({ event: "diary.generateError", payload: { date, error: String(err) } });
          }
        });

        return { success: true };
      },
    },

    deleteTaskCard: {
      input: {
        type: "object",
        properties: {
          date: { type: "string" },
          project: { type: "string" },
          sessionIds: { type: "array" },
        },
        required: ["date", "project", "sessionIds"],
      },
      output: {
        type: "object",
        properties: {
          success: { type: "boolean" },
        },
      },
      handler: async (_ctx, input?: { date?: string; project?: string; sessionIds?: string[] }) => {
        if (!store || !input?.date || !input?.project || !input?.sessionIds) return { success: false };

        const summary = await store.readSummary(input.date);
        if (!summary?.projectTasks?.[input.project]) return { success: false };

        const key = [...input.sessionIds].sort().join(",");
        summary.projectTasks[input.project] = summary.projectTasks[input.project].filter((t) => {
          const taskKey = [...t.sessionIds].sort().join(",");
          return taskKey !== key;
        });

        if (summary.projectTasks[input.project].length === 0) {
          delete summary.projectTasks[input.project];
        }

        await store.writeSummary(summary);
        return { success: true };
      },
    },

    deleteTask: {
      input: {
        type: "object",
        properties: {
          date: { type: "string" },
          project: { type: "string" },
          taskName: { type: "string" },
        },
        required: ["date", "project", "taskName"],
      },
      output: {
        type: "object",
        properties: {
          success: { type: "boolean" },
        },
      },
      handler: async (_ctx, input?: { date?: string; project?: string; taskName?: string }) => {
        if (!store || !input?.date || !input?.project || !input?.taskName) return { success: false };

        const summary = await store.readSummary(input.date);
        if (!summary?.projectTasks?.[input.project]) return { success: false };

        summary.projectTasks[input.project] = summary.projectTasks[input.project].filter(
          (t) => t.name !== input!.taskName
        );

        if (summary.projectTasks[input.project].length === 0) {
          delete summary.projectTasks[input.project];
        }

        await store.writeSummary(summary);
        return { success: true };
      },
    },

    addNote: {
      input: {
        type: "object",
        properties: {
          date: { type: "string" },
          project: { type: "string" },
          description: { type: "string" },
        },
        required: ["project", "description"],
      },
      output: {
        type: "object",
        properties: {
          success: { type: "boolean" },
        },
      },
      handler: async (_ctx, input?: { date?: string; project?: string; description?: string }) => {
        if (!store || !input?.project || !input?.description) return { success: false };
        const date = input.date ?? todayDateKey();

        let summary = await store.readSummary(date);
        if (!summary) {
          const raw = await store.readRaw(date);
          summary = {
            date,
            generatedAt: new Date().toISOString(),
            rawHash: raw ? computeRawHash(raw) : "",
            dailySummary: "",
            tldr: [],
            projectTasks: {},
          };
        }

        const task: ProjectTask = {
          name: input.description.slice(0, 60),
          sessionIds: [],
          description: input.description,
          manual: true,
        };

        if (!summary.projectTasks[input.project]) {
          summary.projectTasks[input.project] = [];
        }
        summary.projectTasks[input.project].push(task);

        await store.writeSummary(summary);
        return { success: true };
      },
    },

    improveNote: {
      input: {
        type: "object",
        properties: {
          description: { type: "string" },
        },
        required: ["description"],
      },
      output: {
        type: "object",
        properties: {
          improved: { type: "string" },
        },
      },
      handler: async (ctx, input?: { description?: string }) => {
        if (!input?.description) return { improved: "" };

        const result = await ctx.host.sessions.query({
          prompt: `You are a concise writing assistant for a developer's daily diary.

Improve the following note: make it clearer, more professional, and well-structured. Keep the same meaning and intent. Use past tense, first person. Be specific and concise (2-4 sentences max). Return ONLY the improved text, no preamble, no quotes.

Note:
${input.description}`,
          model: "claude-haiku-4-5-20251001",
          tools: [],
        });

        const improved = (result as { text?: string }).text?.trim() ?? "";
        return { improved: improved || input.description };
      },
    },

    deleteDiary: {
      input: {
        type: "object",
        properties: {
          date: { type: "string" },
        },
        required: ["date"],
      },
      output: {
        type: "object",
        properties: {
          success: { type: "boolean" },
        },
      },
      handler: async (_ctx, input?: { date?: string }) => {
        if (!store || !input?.date) return { success: false };
        try {
          await store.deleteDiary(input.date);
          return { success: true };
        } catch {
          return { success: false };
        }
      },
    },

    getDebugLog: {
      input: { type: "object", properties: {} },
      output: {
        type: "object",
        properties: {
          entries: { type: "array" },
        },
      },
      handler: async () => {
        return { entries: getDebugEntries() };
      },
    },

    clearDebugLog: {
      input: { type: "object", properties: {} },
      output: {
        type: "object",
        properties: { ok: { type: "boolean" } },
      },
      handler: async () => {
        clearDebugEntries();
        return { ok: true };
      },
    },

    testEmit: {
      input: { type: "object", properties: {} },
      output: {
        type: "object",
        properties: { ok: { type: "boolean" } },
      },
      handler: async (ctx) => {
        debugLog("backend", "testEmit", "Emitting test event...");
        ctx.emit({
          event: "diary.test",
          payload: { message: "Hello from diaries backend", ts: Date.now() },
        });
        debugLog("backend", "testEmit", "Test event emitted");
        return { ok: true };
      },
    },

    recordManualActivity: {
      input: {
        type: "object",
        properties: {
          category: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
        },
        required: ["title"],
      },
      output: {
        type: "object",
        properties: {
          success: { type: "boolean" },
        },
      },
      handler: async (_ctx, input?: { category?: string; title?: string; description?: string }) => {
        if (!store || !input?.title) return { success: false };

        const activity: DiaryActivity = {
          id: `manual-${Date.now()}`,
          timestamp: new Date().toISOString(),
          source: "manual",
          category: (input.category as ActivityCategory) ?? "general",
          title: input.title,
          description: input.description ?? "",
          metadata: {},
        };

        await store.addActivity(todayDateKey(), activity);
        return { success: true };
      },
    },
  },
});
