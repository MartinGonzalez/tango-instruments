// PR Instrument backend — ported from multiple host files into a single
// defineBackend entry following the tasks instrument pattern.

import {
  defineBackend,
  type InstrumentBackendContext,
} from "tango-api/backend";
import { PullRequestProvider } from "./lib/pr-provider.ts";
import { parseDiff } from "./lib/diff-parser.ts";
import type {
  DiffFile,
  PullRequestAgentReviewData,
  PullRequestAgentReviewDocument,
  PullRequestAgentReviewLevel,
  PullRequestAgentReviewRun,
  PullRequestAgentReviewStatus,
  PullRequestAgentReviewSuggestion,
  PullRequestReviewState,
} from "./types.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AGENT_REVIEW_PLACEHOLDER_KEY = "__claudex_agent_review_placeholder";
const AGENT_REVIEW_PLACEHOLDER_TEXT = "Agent review is running";

const ALLOWED_REVIEW_LEVELS = new Set<PullRequestAgentReviewLevel>([
  "Low",
  "Medium",
  "Important",
  "Critical",
]);

// ---------------------------------------------------------------------------
// Singletons
// ---------------------------------------------------------------------------

const provider = new PullRequestProvider();

type AgentReviewSessionBinding = {
  runId: string;
  repo: string;
  number: number;
  version: number;
  filePath: string;
  resultText: string;
};

const agentReviewSessions = new Map<string, AgentReviewSessionBinding>();
let unsubscribers: Array<() => void> = [];
let cachedCurrentUser: string | null = null;

// ---------------------------------------------------------------------------
// In-memory cache (5-minute TTL, no disk persistence)
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 5 * 60_000;

type CacheEntry<T> = { data: T; fetchedAt: number };

const prListCache: {
  entry: CacheEntry<{ assigned: any[]; opened: any[]; reviewRequested: any[] }> | null;
} = { entry: null };

const prDetailCache = new Map<string, CacheEntry<any>>();
const prDiffCache = new Map<string, CacheEntry<any>>();

function isCacheValid<T>(entry: CacheEntry<T> | null | undefined): entry is CacheEntry<T> {
  return entry != null && Date.now() - entry.fetchedAt < CACHE_TTL_MS;
}

function detailCacheKey(repo: string, number: number): string {
  return `${repo}#${number}`;
}

function diffCacheKey(repo: string, number: number, commitSha?: string): string {
  return `${repo}#${number}#${commitSha ?? "latest"}`;
}

// ---------------------------------------------------------------------------
// Storage helpers (using Tango storage.properties API)
// ---------------------------------------------------------------------------

function reviewStateKey(repo: string, number: number): string {
  return `review-state:${repo}#${number}`;
}

function agentReviewRunsKey(repo: string, number: number): string {
  return `agent-review-runs:${repo}#${number}`;
}

function agentReviewDocPath(repo: string, number: number, version: number): string {
  const slug = sanitizeRepoSlug(repo);
  const suffix = version <= 1 ? "" : `-${version}`;
  return `agent-review-docs/${slug}-pr${number}-agent-review${suffix}.json`;
}

function getCachedPrTitle(repo: string, number: number): string {
  const key = detailCacheKey(repo, number);
  const cached = prDetailCache.get(key);
  if (cached?.data?.title) return String(cached.data.title);
  return `#${number}`;
}

function getCachedPrAuthor(repo: string, number: number): string {
  const key = detailCacheKey(repo, number);
  const cached = prDetailCache.get(key);
  if (cached?.data?.authorLogin) return String(cached.data.authorLogin);
  return "unknown";
}

function sanitizeRepoSlug(repo: string): string {
  return String(repo ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9/_-]+/g, "-")
    .replace(/[\\/]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "repo";
}

async function getReviewState(
  ctx: InstrumentBackendContext,
  repo: string,
  number: number
): Promise<PullRequestReviewState | null> {
  return ctx.host.storage.getProperty<PullRequestReviewState>(
    reviewStateKey(repo, number)
  );
}

async function saveReviewState(
  ctx: InstrumentBackendContext,
  state: PullRequestReviewState
): Promise<void> {
  await ctx.host.storage.setProperty(
    reviewStateKey(state.repo, state.number),
    state
  );
}

async function getAgentReviewRuns(
  ctx: InstrumentBackendContext,
  repo: string,
  number: number
): Promise<PullRequestAgentReviewRun[]> {
  const runs = await ctx.host.storage.getProperty<PullRequestAgentReviewRun[]>(
    agentReviewRunsKey(repo, number)
  );
  return Array.isArray(runs) ? runs : [];
}

async function saveAgentReviewRuns(
  ctx: InstrumentBackendContext,
  repo: string,
  number: number,
  runs: PullRequestAgentReviewRun[]
): Promise<void> {
  await ctx.host.storage.setProperty(
    agentReviewRunsKey(repo, number),
    runs
  );
}

// ---------------------------------------------------------------------------
// Agent review file operations (using storage.files API)
// ---------------------------------------------------------------------------

