// PullRequestProvider — ported from desktop/src/bun/pr-provider.ts

import { parseDiff } from "./diff-parser.ts";
import type {
  DiffFile,
  FileStatus,
  PullRequestCheck,
  PullRequestCommit,
  PullRequestConversationItem,
  PullRequestDetail,
  PullRequestFileMeta,
  PullRequestReviewThread,
  PullRequestReviewThreadComment,
  PullRequestSummary,
  PullRequestTimelineEvent,
  PullRequestTimelineEventType,
  PullRequestTimelineItem,
} from "../types.ts";
import {
  type CommandRunner,
  GhCommandError,
  runGhCommand,
  runGhJson,
  runGhPagedJson,
  runGhText,
  shortError,
  toGhCommandError,
} from "./gh-runner.ts";

export class PullRequestProvider {
  #run: CommandRunner;

  constructor(run: CommandRunner = runGhCommand) {
    this.#run = run;
  }

  async getCurrentUser(): Promise<string> {
    const result = await runGhText(this.#run, [
      "api",
      "user",
      "--jq",
      ".login",
    ]);
    return result.trim();
  }

  async getAssignedPullRequests(limit = 60): Promise<PullRequestSummary[]> {
    return this.#searchPullRequests({
      filterFlag: "--assignee",
      filterValue: "@me",
      limit,
    });
  }

  async getOpenedPullRequests(limit = 60): Promise<PullRequestSummary[]> {
    return this.#searchPullRequests({
      filterFlag: "--author",
      filterValue: "@me",
      limit,
    });
  }

  async getReviewRequestedPullRequests(limit = 60): Promise<PullRequestSummary[]> {
    return this.#searchPullRequests({
      filterFlag: "--review-requested",
      filterValue: "@me",
      limit,
    });
  }

  async #searchPullRequests(params: {
    filterFlag: "--assignee" | "--author" | "--review-requested";
    filterValue: string;
    limit: number;
  }): Promise<PullRequestSummary[]> {
    const safeLimit = Number.isFinite(params.limit)
      ? Math.max(1, Math.min(200, Math.floor(params.limit)))
      : 60;

    const raw = await runGhJson<any[]>(this.#run, [
      "search",
      "prs",
      params.filterFlag,
      params.filterValue,
      "--state",
      "open",
      "-L",
      String(safeLimit),
      "--json",
      "number,title,repository,author,isDraft,updatedAt,url",
    ]);

    const rows = Array.isArray(raw) ? raw : [];
    const out: PullRequestSummary[] = [];

    for (const entry of rows) {
      const repo = String(entry?.repository?.nameWithOwner ?? "").trim();
      const number = toInteger(entry?.number);
      if (!repo || number <= 0) continue;

      out.push({
        repo,
        number,
        title: String(entry?.title ?? "(untitled PR)").trim() || "(untitled PR)",
        authorLogin: String(entry?.author?.login ?? "unknown").trim() || "unknown",
        authorIsBot: Boolean(
          entry?.author?.is_bot
            ?? entry?.author?.isBot
            ?? String(entry?.author?.type ?? "").toLowerCase() === "bot"
        ),
        isDraft: Boolean(entry?.isDraft),
        updatedAt: normalizeIso(String(entry?.updatedAt ?? "")),
        url: String(entry?.url ?? "").trim(),
      });
    }

    out.sort((a, b) => {
      const tsA = Date.parse(a.updatedAt);
      const tsB = Date.parse(b.updatedAt);
      if (Number.isFinite(tsA) && Number.isFinite(tsB) && tsA !== tsB) {
        return tsB - tsA;
      }
      if (a.repo !== b.repo) return a.repo.localeCompare(b.repo);
      return a.number - b.number;
    });

    return out;
  }

  async getPullRequestDetail(repo: string, number: number): Promise<PullRequestDetail> {
    const pr = await runGhJson<any>(this.#run, [
      "pr",
      "view",
      String(number),
      "-R",
      repo,
      "--json",
      "number,title,body,url,state,isDraft,author,baseRefName,headRefName,headRefOid,reviewDecision,mergeStateStatus,createdAt,updatedAt,commits,statusCheckRollup",
    ]);

    const warnings: string[] = [];

    const [files, issueComments, reviews, reviewComments, rawTimeline, threadMeta] = await Promise.all([
      this.#loadOptionalPagedArray<any>(
        ["api", `repos/${repo}/pulls/${number}/files`],
        "PR files",
        warnings
      ),
      this.#loadOptionalPagedArray<any>(
        ["api", `repos/${repo}/issues/${number}/comments`],
        "issue comments",
        warnings
      ),
      this.#loadOptionalPagedArray<any>(
        ["api", `repos/${repo}/pulls/${number}/reviews`],
        "reviews",
        warnings
      ),
      this.#loadOptionalPagedArray<any>(
        ["api", `repos/${repo}/pulls/${number}/comments`],
        "review comments",
        warnings
      ),
      this.#loadOptionalTimeline(repo, number, warnings),
      this.#loadReviewThreadMeta(repo, number, warnings),
    ]);

    const commits = normalizePullRequestCommits(pr?.commits);
    const mappedFiles = normalizePullRequestFiles(files);
    const conversation = buildPullRequestConversation(issueComments, reviews, reviewComments);
    const timelineEvents = normalizeTimelineEvents(rawTimeline);
    const timeline = buildPullRequestTimeline(conversation, timelineEvents, rawTimeline);

    // Enrich review threads with GraphQL metadata (nodeId + isResolved)
    if (threadMeta.length > 0) {
      const metaByRootId = new Map(threadMeta.map((m) => [m.rootDatabaseId, m]));
      for (const item of timeline) {
        if (item.kind !== "review_thread") continue;
        const rootId = item.id.replace(/^thread-/, "");
        const meta = metaByRootId.get(Number(rootId));
        if (meta) {
          item.nodeId = meta.nodeId;
          item.isResolved = meta.isResolved;
        }
      }
    }

    return {
      repo,
      number,
      title: String(pr?.title ?? "(untitled PR)").trim() || "(untitled PR)",
      body: String(pr?.body ?? ""),
      url: String(pr?.url ?? "").trim(),
      state: String(pr?.state ?? "OPEN"),
      isDraft: Boolean(pr?.isDraft),
      authorLogin: String(pr?.author?.login ?? "unknown").trim() || "unknown",
      authorName: String(pr?.author?.name ?? "").trim(),
      authorIsBot: Boolean(pr?.author?.is_bot ?? pr?.author?.isBot),
      baseRefName: String(pr?.baseRefName ?? "").trim(),
      headRefName: String(pr?.headRefName ?? "").trim(),
      headSha: String(pr?.headRefOid ?? "").trim(),
      reviewDecision: asNullableString(pr?.reviewDecision),
      mergeStateStatus: asNullableString(pr?.mergeStateStatus),
      createdAt: normalizeIso(String(pr?.createdAt ?? "")),
      updatedAt: normalizeIso(String(pr?.updatedAt ?? "")),
      checks: normalizePullRequestChecks(pr?.statusCheckRollup),
      commits,
      files: mappedFiles,
      // Use the merged timeline (conversation + timeline events) as the conversation field.
      // The separate `timeline` field was being stripped by the Tango host serialization layer,
      // so we piggyback on the existing `conversation` field which is a known transfer path.
      conversation: timeline as any,
      timeline,
      warnings,
    };
  }

  async getPullRequestDiff(
    repo: string,
    number: number,
    commitSha?: string | null
  ): Promise<DiffFile[]> {
    const endpoint = commitSha
      ? `repos/${repo}/commits/${commitSha}`
      : `repos/${repo}/pulls/${number}`;

    const rawDiff = await runGhText(this.#run, [
      "api",
      endpoint,
      "-H",
      "Accept: application/vnd.github.v3.diff",
    ]);

    if (!rawDiff.trim()) return [];

    try {
      return parseDiff(rawDiff);
    } catch {
      return [];
    }
  }

  async replyPullRequestReviewComment(
    repo: string,
    number: number,
    commentId: string,
    body: string
  ): Promise<void> {
    const parsedCommentId = toInteger(commentId);
    const trimmedBody = String(body ?? "").trim();
    if (parsedCommentId <= 0) {
      throw new GhCommandError({
        code: "api_error",
        message: "Invalid pull request review comment id",
        args: ["api", `repos/${repo}/pulls/${number}/comments/${commentId}/replies`, "-X", "POST"],
        stderr: "Invalid pull request review comment id",
        exitCode: 1,
      });
    }
    if (!trimmedBody) {
      throw new GhCommandError({
        code: "api_error",
        message: "Reply body cannot be empty",
        args: ["api", `repos/${repo}/pulls/${number}/comments/${parsedCommentId}/replies`, "-X", "POST"],
        stderr: "Reply body cannot be empty",
        exitCode: 1,
      });
    }

    await runGhText(this.#run, [
      "api",
      `repos/${repo}/pulls/${number}/comments/${parsedCommentId}/replies`,
      "-X",
      "POST",
      "-f",
      `body=${trimmedBody}`,
    ]);
  }

  async createPullRequestReviewComment(
    repo: string,
    number: number,
    params: {
      commitSha: string;
      path: string;
      line: number;
      side: "LEFT" | "RIGHT";
      body: string;
    }
  ): Promise<void> {
    const commitSha = String(params.commitSha ?? "").trim();
    const path = String(params.path ?? "").trim();
    const line = toInteger(params.line);
    const side = String(params.side ?? "").trim().toUpperCase();
    const body = String(params.body ?? "").trim();
    const endpoint = `repos/${repo}/pulls/${number}/comments`;

    if (!commitSha) {
      throw new GhCommandError({
        code: "api_error",
        message: "Invalid pull request commit sha",
        args: ["api", endpoint, "-X", "POST"],
        stderr: "Invalid pull request commit sha",
        exitCode: 1,
      });
    }
    if (!path) {
      throw new GhCommandError({
        code: "api_error",
        message: "Invalid pull request file path",
        args: ["api", endpoint, "-X", "POST"],
        stderr: "Invalid pull request file path",
        exitCode: 1,
      });
    }
    if (line <= 0) {
      throw new GhCommandError({
        code: "api_error",
        message: "Invalid pull request line number",
        args: ["api", endpoint, "-X", "POST"],
        stderr: "Invalid pull request line number",
        exitCode: 1,
      });
    }
    if (side !== "LEFT" && side !== "RIGHT") {
      throw new GhCommandError({
        code: "api_error",
        message: "Invalid pull request review side",
        args: ["api", endpoint, "-X", "POST"],
        stderr: "Invalid pull request review side",
        exitCode: 1,
      });
    }
    if (!body) {
      throw new GhCommandError({
        code: "api_error",
        message: "Comment body cannot be empty",
        args: ["api", endpoint, "-X", "POST"],
        stderr: "Comment body cannot be empty",
        exitCode: 1,
      });
    }

    await runGhText(this.#run, [
      "api",
      endpoint,
      "-X",
      "POST",
      "-f",
      `body=${body}`,
      "-f",
      `commit_id=${commitSha}`,
      "-f",
      `path=${path}`,
      "-f",
      `side=${side}`,
      "-F",
      `line=${line}`,
    ]);
  }

  async addIssueComment(
    repo: string,
    number: number,
    body: string
  ): Promise<{ id: number }> {
    const trimmedBody = String(body ?? "").trim();
    if (!trimmedBody) {
      throw new GhCommandError({
        code: "api_error",
        message: "Comment body cannot be empty",
        args: ["api", `repos/${repo}/issues/${number}/comments`, "-X", "POST"],
        stderr: "Comment body cannot be empty",
        exitCode: 1,
      });
    }

    const result = await runGhJson<any>(this.#run, [
      "api",
      `repos/${repo}/issues/${number}/comments`,
      "-X",
      "POST",
      "-f",
      `body=${trimmedBody}`,
    ]);

    return { id: result?.id ?? 0 };
  }

  async resolveReviewThread(nodeId: string): Promise<void> {
    await runGhText(this.#run, [
      "api",
      "graphql",
      "-f",
      `query=mutation { resolveReviewThread(input: { threadId: "${nodeId}" }) { thread { id isResolved } } }`,
    ]);
  }

  async unresolveReviewThread(nodeId: string): Promise<void> {
    await runGhText(this.#run, [
      "api",
      "graphql",
      "-f",
      `query=mutation { unresolveReviewThread(input: { threadId: "${nodeId}" }) { thread { id isResolved } } }`,
    ]);
  }

  async updatePullRequest(
    repo: string,
    number: number,
    fields: { title?: string; body?: string }
  ): Promise<void> {
    const args = [
      "api",
      `repos/${repo}/pulls/${number}`,
      "-X",
      "PATCH",
    ];
    if (fields.title != null) {
      args.push("-f", `title=${fields.title}`);
    }
    if (fields.body != null) {
      args.push("-f", `body=${fields.body}`);
    }
    await runGhText(this.#run, args);
  }

  async submitPullRequestReview(
    repo: string,
    number: number,
    event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT",
    body?: string
  ): Promise<void> {
    const args = [
      "api",
      `repos/${repo}/pulls/${number}/reviews`,
      "-X",
      "POST",
      "-f",
      `event=${event}`,
    ];
    if (body && body.trim()) {
      args.push("-f", `body=${body.trim()}`);
    }
    await runGhText(this.#run, args);
  }

  async #loadReviewThreadMeta(
    repo: string,
    number: number,
    warnings: string[]
  ): Promise<Array<{ nodeId: string; isResolved: boolean; rootDatabaseId: number }>> {
    const [owner, name] = repo.split("/");
    if (!owner || !name) return [];

    try {
      const result = await runGhJson<any>(this.#run, [
        "api",
        "graphql",
        "-f",
        `query=query { repository(owner: "${owner}", name: "${name}") { pullRequest(number: ${number}) { reviewThreads(first: 100) { nodes { id isResolved comments(first: 1) { nodes { databaseId } } } } } } }`,
      ]);

      const nodes = result?.data?.repository?.pullRequest?.reviewThreads?.nodes;
      if (!Array.isArray(nodes)) return [];

      const meta: Array<{ nodeId: string; isResolved: boolean; rootDatabaseId: number }> = [];
      for (const node of nodes) {
        const nodeId = String(node?.id ?? "").trim();
        const isResolved = Boolean(node?.isResolved);
        const rootDatabaseId = toInteger(node?.comments?.nodes?.[0]?.databaseId);
        if (nodeId && rootDatabaseId > 0) {
          meta.push({ nodeId, isResolved, rootDatabaseId });
        }
      }
      return meta;
    } catch (error) {
      const err = toGhCommandError(error, ["api", "graphql"]);
      if (err.code === "gh_missing" || err.code === "auth_failed") throw err;
      warnings.push(`Failed to load review thread metadata: ${shortError(err)}`);
      return [];
    }
  }

  async #loadOptionalPagedArray<T>(
    args: string[],
    label: string,
    warnings: string[]
  ): Promise<T[]> {
    try {
      return await runGhPagedJson<T>(this.#run, args);
    } catch (error) {
      const err = toGhCommandError(error, args);
      if (err.code === "gh_missing" || err.code === "auth_failed") {
        throw err;
      }
      warnings.push(`Failed to load ${label}: ${shortError(err)}`);
      return [];
    }
  }

  async #loadOptionalTimeline(
    repo: string,
    number: number,
    warnings: string[]
  ): Promise<any[]> {
    return this.#loadOptionalPagedArray<any>(
      [
        "api",
        `repos/${repo}/issues/${number}/timeline`,
        "-H",
        "Accept: application/vnd.github.mockingbird-preview+json",
      ],
      "timeline",
      warnings
    );
  }
}

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

