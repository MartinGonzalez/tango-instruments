// Agent Reviews tab — version selector + structured review display

import React, { useCallback, useEffect, useState } from "react";
import {
  useInstrumentApi,
  UIButton,
  UIMarkdownRenderer,
  UISection,
  UIGroup,
  UIGroupList,
  UIGroupItem,
  UIGroupEmpty,
  UIBadge,
  UIEmptyState,
  UICard,
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

export function AgentReviewsTab({ repo, number, agentReviews }: Props) {
  const api = useInstrumentApi();
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [document, setDocument] = useState<PullRequestAgentReviewDocument | null>(null);
  const [loading, setLoading] = useState(false);
  const [applyingSet, setApplyingSet] = useState<Set<number>>(new Set());
  const [applyErrors, setApplyErrors] = useState<Map<number, string>>(new Map());

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

  if (sorted.length === 0) {
    return <UIEmptyState title="No agent reviews yet" />;
  }

  const review = document?.review ?? null;
  const parseError = document?.parseError ?? null;
  const renderedMarkdown = document?.renderedMarkdown ?? "";
  const suggestions = review?.suggestions ?? [];

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
          reviewVersion={effectiveVersion ?? 1}
          suggestions={suggestions}
          applyingSet={applyingSet}
          applyErrors={applyErrors}
          onApply={handleApply}
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
  reviewVersion,
  suggestions,
  applyingSet,
  applyErrors,
  onApply,
}: {
  review: PullRequestAgentReviewData;
  reviewVersion: number;
  suggestions: PullRequestAgentReviewData["suggestions"];
  applyingSet: Set<number>;
  applyErrors: Map<number, string>;
  onApply: (index: number) => void;
}) {
  const metadataEntries = Object.entries(review.metadata ?? {});

  return (
    <div className="tui-col" style={{ gap: 0 }}>
      <UISection title="PR Description">
        <UIMarkdownRenderer content={review.pr_description || "_No PR description_"} />
      </UISection>

      <UISection title="Summary">
        <UIMarkdownRenderer content={review.pr_summary || "_No summary_"} />
      </UISection>

      {metadataEntries.length > 0 && (
        <UISection title="Metadata">
          <UIGroupList>
            {metadataEntries.map(([key, value]) => (
              <UIGroupItem
                key={key}
                title={key.replace(/_/g, " ")}
                meta={value}
              />
            ))}
          </UIGroupList>
        </UISection>
      )}

      <UISection title="Strengths">
        <UIMarkdownRenderer content={review.strengths || "_No strengths_"} />
      </UISection>

      <UISection title="Improvements">
        <UIMarkdownRenderer content={review.improvements || "_No improvements_"} />
      </UISection>

      <UISection title="Suggestions">
        {suggestions.length === 0 ? (
          <UIEmptyState title="No suggestions" />
        ) : (
          <div className="tui-col" style={{ gap: 4 }}>
            {suggestions.map((item, index) => {
              const isApplying = applyingSet.has(index);
              const isApplied = item.applied;
              const errorMsg = applyErrors.get(index) ?? null;

              const applyLabel = isApplying
                ? "Applying..."
                : isApplied
                  ? "Applied"
                  : "Apply";

              return (
                <UIGroup
                  key={index}
                  title={item.title || `Suggestion ${index + 1}`}
                  meta={<UIBadge label={item.level} tone={levelTone(item.level)} />}
                  actions={
                    <UIButton
                      label={applyLabel}
                      variant={isApplied ? "ghost" : "secondary"}
                      size="sm"
                      disabled={isApplying || isApplied}
                      onClick={() => onApply(index)}
                    />
                  }
                >
                  <div className="tui-col" style={{ padding: "8px 12px", gap: 12 }}>
                    <SuggestionSection title="Why" markdown={item.reason || "_No reason provided_"} />
                    <SuggestionSection title="Solution/Solutions" markdown={item.solutions || "_No solutions provided_"} />
                    <SuggestionSection title="Benefit" markdown={item.benefit || "_No benefit provided_"} />
                    {errorMsg && (
                      <UIBadge label={errorMsg} tone="danger" />
                    )}
                  </div>
                </UIGroup>
              );
            })}
          </div>
        )}
      </UISection>

      <UISection title="Final Veredic">
        <UIMarkdownRenderer content={review.final_veredic || "_No final veredic_"} />
      </UISection>
    </div>
  );
}

function SuggestionSection({ title, markdown }: { title: string; markdown: string }) {
  return (
    <div className="tui-col" style={{ gap: 4 }}>
      <span style={{ fontWeight: 600, fontSize: "12px", color: "var(--tui-text-secondary)" }}>{title}</span>
      <UIMarkdownRenderer content={markdown} />
    </div>
  );
}