async function writeAgentReviewFile(
  ctx: InstrumentBackendContext,
  filePath: string,
  payload: unknown
): Promise<void> {
  await ctx.host.storage.writeFile(
    filePath,
    JSON.stringify(payload, null, 2) + "\n"
  );
}

async function readAgentReviewFile(
  ctx: InstrumentBackendContext,
  filePath: string
): Promise<string | null> {
  try {
    return await ctx.host.storage.readFile(filePath);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Agent review prompt builder
// ---------------------------------------------------------------------------

function buildAgentReviewPrompt(params: {
  repo: string;
  number: number;
  headSha: string;
  outputFilePath: string;
  cwdSource: "stage" | "home";
  stagePath?: string | null;
}): string {
  const repo = String(params.repo ?? "").trim();
  const number = Math.max(1, Math.trunc(params.number));
  const headSha = String(params.headSha ?? "").trim();
  const outputFilePath = String(params.outputFilePath ?? "").trim();
  const cwdSource = params.cwdSource === "stage" ? "stage" : "home";
  const stagePath = String(params.stagePath ?? "").trim();

  return [
    "Run a comprehensive pull request review and produce STRICT JSON output.",
    "Do not use markdown output as the final artifact.",
    "",
    `Repository: ${repo}`,
    `Pull Request: #${number}`,
    `Head SHA: ${headSha || "(unknown)"}`,
    `Output JSON file (overwrite this exact file): ${outputFilePath}`,
    "",
    "Review workflow guidance:",
    "1. Fetch PR data with GitHub CLI (`gh pr view`, `gh api`, `gh pr diff`) and repository context.",
    "2. Focus on concrete engineering feedback: correctness, risks, tests, maintainability, and rollout impact.",
    "3. Keep summaries concise and specific.",
    "",
    "Suggestion structure (mandatory for every `suggestions[]` item):",
    "- `title`: short and specific (max ~10 words).",
    "- `reason`: 2-3 short lines explaining why this should change now.",
    "- `solutions`: concise actionable fix; include markdown bullets/snippet only if needed.",
    "- `benefit`: 1-2 short lines with concrete gains from applying the change.",
    "- Keep each suggestion concise. Avoid long paragraphs and avoid repeating PR summary content.",
    "",
    "Required output schema (top-level JSON object):",
    "{",
    '  "metadata": {',
    '    "repository": "<owner/repo>",',
    '    "pr_number": "<number as string>",',
    '    "author": "<pr author>",',
    '    "base_branch": "<target branch>",',
    '    "head_branch": "<feature branch>",',
    '    "head_sha": "<head sha>"',
    "  },",
    '  "pr_description": "<3-6 concise bullet points describing exactly what changed in this PR>",',
    '  "pr_summary": "<5-10 lines max>",',
    '  "strengths": "<5-10 lines max>",',
    '  "improvements": "<5-10 lines max>",',
    '  "suggestions": [',
    "    {",
    '      "level": "Low | Medium | Important | Critical",',
    '      "title": "<short suggestion title>",',
    '      "reason": "<why this should change now>",',
    '      "solutions": "<actionable solution(s), markdown allowed>",',
    '      "benefit": "<what we gain with this change>",',
    '      "applied": false',
    "    }",
    "  ],",
    '  "final_veredic": "<critical recommendation, what can be deferred, and whether to create a Jira ticket>"',
    "}",
    "",
    "Hard constraints:",
    "- Write valid JSON only to the output file (no comments, no trailing commas).",
    "- Include all required keys exactly as specified.",
    "- Do not add extra keys inside `suggestions[]`.",
    "- `pr_description` should be concise bullet points (markdown list).",
    "- `suggestions[].applied` must always be `false` in generated reviews.",
    "- Every suggestion must include non-empty `title`, `reason`, `solutions`, and `benefit`.",
    "- If no suggestions, return an empty array.",
    "- Use GitHub CLI with `-R <owner/repo>` when not in the repository directory.",
    "",
    cwdSource === "stage"
      ? `Execution context: local stage available at ${stagePath}`
      : "Execution context: no local stage match found; use gh with -R for repository-scoped commands.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Agent review JSON parsing (ported from pr-agent-review-provider.ts)
// ---------------------------------------------------------------------------

type ParsedAgentReviewDocument = {
  review: PullRequestAgentReviewData | null;
  parseError: string | null;
  isPlaceholder: boolean;
};

function isPlaceholderPayload(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  return Boolean((value as Record<string, unknown>)[AGENT_REVIEW_PLACEHOLDER_KEY]);
}

function parseAgentReviewFromRaw(rawJson: string | null | undefined): ParsedAgentReviewDocument {
  if (rawJson == null) {
    return { review: null, parseError: "Review file not found", isPlaceholder: false };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { review: null, parseError: `Invalid JSON: ${message}`, isPlaceholder: false };
  }

  const normalized = normalizeAgentReviewData(parsed);
  if (!normalized.review) {
    return {
      review: null,
      parseError: normalized.parseError,
      isPlaceholder: isPlaceholderPayload(parsed),
    };
  }

  return {
    review: normalized.review,
    parseError: null,
    isPlaceholder: isPlaceholderPayload(parsed),
  };
}

function normalizeAgentReviewData(input: unknown): {
  review: PullRequestAgentReviewData | null;
  parseError: string | null;
} {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { review: null, parseError: "Top-level review document must be a JSON object" };
  }

  const src = input as Record<string, unknown>;
  const metadata = normalizeMetadata(src.metadata);
  if (!metadata) {
    return { review: null, parseError: "Field `metadata` must be an object" };
  }

  const prSummary = firstNonEmpty(
    normalizeRichTextField(src.pr_summary),
    normalizeRichTextField(src.summary)
  ) ?? "";
  const prDescription = firstNonEmpty(
    normalizeRichTextField(src.pr_description),
    normalizeRichTextField(src.prDescription),
    normalizeRichTextField(src.description),
    normalizeRichTextField(metadata.pr_description),
    prSummary
  ) ?? "";
  const strengths = normalizeRichTextField(src.strengths) ?? "";
  const improvements = normalizeRichTextField(src.improvements) ?? "";
  const finalVeredic = firstNonEmpty(
    normalizeRichTextField(src.final_veredic),
    normalizeRichTextField(src.final_verdict)
  ) ?? "";

  if (!Array.isArray(src.suggestions)) {
    return { review: null, parseError: "Field `suggestions` must be an array" };
  }

  const suggestions: PullRequestAgentReviewSuggestion[] = [];
  for (let i = 0; i < src.suggestions.length; i++) {
    const suggestion = normalizeSuggestion(src.suggestions[i]);
    if (!suggestion) {
      return { review: null, parseError: `Invalid suggestion at index ${i}` };
    }
    suggestions.push(suggestion);
  }

  return {
    review: {
      metadata,
      pr_description: prDescription,
      pr_summary: prSummary,
      strengths,
      improvements,
      suggestions,
      final_veredic: finalVeredic,
    },
    parseError: null,
  };
}

function normalizeMetadata(input: unknown): Record<string, string> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    const normalized = normalizeMetadataValue(value);
    if (normalized == null) continue;
    out[String(key)] = normalized;
  }
  return out;
}

function normalizeMetadataValue(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (Array.isArray(value)) {
    const items = value
      .map((item) => normalizeMetadataValue(item))
      .filter((item): item is string => Boolean(item && item.trim()))
      .map((item) => collapseWhitespace(item));
    if (items.length === 0) return null;
    return items.join(", ");
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function normalizeSuggestion(input: unknown): PullRequestAgentReviewSuggestion | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;

  const src = input as Record<string, unknown>;
  const level = asStringOrNull(src.level);
  if (!level) return null;
  if (!ALLOWED_REVIEW_LEVELS.has(level as PullRequestAgentReviewLevel)) return null;
  if (typeof src.applied !== "boolean") return null;

  const titleInput = asStringOrNull(src.title);
  const reasonInput = asStringOrNull(src.reason);
  const solutionsInput = asStringOrNull(src.solutions);
  const benefitInput = asStringOrNull(src.benefit);

  const reason = firstNonEmpty(reasonInput) || "No reason provided.";
  const solutions = firstNonEmpty(solutionsInput) || "No solution provided.";
  const benefit = firstNonEmpty(benefitInput) || "No benefit provided.";
  const title = firstNonEmpty(titleInput) || "Suggestion";

  if (!reasonInput && !solutionsInput && !benefitInput) return null;

  return {
    level: level as PullRequestAgentReviewLevel,
    title,
    reason,
    solutions,
    benefit,
    content: buildSuggestionContentMarkdown({ title, reason, solutions, benefit }),
    applied: src.applied,
  };
}

function asStringOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value;
}

function normalizeRichTextField(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : "";
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (Array.isArray(value)) {
    const items = value
      .map((item) => normalizeRichTextField(item))
      .filter((item): item is string => item != null && item.trim().length > 0);
    if (items.length === 0) return "";
    return items.map((item) => `- ${collapseWhitespace(item)}`).join("\n");
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([key, entryValue]) => {
        const normalizedValue = normalizeRichTextField(entryValue);
        if (normalizedValue == null || normalizedValue.trim().length === 0) return null;
        return `- ${key}: ${collapseWhitespace(normalizedValue)}`;
      })
      .filter((item): item is string => Boolean(item));
    if (entries.length === 0) return "";
    return entries.join("\n");
  }
  return null;
}

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (value == null) continue;
    const normalized = String(value).trim();
    if (!normalized) continue;
    return normalized;
  }
  return null;
}

