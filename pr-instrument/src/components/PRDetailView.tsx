// PR Detail View — container with tabs for Conversation / Files Changed / Agent Reviews

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  useInstrumentApi,
  useHostEvent,
  UIRoot,
  UIScrollArea,
  UIFooter,
  UITabs,
  UIButton,
  UIEmptyState,
  UIContainer,
  UIIconButton,
  UIIcon,
  type InstrumentFrontendAPI,
} from "tango-api";
import type {
  PullRequestDetail,
  PullRequestReviewState,
  PullRequestAgentReviewRun,
  PullRequestAgentReviewDocument,
  PullRequestFileReviewState,
  DiffFile,
} from "../types.ts";
import { buildPullRequestFileReviewStateMap, countSeenFiles } from "../lib/pr-file-review.ts";
import { ConversationTabContainerContent, ConversationTabComments } from "./ConversationTab.tsx";

import { AgentReviewsTab } from "./AgentReviewsTab.tsx";
import { ReviewActionBar } from "./ReviewActionBar.tsx";

type SelectedPR = { repo: string; number: number } | null;

export function PRDetailView() {
  const api = useInstrumentApi();
  const [selected, setSelected] = useState<SelectedPR>(null);
  const [detail, setDetail] = useState<PullRequestDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewState, setReviewState] = useState<PullRequestReviewState | null>(null);
  const [agentReviews, setAgentReviews] = useState<PullRequestAgentReviewRun[]>([]);
  const [currentUser, setCurrentUser] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>("conversation");
  const [agentReviewStarting, setAgentReviewStarting] = useState(false);
  const [agentReviewError, setAgentReviewError] = useState<string | null>(null);

  // Editable title state
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [savingTitle, setSavingTitle] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Listen for PR selection from sidebar
  useHostEvent("instrument.event", (payload: any) => {
    if (payload?.event === "pr.selected" && payload?.payload) {
      const { repo, number } = payload.payload as { repo: string; number: number };
      setSelected({ repo, number });
      setActiveTab("conversation");
      setAgentReviewError(null);
    }
  });

  // Listen for agent review changes
  useHostEvent("instrument.event", (payload: any) => {
    if (payload?.event === "pr.agentReviewChanged" && selected) {
      const { repo, number } = payload.payload as { repo: string; number: number };
      if (repo === selected.repo && number === selected.number) {
        loadAgentReviews(selected.repo, selected.number);
      }
    }
  });

  const loadDetail = useCallback(async (repo: string, number: number, forceRefresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const [detailResult, reviewResult, reviewsResult] = await Promise.all([
        api.actions.call<{ repo: string; number: number; forceRefresh?: boolean }, PullRequestDetail>(
          "getPullRequestDetail",
          { repo, number, forceRefresh }
        ),
        api.actions.call<{ repo: string; number: number }, PullRequestReviewState | null>(
          "getReviewState",
          { repo, number }
        ),
        api.actions.call<{ repo: string; number: number }, PullRequestAgentReviewRun[]>(
          "listAgentReviews",
          { repo, number }
        ),
      ]);
      setDetail(detailResult);
      setReviewState(reviewResult);
      setAgentReviews(reviewsResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [api]);

  const loadAgentReviews = useCallback(async (repo: string, number: number) => {
    try {
      const runs = await api.actions.call<
        { repo: string; number: number },
        PullRequestAgentReviewRun[]
      >("listAgentReviews", { repo, number });
      setAgentReviews(runs);
    } catch {
      // Silently ignore — non-critical
    }
  }, [api]);

  useEffect(() => {
    if (!selected) return;
    loadDetail(selected.repo, selected.number, false);
  }, [selected, loadDetail]);

  useEffect(() => {
    api.actions.call<{}, { login: string }>("getCurrentUser", {}).then(
      (result) => setCurrentUser(result.login),
      () => {},
    );
  }, [api]);

  const handleToggleFileSeen = useCallback(async (
    filePath: string,
    seen: boolean
  ) => {
    if (!detail || !selected) return;
    const file = detail.files.find((f) => f.path === filePath);
    try {
      const newState = await api.actions.call<any, PullRequestReviewState>("setFileSeen", {
        repo: selected.repo,
        number: selected.number,
        headSha: detail.headSha,
        filePath,
        fileSha: file?.sha ?? null,
        seen,
      });
      setReviewState(newState);
    } catch {
      // Silently ignore
    }
  }, [api, detail, selected]);

  const handleFileClick = useCallback((path: string) => {
    api.emit({ event: "pr.fileSelected", payload: { path } });
  }, [api]);

  const handleStartAgentReview = useCallback(async () => {
    if (!detail || !selected) return;
    setAgentReviewStarting(true);
    setAgentReviewError(null);
    try {
      await api.actions.call("startAgentReview", {
        repo: selected.repo,
        number: selected.number,
        headSha: detail.headSha,
      });
      await loadAgentReviews(selected.repo, selected.number);
      setActiveTab("agent_reviews");
    } catch (err) {
      setAgentReviewError(err instanceof Error ? err.message : String(err));
    } finally {
      setAgentReviewStarting(false);
    }
  }, [api, detail, selected, loadAgentReviews]);

  const handleStartEditTitle = useCallback(() => {
    if (!detail) return;
    setTitleDraft(detail.title);
    setEditingTitle(true);
    setTimeout(() => titleInputRef.current?.focus(), 0);
  }, [detail]);

  const handleSaveTitle = useCallback(async () => {
    const trimmed = titleDraft.trim();
    if (!trimmed || !selected || savingTitle) return;
    setSavingTitle(true);
    try {
      await api.actions.call("updatePullRequest", {
        repo: selected.repo,
        number: selected.number,
        title: trimmed,
      });
      setEditingTitle(false);
      loadDetail(selected.repo, selected.number, true);
    } catch {
      // Keep editor open so user can retry
    } finally {
      setSavingTitle(false);
    }
  }, [api, selected, titleDraft, savingTitle, loadDetail]);

  const handleCancelEditTitle = useCallback(() => {
    setEditingTitle(false);
  }, []);

  if (!selected) {
    return (
      <UIRoot>
        <UIEmptyState title="Select a pull request" description="Pick a PR from the sidebar to view details." />
      </UIRoot>
    );
  }

  if (loading) {
    return (
      <UIRoot>
        <UIEmptyState title="Loading PR..." />
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

  if (!detail) {
    return (
      <UIRoot>
        <UIEmptyState title="No PR data" />
      </UIRoot>
    );
  }

  const fileReviewMap = buildPullRequestFileReviewStateMap(
    detail.files,
    reviewState,
    detail.headSha
  );
  const seenCount = countSeenFiles(fileReviewMap);
  const hasRunningReview = agentReviews.some((r) => r.status === "running");

  const agentReviewLabel = hasRunningReview
    ? "Reviewing..."
    : agentReviewStarting
      ? "Starting..."
      : "Review";

  const prHeader = (
    <div className="tui-col" style={{ gap: 0 }}>
      <div className="tui-row" style={{ alignItems: "center", gap: 6, marginTop: 4 }}>
        {editingTitle ? (
          <>
            <input
              ref={titleInputRef}
              type="text"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveTitle();
                if (e.key === "Escape") handleCancelEditTitle();
              }}
              style={{
                flex: 1,
                margin: 0,
                fontSize: "1.2em",
                fontWeight: 600,
                fontFamily: "inherit",
                background: "var(--tui-bg-secondary, #1a1a1a)",
                color: "var(--tui-text)",
                border: "1px solid var(--tui-border)",
                borderRadius: 6,
                padding: "4px 8px",
                outline: "none",
              }}
            />
            <UIIconButton
              icon="check"
              label={savingTitle ? "Saving..." : "Save title"}
              variant="primary"
              disabled={savingTitle || !titleDraft.trim()}
              onClick={handleSaveTitle}
            />
            <UIButton
              label="Cancel"
              variant="ghost"
              size="sm"
              disabled={savingTitle}
              onClick={handleCancelEditTitle}
            />
          </>
        ) : (
          <>
            <h2 style={{ margin: 0, fontSize: "1.2em", fontWeight: 600 }}>{detail.title}</h2>
            <UIIconButton
              icon={<UIIcon name="pencil" size={14} />}
              label="Edit title"
              onClick={handleStartEditTitle}
            />
            <UIIconButton
              icon={<UIIcon name="external-link" size={14} />}
              label="Open on GitHub"
              href={detail.url}
            />
          </>
        )}
      </div>
      <div style={{ color: "var(--tui-text-secondary)", fontSize: "12px", marginTop: 2 }}>
        {detail.baseRefName} {"\u2190"} {detail.headRefName}
      </div>
    </div>
  );

  const tabs = [
    { value: "conversation", label: "Conversation" },
    ...(agentReviews.length > 0
      ? [{ value: "agent_reviews", label: `Agent reviews (${agentReviews.length})` }]
      : []),
  ];

  return (
    <UIRoot fixed>
      <UIScrollArea>
        <div className="tui-col" style={{ gap: 8, padding: "8px 16px" }}>
          <UIContainer>
            {prHeader}
            <div style={{ borderTop: "1px solid var(--tui-border)", margin: "12px 0" }} />
            <UITabs
              tabs={tabs}
              value={activeTab}
              onChange={setActiveTab}
              rightActions={
                <UIButton
                  label={agentReviewLabel}
                  icon="ai"
                  variant="primary"
                  size="sm"
                  disabled={agentReviewStarting || hasRunningReview}
                  onClick={handleStartAgentReview}
                />
              }
            />
            <ConversationTabContainerContent
              detail={detail}
              seenCount={seenCount}
              totalFiles={detail.files.length}
              onDescriptionUpdated={() => {
                if (selected) loadDetail(selected.repo, selected.number, true);
              }}
            />
          </UIContainer>

          {agentReviewError && (
            <UIContainer>
              <div
                className="tui-row"
                style={{
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 12px",
                  background: "var(--tui-bg-danger, rgba(220,38,38,0.1))",
                  borderRadius: 6,
                  color: "var(--tui-text-danger, #ef4444)",
                  fontSize: "13px",
                }}
              >
                <span style={{ flex: 1 }}>{agentReviewError}</span>
                <UIButton
                  label="Dismiss"
                  variant="ghost"
                  size="sm"
                  onClick={() => setAgentReviewError(null)}
                />
              </div>
            </UIContainer>
          )}

          {activeTab === "conversation" && (
            <ConversationTabComments
              detail={detail}
              onReplied={() => {
                if (selected) loadDetail(selected.repo, selected.number, true);
              }}
            />
          )}

          {activeTab === "agent_reviews" && (
            <AgentReviewsTab
              repo={selected.repo}
              number={selected.number}
              headSha={detail.headSha}
              agentReviews={agentReviews}
            />
          )}
        </div>
      </UIScrollArea>

      <UIFooter>
        <ReviewActionBar
          repo={selected.repo}
          number={selected.number}
          isAuthor={currentUser != null && detail.authorLogin === currentUser}
          onSubmitted={() => loadDetail(selected.repo, selected.number, true)}
        />
      </UIFooter>
    </UIRoot>
  );
}
