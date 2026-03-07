// Diff Panel — shows full diff content using UIDiffRenderer in the second panel slot

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  useInstrumentApi,
  useHostEvent,
  UIRoot,
  UIEmptyState,
  UIDiffRenderer,
  UISegmentedControl,
  UIIconButton,
  useDiffComments,
  type DiffViewMode,
  type DiffCommentThread,
  type DiffLineAddress,
} from "tango-api";
import type { DiffFile, PullRequestDetail, PullRequestReviewThread } from "../types.ts";
import { DiffFilesSidebar } from "./DiffFilesSidebar.tsx";
import { DiffCommitsSidebar } from "./DiffCommitsSidebar.tsx";

type SelectedPR = { repo: string; number: number } | null;
type SidebarPanel = "files" | "commits" | null;

// Inline SVGs — not available in tango-api icon set
const FolderIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
);

/** Extract extension from a file path (e.g. ".ts"), or "(no ext)" */
function getExtension(path: string): string {
  const dot = path.lastIndexOf(".");
  if (dot === -1 || dot === path.length - 1) return "(no ext)";
  return path.slice(dot);
}

/** Build a map of extension → file count */
function buildExtensionMap(files: DiffFile[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const f of files) {
    const ext = getExtension(f.path);
    map.set(ext, (map.get(ext) ?? 0) + 1);
  }
  return map;
}

/** Map PR review threads to DiffCommentThread[] for useDiffComments. */
function mapReviewThreads(detail: PullRequestDetail | null): DiffCommentThread[] {
  if (!detail) return [];

  const threads: DiffCommentThread[] = [];

  for (const item of detail.conversation) {
    if (item.kind !== "review_thread") continue;
    const thread = item as PullRequestReviewThread;

    // Skip threads without a valid line anchor
    const lineNumber = thread.line ?? thread.originalLine;
    if (!lineNumber || !thread.path) continue;

    threads.push({
      id: thread.id,
      address: {
        filePath: thread.path,
        side: thread.side === "LEFT" ? "old" : "new",
        lineNumber,
      },
      comments: thread.comments.map((c) => ({
        id: c.id,
        authorLogin: c.authorLogin,
        body: c.body,
        createdAt: c.createdAt,
      })),
      isResolved: thread.isResolved ?? false,
    });
  }

  return threads;
}

/** Custom toolbar replacing UIDiffRenderer's built-in toolbar */
function DiffToolbarCustom({
  fileCount,
  viewMode,
  onViewModeChange,
  activeSidebar,
  onToggleSidebar,
}: {
  fileCount: number;
  viewMode: DiffViewMode;
  onViewModeChange: (mode: DiffViewMode) => void;
  activeSidebar: SidebarPanel;
  onToggleSidebar: (panel: "files" | "commits") => void;
}) {
  return (
    <div className="tui-diff-toolbar">
      <span className="tui-diff-toolbar-label">
        {fileCount} file{fileCount !== 1 ? "s" : ""} changed
      </span>
      <div className="tui-diff-toolbar-actions" style={{ gap: 6, alignItems: "center" }}>
        <UISegmentedControl
          value={viewMode}
          options={[
            { value: "unified", label: "Unified" },
            { value: "split", label: "Split" },
          ]}
          onChange={(v) => onViewModeChange(v as DiffViewMode)}
        />
        <UIIconButton
          icon={FolderIcon}
          label="Files"
          title="Browse files"
          variant="ghost"
          size="sm"
          active={activeSidebar === "files"}
          onClick={() => onToggleSidebar("files")}
        />
        <UIIconButton
          icon="branch"
          label="Commits"
          title="Filter by commit"
          variant="ghost"
          size="sm"
          active={activeSidebar === "commits"}
          onClick={() => onToggleSidebar("commits")}
        />
      </div>
    </div>
  );
}