export function normalizePullRequestChecks(input: unknown): PullRequestCheck[] {
  if (!Array.isArray(input)) return [];

  const checks: PullRequestCheck[] = [];
  for (let i = 0; i < input.length; i++) {
    const item = input[i] as Record<string, unknown>;
    const typename = String(item?.__typename ?? "").trim();

    if (typename === "CheckRun") {
      const name = String(item?.name ?? "Check run").trim() || "Check run";
      checks.push({
        id: `check_run:${name}:${i}`,
        type: "check_run",
        name,
        workflowName: asNullableString(item?.workflowName),
        status: String(item?.status ?? "UNKNOWN").toUpperCase(),
        conclusion: asNullableString(item?.conclusion)?.toUpperCase() ?? null,
        url: asNullableString(item?.detailsUrl),
        startedAt: asNullableString(item?.startedAt),
        completedAt: asNullableString(item?.completedAt),
      });
      continue;
    }

    if (typename === "StatusContext") {
      const state = String(item?.state ?? "PENDING").toUpperCase();
      checks.push({
        id: `status_context:${String(item?.context ?? "status")}:${i}`,
        type: "status_context",
        name: String(item?.context ?? "Status").trim() || "Status",
        workflowName: null,
        status: state === "PENDING" ? "IN_PROGRESS" : "COMPLETED",
        conclusion: mapStatusContextStateToConclusion(state),
        url: asNullableString(item?.targetUrl),
        startedAt: null,
        completedAt: null,
      });
      continue;
    }

    const name = String(item?.name ?? item?.context ?? "Check").trim() || "Check";
    checks.push({
      id: `other:${name}:${i}`,
      type: "other",
      name,
      workflowName: null,
      status: String(item?.status ?? item?.state ?? "UNKNOWN").toUpperCase(),
      conclusion: asNullableString(item?.conclusion),
      url: asNullableString(item?.detailsUrl ?? item?.targetUrl),
      startedAt: asNullableString(item?.startedAt),
      completedAt: asNullableString(item?.completedAt),
    });
  }

  return checks;
}

