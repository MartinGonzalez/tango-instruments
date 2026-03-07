// Right sidebar for filtering diff by commit

import React from "react";
import { UIGroupList, UIGroupItem } from "tango-api";
import type { PullRequestCommit } from "../types.ts";

type Props = {
  commits: PullRequestCommit[];
  selectedCommit: string;
  onSelectCommit: (value: string) => void;
};

export function DiffCommitsSidebar({ commits, selectedCommit, onSelectCommit }: Props) {
  return (
    <div
      style={{
        width: 320,
        minWidth: 320,
        flexShrink: 0,
        borderLeft: "1px solid var(--tui-border)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "8px 12px",
          borderBottom: "1px solid var(--tui-border)",
          fontWeight: 600,
          fontSize: "13px",
        }}
      >
        Commits
      </div>

      {/* Commit list */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        <UIGroupList>
          <UIGroupItem
            title="All commits"
            active={selectedCommit === "all"}
            onClick={() => onSelectCommit("all")}
          />
          {commits.map((c) => (
            <UIGroupItem
              key={c.sha}
              title={`${c.shortSha} ${c.messageHeadline}`}
              subtitle={c.authorLogin}
              active={selectedCommit === c.sha}
              onClick={() => onSelectCommit(c.sha)}
            />
          ))}
        </UIGroupList>
      </div>
    </div>
  );
}
