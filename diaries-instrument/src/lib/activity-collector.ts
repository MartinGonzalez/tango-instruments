import type { InstrumentBackendContext } from "tango-api/backend";
import type { DiaryActivity } from "../types.ts";
import { DiaryStore } from "./diary-store.ts";
import { todayDateKey } from "./date-utils.ts";
import { debugLog } from "./debug-log.ts";

type SessionTracker = {
  sessionId: string;
  cwd: string | null;
  project: string;
  transcriptPath: string;
  lastUserPrompt: string;
  interactionCount: number;
};

export class ActivityCollector {
  #ctx: InstrumentBackendContext;
  #store: DiaryStore;
  #sessions = new Map<string, SessionTracker>();
  #unsubscribers: Array<() => void> = [];

  constructor(ctx: InstrumentBackendContext, store: DiaryStore) {
    this.#ctx = ctx;
    this.#store = store;
  }

  start(): void {
    debugLog("collector", "lifecycle", "ActivityCollector.start() called");

    // Seed trackers for sessions that were already running before the instrument started
    void this.#seedExistingSessions();

    this.#unsubscribers.push(
      this.#ctx.host.events.subscribe("session.stream", (payload) => {
        void this.#handleSessionStream(payload);
      })
    );
    debugLog("collector", "subscribe", "Subscribed to session.stream");

    this.#unsubscribers.push(
      this.#ctx.host.events.subscribe("session.idResolved", (payload) => {
        this.#handleSessionIdResolved(payload);
      })
    );
    debugLog("collector", "subscribe", "Subscribed to session.idResolved");

    this.#unsubscribers.push(
      this.#ctx.host.events.subscribe("instrument.event", (payload) => {
        void this.#handleInstrumentEvent(payload);
      })
    );
    debugLog("collector", "subscribe", "Subscribed to instrument.event");

    // Debug: subscribe to snapshot.update to verify events work at all
    this.#unsubscribers.push(
      this.#ctx.host.events.subscribe("snapshot.update", (payload: any) => {
        const taskCount = payload?.tasks?.length ?? 0;
        const processCount = payload?.processes?.length ?? 0;
        debugLog("snapshot.update", "received", `tasks=${taskCount} processes=${processCount}`);
      })
    );
    debugLog("collector", "subscribe", "Subscribed to snapshot.update");

    // Debug: subscribe to session.ended too
    this.#unsubscribers.push(
      this.#ctx.host.events.subscribe("session.ended", (payload: any) => {
        debugLog("session.ended", "received", `sid=${payload?.sessionId} exit=${payload?.exitCode}`);
      })
    );
    debugLog("collector", "subscribe", "Subscribed to session.ended");
  }

  stop(): void {
    debugLog("collector", "lifecycle", "ActivityCollector.stop() called");
    for (const unsub of this.#unsubscribers) {
      unsub();
    }
    this.#unsubscribers = [];
    this.#sessions.clear();
  }

  async #seedExistingSessions(): Promise<void> {
    try {
      const sessions = await this.#ctx.host.sessions.list();
      for (const s of sessions) {
        if (this.#sessions.has(s.sessionId)) continue;
        const project = extractProjectName(s.cwd ?? null);
        this.#sessions.set(s.sessionId, {
          sessionId: s.sessionId,
          cwd: s.cwd ?? null,
          project,
          transcriptPath: s.transcriptPath ?? "",
          lastUserPrompt: "",
          interactionCount: 0,
        });
        debugLog("collector", "seed", `sid=${s.sessionId.slice(0, 12)}… project=${project} cwd=${s.cwd}`);
      }
      debugLog("collector", "seed", `Seeded ${sessions.length} existing sessions`);
    } catch (err) {
      debugLog("collector", "seed-error", String(err));
    }
  }

  async #handleSessionStream(payload: {
    sessionId: string;
    event: Record<string, unknown>;
  }): Promise<void> {
    const { sessionId, event } = payload;
    const eventType = `${event.type ?? "?"}/${event.subtype ?? ""}`;

    debugLog(
      "session.stream",
      eventType,
      `sid=${sessionId.slice(0, 12)}… keys=${Object.keys(event).join(",")}`
    );

    // Session starts — register tracker
    if (event.type === "system" && event.subtype === "init") {
      const cwd = (event.cwd as string) ?? null;
      const project = extractProjectName(cwd);
      this.#sessions.set(sessionId, {
        sessionId,
        cwd,
        project,
        transcriptPath: "",
        lastUserPrompt: "",
        interactionCount: 0,
      });
      debugLog("session.stream", "init-tracked", `project=${project} cwd=${cwd}`);
      return;
    }

    let tracker = this.#sessions.get(sessionId);

    // Extract cwd from the event if present (synthetic hook events carry it)
    const eventCwd = (event.cwd as string) || null;

    // If we missed the init event, look up session info and create tracker
    if (!tracker) {
      let cwd: string | null = eventCwd;
      if (!cwd) {
        try {
          const sessions = await this.#ctx.host.sessions.list();
          const match = sessions.find((s) => s.sessionId === sessionId);
          if (match?.cwd) cwd = match.cwd;
        } catch { /* fallback to Unknown */ }
      }

      const project = extractProjectName(cwd);
      tracker = {
        sessionId,
        cwd,
        project,
        transcriptPath: "",
        lastUserPrompt: "",
        interactionCount: 0,
      };
      this.#sessions.set(sessionId, tracker);
      debugLog("session.stream", "tracker-created-late", `sid=${sessionId.slice(0, 12)}… project=${project} cwd=${cwd}`);
    }

    // Backfill cwd/project if tracker was created without it
    if (eventCwd && (!tracker.cwd || tracker.project === "Unknown")) {
      tracker.cwd = eventCwd;
      const newProject = extractProjectName(eventCwd);
      if (tracker.project === "Unknown" && newProject !== "Unknown") {
        tracker.project = newProject;
        void this.#store.updateActivityProject(todayDateKey(), sessionId, newProject, eventCwd);
      }
    }

    // User prompt — capture what they asked
    if (event.type === "user") {
      const message = event.message as {
        content?: Array<Record<string, unknown>>;
      };
      const blocks = message?.content;
      if (Array.isArray(blocks)) {
        const text = blocks
          .filter((b) => b?.type === "text")
          .map((b) => String(b.text ?? ""))
          .join("\n")
          .trim();
        if (text) {
          tracker.lastUserPrompt = text;
          debugLog("session.stream", "user-prompt", text.slice(0, 100));
        }
      }
      return;
    }

    // Result — interaction complete, record activity
    if (event.type === "result") {
      tracker.interactionCount++;
      const resultText = String(event.result ?? "").trim();
      const prompt = tracker.lastUserPrompt;

      debugLog("session.stream", "result", `prompt="${prompt.slice(0, 60)}" result="${resultText.slice(0, 60)}"`);

      if (!prompt && !resultText) {
        debugLog("session.stream", "result-skipped", "Both prompt and result empty");
        return;
      }

      const truncatedPrompt = prompt.slice(0, 500);
      const truncatedResult = resultText.slice(0, 500);

      // Use timestamp in ID to avoid collisions after collector restarts
      // (interactionCount resets to 0 on restart, which would overwrite old activities)
      const activity: DiaryActivity = {
        id: `interaction-${sessionId}-${Date.now()}`,
        timestamp: new Date().toISOString(),
        source: "session",
        category: "coding-sessions",
        title: truncatedPrompt || `Interaction in ${tracker.project}`,
        description: truncatedResult || "(no text response)",
        metadata: {
          sessionId,
          cwd: tracker.cwd,
          project: tracker.project,
          transcriptPath: tracker.transcriptPath,
          interactionNumber: tracker.interactionCount,
        },
      };

      try {
        await this.#store.addActivity(todayDateKey(), activity);
        debugLog("session.stream", "activity-saved", `id=${activity.id}`);
        this.#emitDiaryUpdated(todayDateKey());
      } catch (err) {
        debugLog("session.stream", "activity-save-error", String(err));
      }

      tracker.lastUserPrompt = "";
    }
  }

  #handleSessionIdResolved(payload: {
    tempId: string;
    realId: string;
  }): void {
    debugLog("session.idResolved", "resolve", `${payload.tempId.slice(0, 12)}… → ${payload.realId.slice(0, 12)}…`);
    const tracker = this.#sessions.get(payload.tempId);
    if (!tracker) {
      debugLog("session.idResolved", "no-tracker", `No tracker for tempId=${payload.tempId.slice(0, 12)}…`);
      return;
    }
    this.#sessions.delete(payload.tempId);
    tracker.sessionId = payload.realId;
    this.#sessions.set(payload.realId, tracker);
    debugLog("session.idResolved", "remapped", "OK");
  }

  #emitDiaryUpdated(date: string): void {
    try {
      this.#ctx.emit({ event: "diary.updated", payload: { date } });
      debugLog("collector", "emit", `diary.updated date=${date}`);
    } catch (err) {
      debugLog("collector", "emit-error", String(err));
    }
  }

  async #handleInstrumentEvent(payload: {
    instrumentId: string;
    event: string;
    payload?: unknown;
  }): Promise<void> {
    debugLog("instrument.event", payload.event, `from=${payload.instrumentId} data=${JSON.stringify(payload.payload)}`);

    const eventData = payload.payload as Record<string, unknown> | undefined;
    if (!eventData) return;

    let activity: DiaryActivity | null = null;

    switch (payload.event) {
      case "hook.SessionStart": {
        const sessionId = String(eventData.session_id ?? "");
        const cwd = String(eventData.cwd ?? "");
        const transcriptPath = String(eventData.transcript_path ?? "");
        if (sessionId) {
          const newProject = extractProjectName(cwd);
          const existing = this.#sessions.get(sessionId);
          if (existing) {
            existing.transcriptPath = transcriptPath;
            if (!existing.cwd) existing.cwd = cwd;
            if (existing.project === "Unknown" && newProject !== "Unknown") {
              existing.project = newProject;
              // Retroactively fix activities already saved with "Unknown"
              void this.#store.updateActivityProject(todayDateKey(), sessionId, newProject, cwd);
            }
          } else {
            this.#sessions.set(sessionId, {
              sessionId,
              cwd,
              project: newProject,
              transcriptPath,
              lastUserPrompt: "",
              interactionCount: 0,
            });
          }
          debugLog("instrument.event", "session-registered", `sid=${sessionId.slice(0, 12)}… project=${newProject}`);
        }
        break;
      }

      case "hook.UserPromptSubmit": {
        const sessionId = String(eventData.session_id ?? "");
        const cwd = String(eventData.cwd ?? "");
        if (sessionId && cwd) {
          const newProject = extractProjectName(cwd);
          const existing = this.#sessions.get(sessionId);
          if (existing) {
            if (!existing.cwd) existing.cwd = cwd;
            if (existing.project === "Unknown" && newProject !== "Unknown") {
              existing.project = newProject;
              void this.#store.updateActivityProject(todayDateKey(), sessionId, newProject, cwd);
            }
          } else {
            this.#sessions.set(sessionId, {
              sessionId,
              cwd,
              project: newProject,
              transcriptPath: "",
              lastUserPrompt: "",
              interactionCount: 0,
            });
          }
          debugLog("instrument.event", "userprompt-tracked", `sid=${sessionId.slice(0, 12)}… project=${newProject} cwd=${cwd}`);
        }
        break;
      }

      case "pr.reviewed": {
        const action = String(eventData.action ?? "COMMENT");
        const actionLabel =
          action === "APPROVE"
            ? "Approved"
            : action === "REQUEST_CHANGES"
              ? "Requested changes on"
              : "Reviewed";
        activity = {
          id: `pr-reviewed-${eventData.repo}-${eventData.number}`,
          timestamp: new Date().toISOString(),
          source: payload.instrumentId,
          category: "pull-requests",
          title: `${actionLabel} PR #${eventData.number} in ${eventData.repo}`,
          description: `"${eventData.title}" by @${eventData.author}${eventData.body ? `. Review: ${String(eventData.body).slice(0, 200)}` : ""}`,
          metadata: eventData,
        };
        break;
      }

      case "pr.commented": {
        const commentType = String(eventData.commentType ?? "issue");
        const locationSuffix =
          commentType === "inline" && eventData.path
            ? ` on ${eventData.path}:${eventData.line}`
            : "";
        activity = {
          id: `pr-comment-${eventData.repo}-${eventData.number}-${Date.now()}`,
          timestamp: new Date().toISOString(),
          source: payload.instrumentId,
          category: "pull-requests",
          title: `Commented on PR #${eventData.number} in ${eventData.repo}${locationSuffix}`,
          description: `"${eventData.title}". Comment: ${String(eventData.body ?? "").slice(0, 200)}`,
          metadata: eventData,
        };
        break;
      }

      case "pr.agentReviewChanged": {
        const status = String(eventData.status ?? "");
        if (status !== "completed") break;
        activity = {
          id: `pr-agent-review-${eventData.repo}-${eventData.number}-${eventData.runId}`,
          timestamp: new Date().toISOString(),
          source: payload.instrumentId,
          category: "reviews",
          title: `Agent review completed for PR #${eventData.number} in ${eventData.repo}`,
          description: `Automated code review finished for PR #${eventData.number}`,
          metadata: eventData,
        };
        break;
      }
    }

    if (activity) {
      try {
        await this.#store.addActivity(todayDateKey(), activity);
        debugLog("instrument.event", "activity-saved", `id=${activity.id}`);
        this.#emitDiaryUpdated(todayDateKey());
      } catch (err) {
        debugLog("instrument.event", "activity-save-error", String(err));
      }
    }
  }
}

function extractProjectName(cwd: string | null): string {
  if (!cwd) return "Unknown";
  const parts = cwd.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "Unknown";
}