function collapseWhitespace(value: string): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function buildSuggestionContentMarkdown(params: {
  title: string;
  reason: string;
  solutions: string;
  benefit: string;
}): string {
  return [
    `## ${params.title}`,
    "",
    "**Why:**",
    params.reason,
    "",
    "**Solution/Solutions:**",
    params.solutions,
    "",
    "**Benefit:**",
    params.benefit,
  ].join("\n").trim();
}

function renderAgentReviewMarkdown(review: PullRequestAgentReviewData): string {
  const lines: string[] = [];
  lines.push("# Agent Review");
  lines.push("");

  const entries = Object.entries(review.metadata ?? {});
  if (entries.length > 0) {
    lines.push("## Metadata");
    lines.push("");
    for (const [key, value] of entries) {
      const label = key.replace(/_/g, " ");
      lines.push(`- **${label}:** ${value}`);
    }
    lines.push("");
  }

  lines.push("## PR Description");
  lines.push("");
  lines.push(review.pr_description || "_No PR description provided._");
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(review.pr_summary || "_No summary provided._");
  lines.push("");
  lines.push("## Strengths");
  lines.push("");
  lines.push(review.strengths || "_No strengths provided._");
  lines.push("");
  lines.push("## Improvements");
  lines.push("");
  lines.push(review.improvements || "_No improvements provided._");
  lines.push("");
  lines.push("## Suggestions");
  lines.push("");

  if (review.suggestions.length === 0) {
    lines.push("_No suggestions._");
  } else {
    for (let i = 0; i < review.suggestions.length; i++) {
      const s = review.suggestions[i];
      lines.push(`### ${i + 1}. ${s.title} (${s.level})`);
      lines.push("");
      lines.push("**Why:**");
      lines.push(s.reason || "_No reason provided._");
      lines.push("");
      lines.push("**Solution/Solutions:**");
      lines.push(s.solutions || "_No solutions provided._");
      lines.push("");
      lines.push("**Benefit:**");
      lines.push(s.benefit || "_No benefit provided._");
      lines.push("");
      lines.push(`- Applied: ${s.applied ? "Yes" : "No"}`);
      lines.push("");
    }
  }

  lines.push("## Final Veredic");
  lines.push("");
  lines.push(review.final_veredic || "_No final veredic provided._");
  lines.push("");

  return lines.join("\n").trim();
}