export function buildPullRequestConversation(
  issueCommentsInput: unknown,
  reviewsInput: unknown,
  reviewCommentsInput: unknown
): PullRequestConversationItem[] {
  const issueComments = Array.isArray(issueCommentsInput)
    ? issueCommentsInput as Array<Record<string, unknown>>
    : [];
  const reviews = Array.isArray(reviewsInput)
    ? reviewsInput as Array<Record<string, unknown>>
    : [];
  const reviewComments = Array.isArray(reviewCommentsInput)
    ? reviewCommentsInput as Array<Record<string, unknown>>
    : [];

  const issueItems: PullRequestConversationItem[] = issueComments.map((comment) => ({
    kind: "issue_comment",
    id: String(comment?.id ?? ""),
    authorLogin: String((comment?.user as any)?.login ?? "unknown"),
    authorAssociation: asNullableString(comment?.author_association),
    body: String(comment?.body ?? ""),
    createdAt: normalizeIso(String(comment?.created_at ?? "")),
    updatedAt: normalizeIso(String(comment?.updated_at ?? comment?.created_at ?? "")),
    url: asNullableString(comment?.html_url),
  }));

  const reviewItems: PullRequestConversationItem[] = reviews.map((review) => {
    const submittedAt = asNullableString(review?.submitted_at);
    const createdAt = normalizeIso(
      submittedAt ?? String(review?.submitted_at ?? review?.submittedAt ?? "")
    );
    return {
      kind: "review",
      id: String(review?.id ?? ""),
      authorLogin: String((review?.user as any)?.login ?? "unknown"),
      authorAssociation: asNullableString(review?.author_association),
      state: String(review?.state ?? "COMMENTED"),
      body: String(review?.body ?? ""),
      commitSha: asNullableString(review?.commit_id),
      createdAt,
      submittedAt,
    };
  });

  const threadItems = buildReviewThreads(reviewComments);

  const items = [...issueItems, ...reviewItems, ...threadItems];
  items.sort((a, b) => {
    const tsA = Date.parse(a.createdAt);
    const tsB = Date.parse(b.createdAt);
    if (Number.isFinite(tsA) && Number.isFinite(tsB) && tsA !== tsB) {
      return tsA - tsB;
    }
    return a.id.localeCompare(b.id);
  });
  return items;
}

