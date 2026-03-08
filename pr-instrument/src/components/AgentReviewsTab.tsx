// Agent Reviews tab — version selector + structured review display

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  useInstrumentApi,
  UIButton,
  UIMarkdownRenderer,
  UISection,
  UIGroup,
  UIGroupList,
  UIGroupItem,
  UIBadge,
  UIEmptyState,
} from "tango-api";
import type {
  PullRequestAgentReviewRun,
  PullRequestAgentReviewDocument,
  PullRequestAgentReviewData,
  PullRequestAgentReviewLevel,
} from "../types.ts";

type Props = {
  repo: string;
  number: number;
  headSha: string;
  agentReviews: PullRequestAgentReviewRun[];
};

function formatDateTime(value: string): string {
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return "";
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusTone(status: PullRequestAgentReviewRun["status"]): "success" | "warning" | "danger" | "neutral" {
  if (status === "completed") return "success";
  if (status === "running") return "warning";
  if (status === "failed") return "danger";
  return "neutral";
}

function statusLabel(status: PullRequestAgentReviewRun["status"]): string {
  if (status === "running") return "Running";
  if (status === "completed") return "Completed";
  if (status === "stale") return "Stale";
  return "Failed";
}

function levelTone(level: PullRequestAgentReviewLevel): "danger" | "warning" | "info" | "neutral" {
  if (level === "Critical") return "danger";
  if (level === "Important") return "warning";
  if (level === "Medium") return "info";
  return "neutral";
}

export function AgentReviewsTab({ repo, number, headSha, agentReviews }: Props) {
  const api = useInstrumentApi();
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [document, setDocument] = useState<PullRequestAgentReviewDocument | null>(null);
  const [loading, setLoading] = useState(false);
  const [applyingSet, setApplyingSet] = useState<Set<number>>(new Set());
  const [applyErrors, setApplyErrors] = useState<Map<number, string>>(new Map());
  const [commentingSet, setCommentingSet] = useState<Set<number>>(new Set());
  const [commentErrors, setCommentErrors] = useState<Map<number, string>>(new Map());
  const [commentedSet, setCommentedSet] = useState<Set<number>>(new Set());
  const [discardingSet, setDiscardingSet] = useState<Set<number>>(new Set());

  const sorted = [...agentReviews].sort((a, b) => a.version - b.version);
  const effectiveVersion = selectedVersion ?? sorted[sorted.length - 1]?.version ?? null;

  const loadDocument = useCallback(async (version: number) => {
    setLoading(true);
    try {
      const doc = await api.actions.call<
        { repo: string; number: number; version: number },
        PullRequestAgentReviewDocument | null
      >("getAgentReviewDocument", { repo, number, version });
      setDocument(doc);
    } catch {
      setDocument(null);
    } finally {
      setLoading(false);
    }
  }, [api, repo, number]);

  useEffect(() => {
    if (effectiveVersion != null) {
      loadDocument(effectiveVersion);
    }
  }, [effectiveVersion, loadDocument]);

  const handleApply = useCallback(async (suggestionIndex: number) => {
    if (!effectiveVersion) return;
    setApplyingSet((prev) => new Set([...prev, suggestionIndex]));
    setApplyErrors((prev) => {
      const next = new Map(prev);
      next.delete(suggestionIndex);
      return next;
    });

    try {
      await api.actions.call("applySuggestion", {
        repo,
        number,
        version: effectiveVersion,
        suggestionIndex,
      });
      await loadDocument(effectiveVersion);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setApplyErrors((prev) => new Map([...prev, [suggestionIndex, message]]));
    } finally {
      setApplyingSet((prev) => {
        const next = new Set(prev);
        next.delete(suggestionIndex);
        return next;
      });
    }
  }, [api, repo, number, effectiveVersion, loadDocument]);

  const handleComment = useCallback(async (suggestionIndex: number) => {
    if (!effectiveVersion || !document?.review) return;
    const suggestion = document.review.suggestions[suggestionIndex];
    if (!suggestion?.path || !suggestion?.line) return;

    setCommentingSet((prev) => new Set([...prev, suggestionIndex]));
    setCommentErrors((prev) => {
      const next = new Map(prev);
      next.delete(suggestionIndex);
      return next;
    });

    const body = [
      `**${suggestion.title}** (${suggestion.level})`,
      "",
      suggestion.reason,
      "",
      "**Suggested fix:**",
      suggestion.solutions,
    ].join("\n");

    try {
      await api.actions.call("createReviewComment", {
        repo,
        number,
        commitSha: headSha,
        path: suggestion.path,
        line: suggestion.line,
        side: "RIGHT",
        body,
      });
      setCommentedSet((prev) => new Set([...prev, suggestionIndex]));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setCommentErrors((prev) => new Map([...prev, [suggestionIndex, message]]));
    } finally {
      setCommentingSet((prev) => {
        const next = new Set(prev);
        next.delete(suggestionIndex);
        return next;
      });
    }
  }, [api, repo, number, headSha, effectiveVersion, document]);

  const handleDiscard = useCallback(async (suggestionIndex: number) => {
    if (!effectiveVersion) return;
    setDiscardingSet((prev) => new Set([...prev, suggestionIndex]));
    try {
      await api.actions.call("discardSuggestion", {
        repo,
        number,
        version: effectiveVersion,
        suggestionIndex,
      });
    } catch (err) {
      console.error("discardSuggestion failed:", err);
    }
    try {
      await loadDocument(effectiveVersion);
    } catch {
      // ignore
    }
    setDiscardingSet((prev) => {
      const next = new Set(prev);
      next.delete(suggestionIndex);
      return next;
    });
  }, [api, repo, number, effectiveVersion, loadDocument]);

  if (sorted.length === 0) {
    return <UIEmptyState title="No agent reviews yet" />;
  }

  const review = document?.review ?? null;
  const parseError = document?.parseError ?? null;
  const renderedMarkdown = document?.renderedMarkdown ?? "";
  const allSuggestions = review?.suggestions ?? [];
  const discardedIndices = new Set(review?.discarded_suggestions ?? []);
  const suggestions = allSuggestions.filter((_, i) => !discardedIndices.has(i));

  return (
    <div className="tui-col" style={{ gap: 0 }}>
      <UISection title="Review Versions">
        <UIGroupList>
          {sorted.map((run) => {
            const isActive = run.version === effectiveVersion;
            const timestamp = run.completedAt ?? run.updatedAt ?? run.startedAt;
            return (
              <UIGroupItem
                key={run.id}
                title={`v${run.version}`}
                subtitle={formatDateTime(timestamp)}
                meta={<UIBadge label={statusLabel(run.status)} tone={statusTone(run.status)} />}
                active={isActive}
                onClick={() => setSelectedVersion(run.version)}
              />
            );
          })}
        </UIGroupList>
      </UISection>

      {parseError && (
        <UISection>
          <UIBadge label={`Invalid review JSON: ${parseError}`} tone="danger" />
        </UISection>
      )}

      {loading && !document ? (
        <UIEmptyState title="Loading review..." />
      ) : review ? (
        <StructuredReview
          review={review}
          suggestions={suggestions}
          allSuggestions={allSuggestions}
          applyingSet={applyingSet}
          applyErrors={applyErrors}
          onApply={handleApply}
          commentingSet={commentingSet}
          commentErrors={commentErrors}
          commentedSet={commentedSet}
          onComment={handleComment}
          discardingSet={discardingSet}
          onDiscard={handleDiscard}
        />
      ) : renderedMarkdown.trim() ? (
        <UISection>
          <UIMarkdownRenderer content={renderedMarkdown} />
        </UISection>
      ) : (
        <UIEmptyState title="Review file not found" />
      )}
    </div>
  );
}

function StructuredReview({
  review,
  suggestions,
  allSuggestions,
  applyingSet,
  applyErrors,
  onApply,
  commentingSet,
  commentErrors,
  commentedSet,
  onComment,
  discardingSet,
  onDiscard,
}: {
  review: PullRequestAgentReviewData;
  suggestions: PullRequestAgentReviewData["suggestions"];
  allSuggestions: PullRequestAgentReviewData["suggestions"];
  applyingSet: Set<number>;
  applyErrors: Map<number, string>;
  onApply: (index: number) => void;
  commentingSet: Set<number>;
  commentErrors: Map<number, string>;
  commentedSet: Set<number>;
  onComment: (index: number) => void;
  discardingSet: Set<number>;
  onDiscard: (index: number) => void;
}) {
  return (
    <div className="tui-col" style={{ gap: 0 }}>
      <UIMarkdownRenderer content={[
        `## Summary\n${review.pr_summary || "_No summary_"}`,
        `## Strengths\n${review.strengths || "_No strengths_"}`,
        `## Improvements\n${review.improvements || "_No improvements_"}`,
        "## Suggestions",
      ].join("\n")} />
      {suggestions.length === 0 ? (
        <UIEmptyState title="No suggestions" />
      ) : (
        <div className="tui-col" style={{ gap: 4 }}>
          {suggestions.map((item) => {
            const originalIndex = allSuggestions.indexOf(item);
            return (
              <SuggestionCard
                key={originalIndex}
                index={originalIndex}
                item={item}
                isApplying={applyingSet.has(originalIndex)}
                errorMsg={applyErrors.get(originalIndex) ?? commentErrors.get(originalIndex) ?? null}
                onApply={onApply}
                isCommenting={commentingSet.has(originalIndex)}
                isCommented={commentedSet.has(originalIndex)}
                onComment={onComment}
                isDiscarding={discardingSet.has(originalIndex)}
                onDiscard={onDiscard}
              />
            );
          })}
        </div>
      )}

      <UIMarkdownRenderer content={`## Final Verdict\n\n${review.final_veredic || "_No final verdict_"}`} />
    </div>
  );
}

function SuggestionCard({
  index, item, isApplying, errorMsg, onApply,
  isCommenting, isCommented, onComment,
  isDiscarding, onDiscard,
}: {
  index: number;
  item: PullRequestAgentReviewData["suggestions"][number];
  isApplying: boolean;
  errorMsg: string | null;
  onApply: (index: number) => void;
  isCommenting: boolean;
  isCommented: boolean;
  onComment: (index: number) => void;
  isDiscarding: boolean;
  onDiscard: (index: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isApplied = item.applied;
  const hasLocation = Boolean(item.path && item.line);

  const applyLabel = isApplying
    ? "Applying..."
    : isApplied
      ? "Applied"
      : "Apply";

  const commentLabel = isCommenting
    ? "Commenting..."
    : isCommented
      ? "Commented"
      : "Comment";

  return (
    <UIGroup
      title={item.title || `Suggestion ${index + 1}`}
      meta={<UIBadge label={item.level} tone={levelTone(item.level)} />}
      expanded={expanded}
      onToggle={setExpanded}
      actions={
        <div className="tui-row" style={{ gap: 4, alignItems: "center" }}>
          {hasLocation && (
            <UIButton
              label={commentLabel}
              icon="post"
              variant={isCommented ? "ghost" : "secondary"}
              size="sm"
              disabled={isCommenting || isCommented}
              onClick={() => onComment(index)}
            />
          )}
          <UIButton
            label={applyLabel}
            variant={isApplied ? "ghost" : "secondary"}
            size="sm"
            disabled={isApplying || isApplied}
            onClick={() => onApply(index)}
          />
          <KebabMenu
            isDiscarding={isDiscarding}
            onDiscard={() => onDiscard(index)}
          />
        </div>
      }
    >
      <div className="tui-col" style={{ padding: "8px 12px", gap: 0 }}>
        <UIMarkdownRenderer content={[
          ...(hasLocation ? [`\`${item.path}:${item.line}\``] : []),
          `**Why**\n${item.reason || "_No reason provided_"}`,
          `**Solution/Solutions**\n${item.solutions || "_No solutions provided_"}`,
          `**Benefit**\n${item.benefit || "_No benefit provided_"}`,
        ].join("\n\n")} />
        {errorMsg && (
          <UIBadge label={errorMsg} tone="danger" />
        )}
      </div>
    </UIGroup>
  );
}

function KebabMenu({ isDiscarding, onDiscard }: {
  isDiscarding: boolean;
  onDiscard: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div
      ref={rootRef}
      style={{ position: "relative" }}
      onClick={stop}
      onMouseDown={stop}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 28,
          height: 28,
          padding: 0,
          background: open ? "var(--tui-bg-secondary, rgba(255,255,255,0.06))" : "none",
          border: "1px solid transparent",
          borderRadius: 6,
          cursor: "pointer",
          color: "var(--tui-text-secondary)",
        }}
        title="More actions"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <circle cx="8" cy="3" r="1.5" />
          <circle cx="8" cy="8" r="1.5" />
          <circle cx="8" cy="13" r="1.5" />
        </svg>
      </button>
      {open && (
        <>
          {/* Backdrop: fixed overlay to catch outside clicks */}
          <div
            style={{ position: "fixed", inset: 0, zIndex: 9999 }}
            onClick={() => setOpen(false)}
            onMouseDown={stop}
          />
          {/* Dropdown */}
          <div
            style={{
              position: "absolute",
              top: "100%",
              right: 0,
              marginTop: 4,
              minWidth: 140,
              background: "var(--tui-bg-elevated, #2a2a2a)",
              border: "1px solid var(--tui-border)",
              borderRadius: 8,
              boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
              zIndex: 10000,
              overflow: "hidden",
            }}
          >
            <button
              onClick={() => { setOpen(false); onDiscard(); }}
              onMouseDown={stop}
              disabled={isDiscarding}
              style={{
                display: "block",
                width: "100%",
                padding: "8px 12px",
                background: "none",
                border: "none",
                color: "var(--tui-text-danger, #ef4444)",
                fontSize: "13px",
                textAlign: "left",
                cursor: isDiscarding ? "wait" : "pointer",
                opacity: isDiscarding ? 0.5 : 1,
              }}
            >
              {isDiscarding ? "Discarding..." : "Discard"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
