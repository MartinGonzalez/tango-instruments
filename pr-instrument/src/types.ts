// Standalone PR types — ported from desktop/src/shared/types/pull-requests.ts
// and desktop/src/shared/types/diff.ts with DiffFile["status"] inlined.

// ---------------------------------------------------------------------------
// Diff types
// ---------------------------------------------------------------------------

export type FileStatus = "added" | "deleted" | "modified" | "renamed";

export type DiffFile = {
  path: string;
  oldPath: string | null;
  status: FileStatus;
  hunks: DiffHunk[];
  isBinary: boolean;
};

export type DiffHunk = {
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
};

export type DiffLine = {
  type: "add" | "delete" | "context";
  content: string;
  oldLineNo: number | null;
  newLineNo: number | null;
};

// ---------------------------------------------------------------------------
// Pull Request types
// ---------------------------------------------------------------------------

export type PullRequestSummary = {
  repo: string;
  number: number;
  title: string;
  authorLogin: string;
  authorIsBot: boolean;
  isDraft: boolean;
  updatedAt: string;
  url: string;
};

export type PullRequestCheckType = "check_run" | "status_context" | "other";

export type PullRequestCheck = {
  id: string;
  type: PullRequestCheckType;
  name: string;
  workflowName: string | null;
  status: string;
  conclusion: string | null;
  url: string | null;
  startedAt: string | null;
  completedAt: string | null;
};

export type PullRequestCommit = {
  sha: string;
  shortSha: string;
  messageHeadline: string;
  messageBody: string;
  authoredDate: string;
  committedDate: string;
  authorLogin: string;
  authorName: string;
};

export type PullRequestFileMeta = {
  path: string;
  previousPath: string | null;
  status: FileStatus;
  additions: number;
  deletions: number;
  sha: string | null;
};

export type PullRequestIssueComment = {
  kind: "issue_comment";
  id: string;
  authorLogin: string;
  authorAssociation: string | null;
  body: string;
  createdAt: string;
  updatedAt: string;
  url: string | null;
};

export type PullRequestReviewEvent = {
  kind: "review";
  id: string;
  authorLogin: string;
  authorAssociation: string | null;
  state: string;
  body: string;
  commitSha: string | null;
  createdAt: string;
  submittedAt: string | null;
};

export type PullRequestReviewThreadComment = {
  id: string;
  reviewId: string | null;
  authorLogin: string;
  authorAssociation: string | null;
  body: string;
  path: string;
  line: number | null;
  originalLine: number | null;
  side: string | null;
  commitSha: string | null;
  createdAt: string;
  updatedAt: string;
  inReplyToId: string | null;
};

export type PullRequestReviewThread = {
  kind: "review_thread";
  id: string;
  nodeId: string | null;
  path: string;
  line: number | null;
  originalLine: number | null;
  side: string | null;
  isResolved: boolean | null;
  createdAt: string;
  updatedAt: string;
  comments: PullRequestReviewThreadComment[];
};

export type PullRequestConversationItem =
  | PullRequestIssueComment
  | PullRequestReviewEvent
  | PullRequestReviewThread;

export type PullRequestTimelineEventType =
  | "committed"
  | "force_pushed"
  | "labeled"
  | "unlabeled"
  | "review_requested"
  | "review_request_removed"
  | "merged"
  | "closed"
  | "reopened"
  | "convert_to_draft"
  | "ready_for_review"
  | "assigned"
  | "unassigned";

export type PullRequestTimelineEvent = {
  kind: "timeline_event";
  id: string;
  eventType: PullRequestTimelineEventType;
  actorLogin: string;
  createdAt: string;
  detail: Record<string, unknown>;
};

export type PullRequestTimelineItem =
  | PullRequestConversationItem
  | PullRequestTimelineEvent;

export type PullRequestDetail = {
  repo: string;
  number: number;
  title: string;
  body: string;
  url: string;
  state: string;
  isDraft: boolean;
  authorLogin: string;
  authorName: string;
  authorIsBot: boolean;
  baseRefName: string;
  headRefName: string;
  headSha: string;
  reviewDecision: string | null;
  mergeStateStatus: string | null;
  createdAt: string;
  updatedAt: string;
  checks: PullRequestCheck[];
  commits: PullRequestCommit[];
  files: PullRequestFileMeta[];
  conversation: PullRequestConversationItem[];
  timeline: PullRequestTimelineItem[];
  warnings: string[];
};

export type PullRequestReviewState = {
  repo: string;
  number: number;
  reviewedHeadSha: string | null;
  viewedFiles: Record<string, { sha: string | null; seenAt: string }>;
  updatedAt: string;
};

// ---------------------------------------------------------------------------
// Agent Review types
// ---------------------------------------------------------------------------

export type PullRequestAgentReviewStatus =
  | "running"
  | "completed"
  | "failed"
  | "stale";

export type PullRequestAgentReviewLevel =
  | "Low"
  | "Medium"
  | "Important"
  | "Critical";

export type PullRequestAgentReviewSuggestion = {
  level: PullRequestAgentReviewLevel;
  title: string;
  reason: string;
  solutions: string;
  benefit: string;
  content: string;
  applied: boolean;
};

export type PullRequestAgentReviewData = {
  metadata: Record<string, string>;
  pr_description: string;
  pr_summary: string;
  strengths: string;
  improvements: string;
  suggestions: PullRequestAgentReviewSuggestion[];
  final_veredic: string;
};

export type PullRequestAgentReviewRun = {
  id: string;
  repo: string;
  number: number;
  version: number;
  fileName: string;
  filePath: string;
  headSha: string;
  status: PullRequestAgentReviewStatus;
  sessionId: string | null;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  error: string | null;
};

export type PullRequestAgentReviewDocument = {
  run: PullRequestAgentReviewRun;
  rawJson: string;
  review: PullRequestAgentReviewData | null;
  renderedMarkdown: string;
  parseError: string | null;
};

// ---------------------------------------------------------------------------
// File review state (from pr-file-review)
// ---------------------------------------------------------------------------

export type PullRequestFileAttention = "new" | "updated" | null;

export type PullRequestFileReviewState = {
  seen: boolean;
  attention: PullRequestFileAttention;
};