const TIMELINE_EVENT_TYPES = new Set<PullRequestTimelineEventType>([
  "committed",
  "force_pushed",
  "labeled",
  "unlabeled",
  "review_requested",
  "review_request_removed",
  "merged",
  "closed",
  "reopened",
  "convert_to_draft",
  "ready_for_review",
  "assigned",
  "unassigned",
]);

// Maps GitHub timeline event names to our normalized event type
const TIMELINE_EVENT_MAP: Record<string, PullRequestTimelineEventType> = {
  committed: "committed",
  force_pushed: "force_pushed",
  labeled: "labeled",
  unlabeled: "unlabeled",
  review_requested: "review_requested",
  review_request_removed: "review_request_removed",
  merged: "merged",
  closed: "closed",
  reopened: "reopened",
  convert_to_draft: "convert_to_draft",
  ready_for_review: "ready_for_review",
  assigned: "assigned",
  unassigned: "unassigned",
};

export function normalizeTimelineEvents(
  input: unknown[]
): PullRequestTimelineEvent[] {
  if (!Array.isArray(input)) return [];

  const events: PullRequestTimelineEvent[] = [];
  for (let i = 0; i < input.length; i++) {
    const raw = input[i] as Record<string, unknown>;
    if (!raw || typeof raw !== "object") continue;

    const eventName = String(raw?.event ?? "").toLowerCase();
    const mappedType = TIMELINE_EVENT_MAP[eventName];
    if (!mappedType) continue;

    // For "committed" events, the shape is different (it's a commit object, not an event object)
    const isCommit = mappedType === "committed";
    const actor = isCommit
      ? (raw?.author as any)?.login ?? (raw?.committer as any)?.login ?? ""
      : (raw?.actor as any)?.login ?? "";
    const createdAtRaw = isCommit
      ? String((raw?.author as any)?.date ?? (raw?.committer as any)?.date ?? raw?.created_at ?? "")
      : String(raw?.created_at ?? "");

    const detail: Record<string, unknown> = {};
    if (mappedType === "committed") {
      detail.sha = String(raw?.sha ?? "").trim();
      detail.shortSha = String(raw?.sha ?? "").trim().slice(0, 7);
      detail.message = String((raw?.message ?? "")).trim();
      detail.url = String(raw?.html_url ?? "").trim();
    } else if (mappedType === "labeled" || mappedType === "unlabeled") {
      detail.labelName = String((raw?.label as any)?.name ?? "");
      detail.labelColor = String((raw?.label as any)?.color ?? "");
    } else if (mappedType === "assigned" || mappedType === "unassigned") {
      detail.assigneeLogin = String((raw?.assignee as any)?.login ?? "");
    } else if (mappedType === "review_requested" || mappedType === "review_request_removed") {
      detail.reviewerLogin = String((raw?.requested_reviewer as any)?.login ?? "");
    } else if (mappedType === "force_pushed") {
      detail.beforeSha = String(raw?.before ?? "").trim().slice(0, 7);
      detail.afterSha = String(raw?.after ?? "").trim().slice(0, 7);
    }

    events.push({
      kind: "timeline_event",
      id: `timeline-${mappedType}-${i}`,
      eventType: mappedType,
      actorLogin: String(actor).trim() || "unknown",
      createdAt: normalizeIso(createdAtRaw),
      detail,
    });
  }

  return events;
}

