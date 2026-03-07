// PR file review state computation — ported from desktop/src/mainview/lib/pr-file-review.ts

import type {
  PullRequestFileAttention,
  PullRequestFileMeta,
  PullRequestFileReviewState,
  PullRequestReviewState,
} from "../types.ts";

export function buildPullRequestFileReviewStateMap(
  files: PullRequestFileMeta[],
  reviewState: PullRequestReviewState | null,
  headSha: string
): Map<string, PullRequestFileReviewState> {
  const out = new Map<string, PullRequestFileReviewState>();
  const viewed = reviewState?.viewedFiles ?? {};
  const hasHeadChange = Boolean(
    reviewState?.reviewedHeadSha
      && headSha
      && reviewState.reviewedHeadSha !== headSha
  );

  for (const file of files) {
    const previous = viewed[file.path] ?? null;
    const matchesSha = previous?.sha === file.sha;
    let seen = Boolean(previous && matchesSha);
    let attention: PullRequestFileAttention = null;

    if (!matchesSha) {
      seen = false;
    }

    if (hasHeadChange) {
      if (!previous) {
        attention = "new";
      } else if (previous.sha !== file.sha) {
        attention = "updated";
      }
    }

    out.set(file.path, { seen, attention });
  }

  return out;
}

export function countSeenFiles(
  reviewMap: Map<string, PullRequestFileReviewState>
): number {
  let count = 0;
  for (const state of reviewMap.values()) {
    if (state.seen) count++;
  }
  return count;
}
