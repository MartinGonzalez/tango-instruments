// PRs Sidebar — ported from desktop/src/mainview/components/prs-sidebar.ts as React

import React, { useCallback, useEffect, useState } from "react";
import {
  useInstrumentApi,
  UIRoot,
  UIGroup,
  UIGroupList,
  UIGroupItem,
  UIGroupEmpty,
  UIEmptyState,
  UIButton,
  type InstrumentFrontendAPI,
} from "tango-api";
import type { PullRequestSummary } from "../types.ts";

type PullRequestRepoGroup = {
  repo: string;
  prs: PullRequestSummary[];
};

type PullRequestSidebarSection = {
  id: string;
  label: string;
  groups: PullRequestRepoGroup[];
  emptyLabel?: string;
};

type PRsData = {
  assigned: PullRequestSummary[];
  opened: PullRequestSummary[];
  reviewRequested: PullRequestSummary[];
};

function groupByRepo(prs: PullRequestSummary[]): PullRequestRepoGroup[] {
  const map = new Map<string, PullRequestSummary[]>();
  for (const pr of prs) {
    const list = map.get(pr.repo) ?? [];
    list.push(pr);
    map.set(pr.repo, list);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([repo, prs]) => ({ repo, prs }));
}

function buildSections(data: PRsData): PullRequestSidebarSection[] {
  return [
    {
      id: "assigned",
      label: "Assigned to me",
      groups: groupByRepo(data.assigned),
      emptyLabel: "No assigned PRs",
    },
    {
      id: "opened",
      label: "Opened by me",
      groups: groupByRepo(data.opened),
      emptyLabel: "No opened PRs",
    },
    {
      id: "review-requested",
      label: "Review requested",
      groups: groupByRepo(data.reviewRequested),
      emptyLabel: "No review requests",
    },
  ];
}

function timeAgo(value: string): string {
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return "";

  const diffMs = Date.now() - ts;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.floor(hours / 24);
  return `${days}d`;
}

export function PRsSidebar() {
  const api = useInstrumentApi();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sections, setSections] = useState<PullRequestSidebarSection[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
  const [selectedNumber, setSelectedNumber] = useState<number | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Map<string, boolean>>(new Map());

  const fetchPRs = useCallback(async (forceRefresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.actions.call<{ forceRefresh?: boolean }, PRsData>(
        "listPullRequests",
        { forceRefresh }
      );
      setSections(buildSections(data));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    fetchPRs(false);
  }, [fetchPRs]);

  const handleSelectPR = useCallback((repo: string, number: number) => {
    setSelectedRepo(repo);
    setSelectedNumber(number);
    api.storage.setProperty("selectedPR", { repo, number });
    api.emit({ event: "pr.selected", payload: { repo, number } });
  }, [api]);

  const isGroupExpanded = useCallback((key: string, groupHasSelection: boolean): boolean => {
    const explicit = expandedGroups.get(key);
    if (explicit != null) return explicit;
    return groupHasSelection;
  }, [expandedGroups]);

  const handleToggleGroup = useCallback((key: string, next: boolean) => {
    setExpandedGroups((prev) => {
      const updated = new Map(prev);
      updated.set(key, next);
      return updated;
    });
  }, []);

  if (loading) {
    return (
      <UIRoot>
        <UIEmptyState title="Loading pull requests..." />
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

  return (
    <UIRoot>
      {sections.map((section, index) => (
        <React.Fragment key={section.id}>
          {index > 0 && (
            <div style={{ borderTop: "1px solid var(--tui-border)", margin: "0 12px" }} />
          )}
          <div style={{ padding: "12px 12px 4px", color: "#606672", fontSize: "11px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>
            {section.label}
          </div>
          {section.groups.length === 0 ? (
            <UIGroupEmpty text={section.emptyLabel ?? "No PRs"} />
          ) : (
            section.groups.map((group) => {
              const groupKey = `${section.id}:${group.repo}`;
              const groupHasSelection = group.prs.some(
                (pr) => pr.repo === selectedRepo && pr.number === selectedNumber
              );
              const expanded = isGroupExpanded(groupKey, groupHasSelection);

              return (
                <UIGroup
                  key={groupKey}
                  title={group.repo}
                  active={groupHasSelection}
                  expanded={expanded}
                  showCaret={false}
                  onToggle={(next) => handleToggleGroup(groupKey, next)}
                >
                  <UIGroupList>
                    {group.prs.map((pr) => (
                      <UIGroupItem
                        key={`${pr.repo}#${pr.number}`}
                        title={`#${pr.number} ${pr.title}`}
                        subtitle={`@${pr.authorLogin} · ${timeAgo(pr.updatedAt)}`}
                        active={pr.repo === selectedRepo && pr.number === selectedNumber}
                        onClick={() => handleSelectPR(pr.repo, pr.number)}
                      />
                    ))}
                  </UIGroupList>
                </UIGroup>
              );
            })
          )}
        </React.Fragment>
      ))}
      <div style={{ position: "sticky", bottom: 0, padding: "12px 20px", borderTop: "1px solid var(--tui-border)", background: "var(--tui-bg)" }}>
        <UIButton
          label="Refresh"
          variant="primary"
          onClick={() => fetchPRs(true)}
          fullWidth
        />
      </div>
    </UIRoot>
  );
}