export function buildPullRequestTimeline(
  conversation: PullRequestConversationItem[],
  timelineEvents: PullRequestTimelineEvent[],
  rawTimeline: unknown[]
): PullRequestTimelineItem[] {
  // Build an order index from the raw timeline API response.
  // The timeline API returns events in the exact order GitHub displays them,
  // so we use position in that array as the canonical sort key.
  const orderMap = buildTimelineOrderMap(rawTimeline);

  const items: PullRequestTimelineItem[] = [
    ...conversation,
    ...timelineEvents,
  ];

  items.sort((a, b) => {
    const orderA = getTimelineOrder(a, orderMap);
    const orderB = getTimelineOrder(b, orderMap);
    if (orderA !== orderB) return orderA - orderB;
    // Fallback to timestamp
    const tsA = Date.parse(a.createdAt);
    const tsB = Date.parse(b.createdAt);
    if (Number.isFinite(tsA) && Number.isFinite(tsB) && tsA !== tsB) {
      return tsA - tsB;
    }
    return 0;
  });

  return items;
}

/**
 * Build a map from identifying keys to their position in the raw timeline.
 * This covers: review IDs, comment IDs (for threads), and timeline event IDs.
 */
function buildTimelineOrderMap(rawTimeline: unknown[]): Map<string, number> {
  const map = new Map<string, number>();
  if (!Array.isArray(rawTimeline)) return map;

  for (let i = 0; i < rawTimeline.length; i++) {
    const raw = rawTimeline[i] as Record<string, unknown>;
    if (!raw || typeof raw !== "object") continue;

    const event = String(raw?.event ?? "");
    const id = raw?.id;

    // "reviewed" events → keyed by review ID
    if (event === "reviewed" && id) {
      map.set(`review:${id}`, i);
    }
    // "commented" events → keyed by comment ID (issue comments)
    else if (event === "commented" && id) {
      map.set(`issue_comment:${id}`, i);
    }
    // committed events → keyed by sha
    else if (event === "committed") {
      const sha = String(raw?.sha ?? "");
      if (sha) map.set(`committed:${sha}`, i);
    }
    // All other events get mapped by their position ID
    if (id) {
      map.set(`event:${id}`, i);
    }
  }

  return map;
}

