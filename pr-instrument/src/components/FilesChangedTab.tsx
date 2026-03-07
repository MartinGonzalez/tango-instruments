// Files Changed tab — flat/tree views with seen/new/updated badges

import React, { useState } from "react";
import {
  UISegmentedControl,
  UIGroupList,
  UIGroupItem,
  UIBadge,
  UIEmptyState,
} from "tango-api";
import type {
  PullRequestDetail,
  PullRequestFileMeta,
  PullRequestFileReviewState,
} from "../types.ts";
import { UITreeView, buildTree } from "tango-api";
import {
  statusSymbol,
  statusTone,
} from "../lib/file-list-helpers.ts";

type Props = {
  detail: PullRequestDetail;
  fileReviewMap: Map<string, PullRequestFileReviewState>;
  onToggleFileSeen: (path: string, seen: boolean) => void;
  onFileClick?: (path: string) => void;
};

type FileListView = "flat" | "tree";

function FileItemMeta({
  file,
  review,
  onToggleSeen,
}: {
  file: PullRequestFileMeta;
  review: PullRequestFileReviewState | undefined;
  onToggleSeen: (path: string, seen: boolean) => void;
}) {
  const isSeen = review?.seen ?? false;
  const attention = review?.attention ?? null;

  return (
    <div className="tui-row" style={{ gap: 4, alignItems: "center" }}>
      <UIBadge label={statusSymbol(file.status)} tone={statusTone(file.status)} />
      <span style={{ fontSize: "11px", color: "var(--tui-text-secondary)" }}>
        +{file.additions} -{file.deletions}
      </span>
      {isSeen && <UIBadge label="Seen" tone="success" />}
      {attention && (
        <UIBadge
          label={attention === "new" ? "New" : "Updated"}
          tone={attention === "new" ? "info" : "warning"}
        />
      )}
    </div>
  );
}

export function FilesChangedTab({ detail, fileReviewMap, onToggleFileSeen, onFileClick }: Props) {
  const [viewMode, setViewMode] = useState<FileListView>("tree");

  const root = buildTree(detail.files, (f) => f.path);

  return (
    <div className="tui-col" style={{ gap: 0 }}>
      <div className="tui-row" style={{ justifyContent: "space-between", alignItems: "center", padding: "8px 12px" }}>
        <div className="tui-row" style={{ gap: 8, alignItems: "center" }}>
          <span style={{ fontWeight: 600, fontSize: "13px" }}>Files Changed</span>
          <UIBadge label={String(detail.files.length)} tone="neutral" />
        </div>
        <UISegmentedControl
          value={viewMode}
          options={[
            { value: "flat", label: "Flat" },
            { value: "tree", label: "Tree" },
          ]}
          onChange={(v) => setViewMode(v as FileListView)}
        />
      </div>

      {detail.files.length === 0 ? (
        <UIEmptyState title="No changed files" />
      ) : viewMode === "tree" ? (
        <UITreeView
          node={root}
          itemPath={(f) => f.path}
          onItemClick={onFileClick}
          renderItemMeta={(file) => (
            <FileItemMeta
              file={file}
              review={fileReviewMap.get(file.path)}
              onToggleSeen={onToggleFileSeen}
            />
          )}
        />
      ) : (
        <UIGroupList>
          {detail.files.map((file) => {
            const fileName = file.path.split("/").pop() ?? file.path;
            const dirPath = file.path.includes("/")
              ? file.path.slice(0, file.path.lastIndexOf("/"))
              : "";
            const review = fileReviewMap.get(file.path);

            return (
              <UIGroupItem
                key={file.path}
                title={fileName}
                subtitle={dirPath || undefined}
                onClick={() => onFileClick?.(file.path)}
                meta={
                  <FileItemMeta
                    file={file}
                    review={review}
                    onToggleSeen={onToggleFileSeen}
                  />
                }
              />
            );
          })}
        </UIGroupList>
      )}
    </div>
  );
}