function extractJsonCandidateFromText(value: string): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  if (looksLikeParsableJson(raw)) return raw;

  const fencedMatch = raw.match(/```json\s*([\s\S]*?)```/i);
  const fenced = fencedMatch?.[1]?.trim() ?? "";
  if (fenced && looksLikeParsableJson(fenced)) return fenced;

  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const candidate = raw.slice(firstBrace, lastBrace + 1).trim();
    if (looksLikeParsableJson(candidate)) return candidate;
  }

  return null;
}

function looksLikeParsableJson(value: string): boolean {
  try {
    const parsed = JSON.parse(value);
    return Boolean(parsed && typeof parsed === "object" && !Array.isArray(parsed));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Resolve CWD for agent review
// ---------------------------------------------------------------------------

async function resolveAgentReviewCwd(
  ctx: InstrumentBackendContext,
  repo: string
): Promise<{ cwd: string; source: "stage" | "home"; stagePath: string | null }> {
  const normalizedRepo = String(repo ?? "").trim().toLowerCase();
  const stages = await ctx.host.stages.list();

  for (const stagePath of stages) {
    try {
      const result = await runCommandInCwd("git", ["config", "--get", "remote.origin.url"], stagePath);
      if (result.exitCode !== 0) continue;
      const remoteRepo = parseRepoFromRemoteUrl(result.stdout);
      if (!remoteRepo) continue;
      if (remoteRepo.toLowerCase() === normalizedRepo) {
        return { cwd: stagePath, source: "stage", stagePath };
      }
    } catch {
      continue;
    }
  }

  const homeDir = process.env.HOME || "/tmp";
  return { cwd: homeDir, source: "home", stagePath: null };
}

function parseRepoFromRemoteUrl(value: string): string | null {
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;
  const withoutProtocol = normalized.replace(/^ssh:\/\//i, "");
  const match = withoutProtocol.match(/github\.com[:/]([^\s]+)$/i);
  if (!match) return null;
  const candidate = match[1]
    .replace(/\.git$/i, "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
  const parts = candidate.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  return `${parts[0]}/${parts[1]}`;
}

async function runCommandInCwd(
  command: string,
  args: string[],
  cwd: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn([command, ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

// ---------------------------------------------------------------------------
// Session lifecycle handlers
// ---------------------------------------------------------------------------

function handleSessionStream(
  ctx: InstrumentBackendContext,
  payload: { sessionId: string; event: Record<string, unknown> }
): void {
  const binding = agentReviewSessions.get(payload.sessionId);
  if (!binding) return;

  // Accumulate result text for fallback extraction
  const event = payload.event;
  if (event.type === "assistant") {
    const message = event.message as { content?: Array<Record<string, unknown>> } | undefined;
    const blocks = message?.content;
    if (Array.isArray(blocks)) {
      const text = blocks
        .filter((b) => b && typeof b === "object" && b.type === "text")
        .map((b) => String(b.text ?? ""))
        .join("\n")
        .trim();
      if (text) binding.resultText += `${text}\n`;
    }
  }
  if (event.type === "result") {
    const result = String(event.result ?? "").trim();
    if (result) binding.resultText += `${result}\n`;
  }
}

function handleSessionIdResolved(
  payload: { tempId: string; realId: string }
): void {
  const binding = agentReviewSessions.get(payload.tempId);
  if (!binding) return;
  agentReviewSessions.delete(payload.tempId);
  agentReviewSessions.set(payload.realId, binding);
}

async function handleSessionEnded(
  ctx: InstrumentBackendContext,
  payload: { sessionId: string; exitCode: number }
): Promise<void> {
  const binding = agentReviewSessions.get(payload.sessionId);
  if (!binding) return;
  agentReviewSessions.delete(payload.sessionId);

  const runs = await getAgentReviewRuns(ctx, binding.repo, binding.number);
  const run = runs.find((r) => r.id === binding.runId);
  if (!run || run.status !== "running") return;

  const now = new Date().toISOString();

  try {
    // Try to read the document file
    const rawFile = await readAgentReviewFile(ctx, binding.filePath);
    const parsedFile = parseAgentReviewFromRaw(rawFile);

    if (parsedFile.review && !parsedFile.isPlaceholder) {
      // File has valid review — write clean version
      await writeAgentReviewFile(ctx, binding.filePath, parsedFile.review);
      run.status = "completed";
      run.completedAt = now;
      run.error = null;
    } else {
      // Try extracting from accumulated result text
      const fallbackRaw = extractJsonCandidateFromText(binding.resultText);
      const parsedFallback = parseAgentReviewFromRaw(fallbackRaw);

      if (parsedFallback.review && !parsedFallback.isPlaceholder) {
        await writeAgentReviewFile(ctx, binding.filePath, parsedFallback.review);
        run.status = "completed";
        run.completedAt = now;
        run.error = null;
      } else {
        run.status = "failed";
        run.error = parsedFile.parseError || "Agent review did not produce valid JSON";
      }
    }
  } catch (error) {
    run.status = "failed";
    run.error = error instanceof Error ? error.message : String(error);
  }

  run.sessionId = null;
  run.updatedAt = now;
  await saveAgentReviewRuns(ctx, binding.repo, binding.number, runs);

  ctx.emit({
    event: "pr.agentReviewChanged",
    payload: {
      repo: binding.repo,
      number: binding.number,
      runId: binding.runId,
      status: run.status,
    },
  });
}

// ---------------------------------------------------------------------------
// Backend definition
// ---------------------------------------------------------------------------

export default defineBackend({
  kind: "tango.instrument.backend.v2",
  actions: {
    listPullRequests: {
      input: {
        type: "object",
        properties: {
          forceRefresh: { type: "boolean" },
        },
        additionalProperties: false,
      },
      handler: async (_ctx, input: { forceRefresh?: boolean }) => {
        if (!input.forceRefresh && isCacheValid(prListCache.entry)) {
          return prListCache.entry.data;
        }

        if (input.forceRefresh) {
          prDetailCache.clear();
          prDiffCache.clear();
        }

        const [assigned, opened, reviewRequested] = await Promise.all([
          provider.getAssignedPullRequests(),
          provider.getOpenedPullRequests(),
          provider.getReviewRequestedPullRequests(),
        ]);

        const data = { assigned, opened, reviewRequested };
        prListCache.entry = { data, fetchedAt: Date.now() };
        return data;
      },
    },

    getCurrentUser: {
      input: { type: "object", properties: {}, additionalProperties: false },
      handler: async () => {
        if (cachedCurrentUser) return { login: cachedCurrentUser };
        const login = await provider.getCurrentUser();
        cachedCurrentUser = login;
        return { login };
      },
    },

    getPullRequestDetail: {
      input: {
        type: "object",
        properties: {
          repo: { type: "string" },
          number: { type: "number" },
          forceRefresh: { type: "boolean" },
        },
        required: ["repo", "number"],
      },
      handler: async (_ctx, input: { repo: string; number: number; forceRefresh?: boolean }) => {
        const key = detailCacheKey(input.repo, input.number);

        if (!input.forceRefresh) {
          const cached = prDetailCache.get(key);
          if (isCacheValid(cached)) return cached.data;
        }

        const data = await provider.getPullRequestDetail(input.repo, input.number);
        prDetailCache.set(key, { data, fetchedAt: Date.now() });
        return data;
      },
    },

    getPullRequestDiff: {
      input: {
        type: "object",
        properties: {
          repo: { type: "string" },
          number: { type: "number" },
          commitSha: { type: "string" },
          forceRefresh: { type: "boolean" },
        },
        required: ["repo", "number"],
      },
      handler: async (_ctx, input: { repo: string; number: number; commitSha?: string; forceRefresh?: boolean }) => {
        const key = diffCacheKey(input.repo, input.number, input.commitSha);

        if (!input.forceRefresh) {
          const cached = prDiffCache.get(key);
          if (isCacheValid(cached)) return cached.data;
        }

        const data = await provider.getPullRequestDiff(input.repo, input.number, input.commitSha);
        prDiffCache.set(key, { data, fetchedAt: Date.now() });
        return data;
      },
    },

    getReviewState: {
      input: {
        type: "object",
        properties: {
          repo: { type: "string" },
          number: { type: "number" },
        },
        required: ["repo", "number"],
      },
      handler: async (ctx, input: { repo: string; number: number }) => {
        return getReviewState(ctx, input.repo, input.number);
      },
    },

    setFileSeen: {
      input: {
        type: "object",
        properties: {
          repo: { type: "string" },
          number: { type: "number" },
          headSha: { type: "string" },
          filePath: { type: "string" },
          fileSha: { type: "string" },
          seen: { type: "boolean" },
        },
        required: ["repo", "number", "headSha", "filePath", "seen"],
      },
      handler: async (ctx, input: {
        repo: string;
        number: number;
        headSha: string;
        filePath: string;
        fileSha?: string;
        seen: boolean;
      }) => {
        const now = new Date().toISOString();
        const existing = await getReviewState(ctx, input.repo, input.number);
        const state: PullRequestReviewState = existing ?? {
          repo: input.repo,
          number: input.number,
          reviewedHeadSha: null,
          viewedFiles: {},
          updatedAt: now,
        };

        if (input.seen) {
          state.viewedFiles[input.filePath] = {
            sha: input.fileSha ?? null,
            seenAt: now,
          };
          state.reviewedHeadSha = input.headSha || state.reviewedHeadSha;
        } else {
          delete state.viewedFiles[input.filePath];
        }

        state.updatedAt = now;
        await saveReviewState(ctx, state);
        return state;
      },
    },

    markFilesSeen: {
      input: {
        type: "object",
        properties: {
          repo: { type: "string" },
          number: { type: "number" },
          headSha: { type: "string" },
          files: {
            type: "array",
            items: {
              type: "object",
              properties: {
                path: { type: "string" },
                sha: { type: "string" },
              },
              required: ["path"],
            },
          },
        },
        required: ["repo", "number", "headSha", "files"],
      },
      handler: async (ctx, input: {
        repo: string;
        number: number;
        headSha: string;
        files: Array<{ path: string; sha?: string | null }>;
      }) => {
        const now = new Date().toISOString();
        const viewedFiles: Record<string, { sha: string | null; seenAt: string }> = {};

        for (const file of input.files) {
          const path = String(file.path ?? "").trim();
          if (!path) continue;
          viewedFiles[path] = {
            sha: file.sha ?? null,
            seenAt: now,
          };
        }

        const state: PullRequestReviewState = {
          repo: input.repo,
          number: input.number,
          reviewedHeadSha: input.headSha || null,
          viewedFiles,
          updatedAt: now,
        };

        await saveReviewState(ctx, state);
        return state;
      },
    },

    submitReview: {
      input: {
        type: "object",
        properties: {
          repo: { type: "string" },
          number: { type: "number" },
          event: { type: "string" },
          body: { type: "string" },
        },
        required: ["repo", "number", "event"],
      },
      handler: async (ctx, input: {
        repo: string;
        number: number;
        event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
        body?: string;
      }) => {
        const title = getCachedPrTitle(input.repo, input.number);
        const author = getCachedPrAuthor(input.repo, input.number);

        await provider.submitPullRequestReview(
          input.repo,
          input.number,
          input.event,
          input.body
        );

        ctx.emit({
          event: "pr.reviewed",
          payload: {
            repo: input.repo,
            number: input.number,
            title,
            author,
            action: input.event,
            body: input.body ?? "",
          },
        });

        // Invalidate caches so detail refreshes with the new review
        const key = detailCacheKey(input.repo, input.number);
        prDetailCache.delete(key);
        prListCache.entry = null;
        return { ok: true };
      },
    },

    listAgentReviews: {
      input: {
        type: "object",
        properties: {
          repo: { type: "string" },
          number: { type: "number" },
        },
        required: ["repo", "number"],
      },
      handler: async (ctx, input: { repo: string; number: number }) => {
        const runs = await getAgentReviewRuns(ctx, input.repo, input.number);
        return runs.sort((a, b) => a.version - b.version);
      },
    },

    getAgentReviewDocument: {
      input: {
        type: "object",
        properties: {
          repo: { type: "string" },
          number: { type: "number" },
          version: { type: "number" },
        },
        required: ["repo", "number", "version"],
      },
      handler: async (ctx, input: { repo: string; number: number; version: number }) => {
        const runs = await getAgentReviewRuns(ctx, input.repo, input.number);
        const run = runs.find((r) => r.version === Math.max(1, Math.trunc(input.version)));
        if (!run) return null;

        const rawJson = await readAgentReviewFile(ctx, run.filePath);
        if (rawJson == null) return null;

        const parsed = parseAgentReviewFromRaw(rawJson);
        const renderedMarkdown = parsed.review
          ? renderAgentReviewMarkdown(parsed.review)
          : `# Agent Review\n\nUnable to parse review JSON.\n\n${parsed.parseError ? `Error: \`${parsed.parseError.replace(/`/g, "'")}\`` : ""}`;

        return {
          run,
          rawJson,
          review: parsed.review,
          renderedMarkdown,
          parseError: parsed.parseError,
        } satisfies PullRequestAgentReviewDocument;
      },
    },

    startAgentReview: {
      input: {
        type: "object",
        properties: {
          repo: { type: "string" },
          number: { type: "number" },
          headSha: { type: "string" },
        },
        required: ["repo", "number", "headSha"],
      },
      handler: async (ctx, input: { repo: string; number: number; headSha: string }) => {
        const repo = String(input.repo ?? "").trim();
        const number = Math.max(1, Math.trunc(input.number));
        const headSha = String(input.headSha ?? "").trim();

        if (!repo || !Number.isFinite(number)) {
          throw new Error("Invalid pull request selection");
        }

        const runs = await getAgentReviewRuns(ctx, repo, number);
        if (runs.some((r) => r.status === "running")) {
          throw new Error("An Agent Review run is already active for this pull request");
        }

        const nextVersion = runs.reduce((max, r) => {
          if (!Number.isFinite(r.version)) return max;
          return Math.max(max, Math.max(1, Math.trunc(r.version)));
        }, 0) + 1;

        const filePath = agentReviewDocPath(repo, number, nextVersion);
        const now = new Date().toISOString();

        const run: PullRequestAgentReviewRun = {
          id: crypto.randomUUID(),
          repo,
          number,
          version: nextVersion,
          fileName: filePath.split("/").pop() || "",
          filePath,
          headSha,
          status: "running",
          sessionId: null,
          startedAt: now,
          updatedAt: now,
          completedAt: null,
          error: null,
        };

        // Write placeholder
        const placeholder: Record<string, unknown> = {
          [AGENT_REVIEW_PLACEHOLDER_KEY]: true,
          metadata: {
            repository: run.repo,
            pr_number: String(run.number),
            version: `v${run.version}`,
            head_sha: run.headSha || "(unknown)",
            started_at: run.startedAt,
          },
          pr_description: "",
          pr_summary: "",
          strengths: "",
          improvements: "",
          suggestions: [],
          final_veredic: AGENT_REVIEW_PLACEHOLDER_TEXT,
        };
        await writeAgentReviewFile(ctx, filePath, placeholder);

        // Resolve CWD
        const cwdResolution = await resolveAgentReviewCwd(ctx, repo);

        // Build prompt
        const prompt = buildAgentReviewPrompt({
          repo,
          number,
          headSha,
          outputFilePath: filePath,
          cwdSource: cwdResolution.source,
          stagePath: cwdResolution.stagePath,
        });

        // Start session
        const session = await ctx.host.sessions.start({
          prompt,
          cwd: cwdResolution.cwd,
          fullAccess: true,
        });

        run.sessionId = session.sessionId;
        runs.push(run);
        runs.sort((a, b) => a.version - b.version);
        await saveAgentReviewRuns(ctx, repo, number, runs);

        // Track session for lifecycle handling
        agentReviewSessions.set(session.sessionId, {
          runId: run.id,
          repo,
          number,
          version: nextVersion,
          filePath,
          resultText: "",
        });

        ctx.emit({
          event: "pr.agentReviewChanged",
          payload: {
            repo,
            number,
            runId: run.id,
            status: "running",
          },
        });

        return run;
      },
    },

    proxyImage: {
      input: {
        type: "object",
        properties: {
          url: { type: "string" },
        },
        required: ["url"],
      },
      handler: async (_ctx, input: { url: string }) => {
        const url = String(input.url ?? "").trim();
        if (!url) throw new Error("Missing url");

        const tokenResult = await runCommandInCwd("gh", ["auth", "token"], process.env.HOME || "/tmp");
        if (tokenResult.exitCode !== 0 || !tokenResult.stdout.trim()) {
          throw new Error("Failed to get gh auth token");
        }
        const token = tokenResult.stdout.trim();

        const response = await fetch(url, {
          headers: { Authorization: `token ${token}` },
          redirect: "follow",
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch image: ${response.status}`);
        }

        const contentType = response.headers.get("content-type") || "image/png";
        const buffer = await response.arrayBuffer();
        const base64 = Buffer.from(buffer).toString("base64");
        return { dataUri: `data:${contentType};base64,${base64}` };
      },
    },

    addIssueComment: {
      input: {
        type: "object",
        properties: {
          repo: { type: "string" },
          number: { type: "number" },
          body: { type: "string" },
        },
        required: ["repo", "number", "body"],
      },
      handler: async (ctx, input: { repo: string; number: number; body: string }) => {
        const title = getCachedPrTitle(input.repo, input.number);
        const result = await provider.addIssueComment(input.repo, input.number, input.body);

        ctx.emit({
          event: "pr.commented",
          payload: {
            repo: input.repo,
            number: input.number,
            title,
            commentType: "issue",
            body: input.body,
          },
        });

        prDetailCache.delete(detailCacheKey(input.repo, input.number));
        return result;
      },
    },

    updatePullRequest: {
      input: {
        type: "object",
        properties: {
          repo: { type: "string" },
          number: { type: "number" },
          title: { type: "string" },
          body: { type: "string" },
        },
        required: ["repo", "number"],
      },
      handler: async (ctx, input: { repo: string; number: number; title?: string; body?: string }) => {
        await provider.updatePullRequest(input.repo, input.number, {
          title: input.title,
          body: input.body,
        });

        ctx.emit({
          event: "pr.updated",
          payload: {
            repo: input.repo,
            number: input.number,
            title: input.title,
            body: input.body,
          },
        });

        prDetailCache.delete(detailCacheKey(input.repo, input.number));
        return { ok: true };
      },
    },

    replyReviewComment: {
      input: {
        type: "object",
        properties: {
          repo: { type: "string" },
          number: { type: "number" },
          commentId: { type: "string" },
          body: { type: "string" },
        },
        required: ["repo", "number", "commentId", "body"],
      },
      handler: async (ctx, input: { repo: string; number: number; commentId: string; body: string }) => {
        const title = getCachedPrTitle(input.repo, input.number);
        await provider.replyPullRequestReviewComment(
          input.repo,
          input.number,
          input.commentId,
          input.body
        );

        ctx.emit({
          event: "pr.commented",
          payload: {
            repo: input.repo,
            number: input.number,
            title,
            commentType: "reply",
            body: input.body,
          },
        });

        prDetailCache.delete(detailCacheKey(input.repo, input.number));
        return { ok: true };
      },
    },

    createReviewComment: {
      input: {
        type: "object",
        properties: {
          repo: { type: "string" },
          number: { type: "number" },
          commitSha: { type: "string" },
          path: { type: "string" },
          line: { type: "number" },
          side: { type: "string" },
          body: { type: "string" },
        },
        required: ["repo", "number", "commitSha", "path", "line", "side", "body"],
      },
      handler: async (ctx, input: {
        repo: string;
        number: number;
        commitSha: string;
        path: string;
        line: number;
        side: "LEFT" | "RIGHT";
        body: string;
      }) => {
        const title = getCachedPrTitle(input.repo, input.number);
        await provider.createPullRequestReviewComment(
          input.repo,
          input.number,
          {
            commitSha: input.commitSha,
            path: input.path,
            line: input.line,
            side: input.side,
            body: input.body,
          }
        );

        ctx.emit({
          event: "pr.commented",
          payload: {
            repo: input.repo,
            number: input.number,
            title,
            commentType: "inline",
            path: input.path,
            line: input.line,
            body: input.body,
          },
        });

        prDetailCache.delete(detailCacheKey(input.repo, input.number));
        return { ok: true };
      },
    },

    resolveReviewThread: {
      input: {
        type: "object",
        properties: {
          nodeId: { type: "string" },
        },
        required: ["nodeId"],
      },
      handler: async (_ctx, input: { nodeId: string }) => {
        await provider.resolveReviewThread(input.nodeId);
        return { ok: true };
      },
    },

    unresolveReviewThread: {
      input: {
        type: "object",
        properties: {
          nodeId: { type: "string" },
        },
        required: ["nodeId"],
      },
      handler: async (_ctx, input: { nodeId: string }) => {
        await provider.unresolveReviewThread(input.nodeId);
        return { ok: true };
      },
    },

    applySuggestion: {
      input: {
        type: "object",
        properties: {
          repo: { type: "string" },
          number: { type: "number" },
          version: { type: "number" },
          suggestionIndex: { type: "number" },
        },
        required: ["repo", "number", "version", "suggestionIndex"],
      },
      handler: async (ctx, input: {
        repo: string;
        number: number;
        version: number;
        suggestionIndex: number;
      }) => {
        const runs = await getAgentReviewRuns(ctx, input.repo, input.number);
        const run = runs.find((r) => r.version === Math.max(1, Math.trunc(input.version)));
        if (!run) throw new Error("Review run not found");

        const rawJson = await readAgentReviewFile(ctx, run.filePath);
        const parsed = parseAgentReviewFromRaw(rawJson);
        if (!parsed.review) throw new Error(parsed.parseError ?? "Review JSON is missing");
        if (parsed.isPlaceholder) throw new Error("Review is still generating");

        const idx = Math.trunc(input.suggestionIndex);
        if (idx < 0 || idx >= parsed.review.suggestions.length) {
          throw new Error("Suggestion index is out of range");
        }

        const nextReview: PullRequestAgentReviewData = {
          ...parsed.review,
          metadata: { ...parsed.review.metadata },
          suggestions: parsed.review.suggestions.map((item, i) => {
            if (i !== idx) return { ...item };
            return { ...item, applied: true };
          }),
        };

        await writeAgentReviewFile(ctx, run.filePath, nextReview);
      },
    },
  },

  onStart: async (ctx) => {
    // Subscribe to session lifecycle events for agent review tracking
    unsubscribers.push(
      ctx.host.events.subscribe("session.stream", (payload) => {
        handleSessionStream(ctx, payload);
      })
    );

    unsubscribers.push(
      ctx.host.events.subscribe("session.idResolved", (payload) => {
        handleSessionIdResolved(payload);
      })
    );

    unsubscribers.push(
      ctx.host.events.subscribe("session.ended", (payload) => {
        void handleSessionEnded(ctx, payload);
      })
    );
  },

  onStop: async () => {
    for (const unsub of unsubscribers) {
      unsub();
    }
    unsubscribers = [];
    agentReviewSessions.clear();
    prListCache.entry = null;
    prDetailCache.clear();
    prDiffCache.clear();
    cachedCurrentUser = null;
  },
});