function getTimelineOrder(item: PullRequestTimelineItem, orderMap: Map<string, number>): number {
  const FALLBACK = 999999;

  if (item.kind === "timeline_event") {
    if (item.eventType === "committed") {
      const sha = String(item.detail.sha ?? "");
      return orderMap.get(`committed:${sha}`) ?? FALLBACK;
    }
    // Other timeline events: look up by their event ID (stored in the id field as timeline-{type}-{index})
    // The index at the end of the id corresponds to the raw timeline position
    const match = item.id.match(/^timeline-\w+-(\d+)$/);
    if (match) return Number(match[1]);
    return FALLBACK;
  }

  if (item.kind === "review") {
    return orderMap.get(`review:${item.id}`) ?? FALLBACK;
  }

  if (item.kind === "issue_comment") {
    return orderMap.get(`issue_comment:${item.id}`) ?? FALLBACK;
  }

  if (item.kind === "review_thread") {
    // A review thread's position = the position of its parent review in the timeline.
    // The first comment's reviewId links to the review that contains this thread.
    for (const comment of item.comments) {
      if (comment.reviewId) {
        const order = orderMap.get(`review:${comment.reviewId}`);
        if (order != null) return order + 0.5; // Sort just after the review itself
      }
    }
    return FALLBACK;
  }

  return FALLBACK;
}