export function DiffPanel() {
  const api = useInstrumentApi();
  const [selected, setSelected] = useState<SelectedPR>(null);
  const [files, setFiles] = useState<DiffFile[]>([]);
  const [detail, setDetail] = useState<PullRequestDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<DiffViewMode>("unified");
  const [selectedCommit, setSelectedCommit] = useState<string>("all");
  const [activeSidebar, setActiveSidebar] = useState<SidebarPanel>(null);
  const [enabledExtensions, setEnabledExtensions] = useState<Set<string>>(new Set());

  // Extension filtering — owned here so toolbar popover and sidebar both reflect it
  const extensionMap = useMemo(() => buildExtensionMap(files), [files]);
  const allExtensions = useMemo(() => [...extensionMap.keys()].sort(), [extensionMap]);

  // Reset extension filters when file list changes (new PR or commit filter)
  useEffect(() => {
    setEnabledExtensions(new Set(allExtensions));
  }, [allExtensions]);

  const filteredFiles = useMemo(() => {
    if (enabledExtensions.size === allExtensions.length) return files;
    return files.filter((f) => enabledExtensions.has(getExtension(f.path)));
  }, [files, enabledExtensions, allExtensions.length]);

  const isFiltering = enabledExtensions.size < allExtensions.length;

  const handleToggleExtension = useCallback((ext: string, checked: boolean) => {
    setEnabledExtensions((prev) => {
      const next = new Set(prev);
      if (checked) next.add(ext);
      else next.delete(ext);
      return next;
    });
  }, []);

  // Listen for PR selection from sidebar
  useHostEvent("instrument.event", (payload: any) => {
    if (payload?.event === "pr.selected" && payload?.payload) {
      const { repo, number } = payload.payload as { repo: string; number: number };
      setSelected({ repo, number });
      setActiveFile(null);
      setSelectedCommit("all");
      setActiveSidebar(null);
      setExpandedFiles(undefined);
    }
  });

  // Listen for file selection from FilesChangedTab
  useHostEvent("instrument.event", (payload: any) => {
    if (payload?.event === "pr.fileSelected" && payload?.payload) {
      const { path } = payload.payload as { path: string };
      setActiveFile(path);
    }
  });

  const loadData = useCallback(async (repo: string, number: number) => {
    setLoading(true);
    setError(null);
    try {
      const [diffResult, detailResult] = await Promise.all([
        api.actions.call<{ repo: string; number: number }, DiffFile[]>(
          "getPullRequestDiff",
          { repo, number }
        ),
        api.actions.call<{ repo: string; number: number }, PullRequestDetail>(
          "getPullRequestDetail",
          { repo, number }
        ),
      ]);
      setFiles(diffResult);
      setDetail(detailResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (!selected) return;
    loadData(selected.repo, selected.number);
  }, [selected, loadData]);

  // Re-fetch diff when commit filter changes
  const handleCommitFilterChange = useCallback(async (commitValue: string) => {
    setSelectedCommit(commitValue);
    if (!selected) return;
    const params: { repo: string; number: number; commitSha?: string } = {
      repo: selected.repo,
      number: selected.number,
    };
    if (commitValue !== "all") params.commitSha = commitValue;
    const diffResult = await api.actions.call<typeof params, DiffFile[]>(
      "getPullRequestDiff",
      params,
    );
    setFiles(diffResult);
    setExpandedFiles(undefined);
  }, [api, selected]);

  // Reload detail only (after comment changes) without resetting diff
  const reloadDetail = useCallback(async () => {
    if (!selected) return;
    try {
      const detailResult = await api.actions.call<{ repo: string; number: number }, PullRequestDetail>(
        "getPullRequestDetail",
        { repo: selected.repo, number: selected.number }
      );
      setDetail(detailResult);
    } catch {
      // Non-critical — comment was already posted
    }
  }, [api, selected]);

  // Create a new review comment on a diff line
  const handleCreateComment = useCallback(async (address: DiffLineAddress, body: string) => {
    if (!selected || !detail) return;

    await api.actions.call("createReviewComment", {
      repo: selected.repo,
      number: selected.number,
      commitSha: detail.headSha,
      path: address.filePath,
      line: address.lineNumber,
      side: address.side === "old" ? "LEFT" : "RIGHT",
      body,
    });

    api.emit({
      event: "diff.newComment",
      payload: {
        repo: selected.repo,
        number: selected.number,
        path: address.filePath,
        line: address.lineNumber,
        side: address.side,
        body,
      },
    });

    await reloadDetail();
  }, [api, selected, detail, reloadDetail]);

  // Reply to an existing review thread
  const handleReplyThread = useCallback(async (threadId: string, body: string) => {
    if (!selected) return;

    // Thread ID format is "thread-{rootCommentId}"
    const commentId = threadId.replace(/^thread-/, "");

    await api.actions.call("replyReviewComment", {
      repo: selected.repo,
      number: selected.number,
      commentId,
      body,
    });

    api.emit({
      event: "diff.replyComment",
      payload: {
        repo: selected.repo,
        number: selected.number,
        threadId,
        body,
      },
    });

    await reloadDetail();
  }, [api, selected, reloadDetail]);

  const commentThreads = useMemo(() => mapReviewThreads(detail), [detail]);

  // Build threadId → nodeId lookup for resolve/unresolve
  const threadNodeIds = useMemo(() => {
    if (!detail) return new Map<string, string>();
    const map = new Map<string, string>();
    for (const item of detail.conversation) {
      if (item.kind !== "review_thread") continue;
      const thread = item as PullRequestReviewThread;
      if (thread.nodeId) {
        map.set(thread.id, thread.nodeId);
      }
    }
    return map;
  }, [detail]);

  const handleResolveThread = useCallback(async (threadId: string) => {
    const nodeId = threadNodeIds.get(threadId);
    if (!nodeId) return;

    await api.actions.call("resolveReviewThread", { nodeId });
    await reloadDetail();
  }, [api, threadNodeIds, reloadDetail]);

  const handleUnresolveThread = useCallback(async (threadId: string) => {
    const nodeId = threadNodeIds.get(threadId);
    if (!nodeId) return;

    await api.actions.call("unresolveReviewThread", { nodeId });
    await reloadDetail();
  }, [api, threadNodeIds, reloadDetail]);

  const { addon: commentsAddon } = useDiffComments({
    threads: commentThreads,
    onCreateComment: handleCreateComment,
    onReplyThread: handleReplyThread,
    onResolveThread: handleResolveThread,
    onUnresolveThread: handleUnresolveThread,
  });

  // Sidebar toggle — mutually exclusive
  const handleToggleSidebar = useCallback((panel: "files" | "commits") => {
    setActiveSidebar((prev) => (prev === panel ? null : panel));
  }, []);

  // Controlled expand state for diff files. Starts undefined (auto mode).
  const [expandedFiles, setExpandedFiles] = useState<Set<string> | undefined>(undefined);

  const handleToggleFile = useCallback((filePath: string, expanded: boolean) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (expanded) next.add(filePath);
      else next.delete(filePath);
      return next;
    });
  }, []);

  // Handle file click from sidebar — toggle expand/collapse in the diff
  const handleSidebarFileClick = useCallback((path: string) => {
    setActiveFile(path);
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  if (!selected) {
    return (
      <UIRoot>
        <UIEmptyState title="Select a pull request" description="Pick a PR from the sidebar to view the diff." />
      </UIRoot>
    );
  }

  if (loading) {
    return (
      <UIRoot>
        <UIEmptyState title="Loading diff..." />
      </UIRoot>
    );
  }

  if (error) {
    return (
      <UIRoot>
        <UIEmptyState title="Error" description={error} />
      </UIRoot>
    );
  }

  if (files.length === 0) {
    return (
      <UIRoot>
        <UIEmptyState title="No changes" description="This pull request has no file changes." />
      </UIRoot>
    );
  }

  return (
    <UIRoot fixed>
      <DiffToolbarCustom
          fileCount={filteredFiles.length}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          activeSidebar={activeSidebar}
          onToggleSidebar={handleToggleSidebar}
        />
        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
          <div style={{ flex: 1, overflowY: "auto", padding: "0 16px" }}>
            <UIDiffRenderer
              files={filteredFiles}
              activeFile={activeFile}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
              showToolbar={false}
              addons={[commentsAddon]}
              expandedFiles={expandedFiles}
              onToggleFile={handleToggleFile}
            />
          </div>
          {activeSidebar === "files" && (
            <DiffFilesSidebar
              files={filteredFiles}
              activeFile={activeFile}
              onFileClick={handleSidebarFileClick}
              extensionMap={extensionMap}
              enabledExtensions={enabledExtensions}
              onToggleExtension={handleToggleExtension}
              isFiltering={isFiltering}
            />
          )}
          {activeSidebar === "commits" && detail && (
            <DiffCommitsSidebar
              commits={detail.commits}
              selectedCommit={selectedCommit}
              onSelectCommit={handleCommitFilterChange}
            />
          )}
        </div>
    </UIRoot>
  );
}