function buildReviewThreads(
  input: Array<Record<string, unknown>>
): PullRequestReviewThread[] {
  const commentsById = new Map<number, Record<string, unknown>>();
  for (const comment of input) {
    const id = toInteger(comment?.id);
    if (id > 0) {
      commentsById.set(id, comment);
    }
  }

  const rootCache = new Map<number, number>();
  const resolveRootId = (id: number): number => {
    if (rootCache.has(id)) return rootCache.get(id)!;
    let current = id;
    const seen = new Set<number>();

    while (true) {
      if (seen.has(current)) break;
      seen.add(current);

      const comment = commentsById.get(current);
      if (!comment) break;
      const parentId = toInteger(comment?.in_reply_to_id);
      if (parentId <= 0 || !commentsById.has(parentId)) break;
      current = parentId;
    }

    rootCache.set(id, current);
    return current;
  };

  const grouped = new Map<number, PullRequestReviewThreadComment[]>();
  for (const comment of input) {
    const id = toInteger(comment?.id);
    if (id <= 0) continue;
    const rootId = resolveRootId(id);

    const mapped: PullRequestReviewThreadComment = {
      id: String(id),
      reviewId: asNullableString(comment?.pull_request_review_id),
      authorLogin: String((comment?.user as any)?.login ?? "unknown"),
      authorAssociation: asNullableString(comment?.author_association),
      body: String(comment?.body ?? ""),
      path: String(comment?.path ?? ""),
      line: asNullableInteger(comment?.line),
      originalLine: asNullableInteger(comment?.original_line),
      side: asNullableString(comment?.side),
      commitSha: asNullableString(comment?.commit_id),
      createdAt: normalizeIso(String(comment?.created_at ?? "")),
      updatedAt: normalizeIso(String(comment?.updated_at ?? comment?.created_at ?? "")),
      inReplyToId: asNullableString(comment?.in_reply_to_id),
    };

    const list = grouped.get(rootId) ?? [];
    list.push(mapped);
    grouped.set(rootId, list);
  }

  const threads: PullRequestReviewThread[] = [];
  for (const [rootId, comments] of grouped) {
    if (comments.length === 0) continue;
    comments.sort((a, b) => {
      const tsA = Date.parse(a.createdAt);
      const tsB = Date.parse(b.createdAt);
      if (Number.isFinite(tsA) && Number.isFinite(tsB) && tsA !== tsB) {
        return tsA - tsB;
      }
      return a.id.localeCompare(b.id);
    });

    const root = comments[0];
    threads.push({
      kind: "review_thread",
      id: `thread-${rootId}`,
      nodeId: null,
      path: root.path,
      line: root.line,
      originalLine: root.originalLine,
      side: root.side,
      isResolved: null,
      createdAt: root.createdAt,
      updatedAt: comments[comments.length - 1].updatedAt,
      comments,
    });
  }

  return threads;
}

function normalizePullRequestCommits(input: unknown): PullRequestCommit[] {
  if (!Array.isArray(input)) return [];

  return input.map((entry) => {
    const item = entry as Record<string, unknown>;
    const authors = Array.isArray(item?.authors)
      ? item.authors as Array<Record<string, unknown>>
      : [];
    const firstAuthor = authors[0] ?? {};
    const sha = String(item?.oid ?? "").trim();

    return {
      sha,
      shortSha: sha.slice(0, 7),
      messageHeadline: String(item?.messageHeadline ?? "(no subject)").trim() || "(no subject)",
      messageBody: String(item?.messageBody ?? ""),
      authoredDate: normalizeIso(String(item?.authoredDate ?? "")),
      committedDate: normalizeIso(String(item?.committedDate ?? "")),
      authorLogin: String(firstAuthor?.login ?? "").trim(),
      authorName: String(firstAuthor?.name ?? "").trim(),
    };
  }).filter((entry) => entry.sha.length > 0);
}

function normalizePullRequestFiles(input: unknown): PullRequestFileMeta[] {
  if (!Array.isArray(input)) return [];

  const files: PullRequestFileMeta[] = [];
  for (const entry of input) {
    const item = entry as Record<string, unknown>;
    const path = String(item?.filename ?? "").trim();
    if (!path) continue;

    files.push({
      path,
      previousPath: asNullableString(item?.previous_filename),
      status: normalizeFileStatus(item?.status),
      additions: Math.max(0, toInteger(item?.additions)),
      deletions: Math.max(0, toInteger(item?.deletions)),
      sha: asNullableString(item?.sha),
    });
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  return files;
}

function normalizeFileStatus(value: unknown): FileStatus {
  const status = String(value ?? "").toLowerCase();
  if (status === "added") return "added";
  if (status === "removed") return "deleted";
  if (status === "deleted") return "deleted";
  if (status === "renamed") return "renamed";
  return "modified";
}

function mapStatusContextStateToConclusion(state: string): string | null {
  if (state === "SUCCESS") return "SUCCESS";
  if (state === "FAILURE") return "FAILURE";
  if (state === "ERROR") return "FAILURE";
  if (state === "PENDING") return null;
  return state;
}

function toInteger(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  const next = Number(value);
  return Number.isFinite(next) ? Math.trunc(next) : 0;
}

function asNullableInteger(value: unknown): number | null {
  const next = Number(value);
  if (!Number.isFinite(next)) return null;
  return Math.trunc(next);
}

function asNullableString(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

function normalizeIso(value: string): string {
  const text = String(value ?? "").trim();
  const ts = Date.parse(text);
  if (!Number.isFinite(ts)) {
    return new Date(0).toISOString();
  }
  return new Date(ts).toISOString();
}
