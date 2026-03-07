// Right sidebar for browsing files in the diff panel

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  UISegmentedControl,
  UIGroupList,
  UIGroupItem,
  UIBadge,
  UIIconButton,
  UICheckbox,
} from "tango-api";
import { UITreeView, buildTree } from "tango-api";
import type { DiffFile } from "../types.ts";
import {
  statusSymbol,
  statusTone,
} from "../lib/file-list-helpers.ts";

type FileListView = "flat" | "tree";

type Props = {
  /** Already filtered by extension — parent handles filtering */
  files: DiffFile[];
  activeFile: string | null;
  onFileClick: (path: string) => void;
  /** Extension filter state — owned by parent, rendered here */
  extensionMap: Map<string, number>;
  enabledExtensions: Set<string>;
  onToggleExtension: (ext: string, checked: boolean) => void;
  isFiltering: boolean;
};

// Inline filter SVG — not available in tango-api icon set
const FilterIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
  </svg>
);

/** Floating popover for extension filters */
function ExtensionFilterPopover({
  extensionMap,
  enabledExtensions,
  onToggleExtension,
  onClose,
}: {
  extensionMap: Map<string, number>;
  enabledExtensions: Set<string>;
  onToggleExtension: (ext: string, checked: boolean) => void;
  onClose: () => void;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const allExtensions = [...extensionMap.keys()].sort();

  return (
    <div
      ref={popoverRef}
      style={{
        position: "absolute",
        top: "100%",
        left: 0,
        marginTop: 4,
        background: "var(--tui-bg)",
        border: "1px solid var(--tui-border)",
        borderRadius: 8,
        padding: "8px 0",
        minWidth: 200,
        maxHeight: 300,
        overflowY: "auto",
        boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
        zIndex: 100,
      }}
    >
      <div
        style={{
          padding: "4px 12px 8px",
          borderBottom: "1px solid var(--tui-border)",
          fontSize: "11px",
          color: "var(--tui-text-secondary)",
          fontWeight: 600,
        }}
      >
        Filter by extension
      </div>
      {allExtensions.map((ext) => {
        const checked = enabledExtensions.has(ext);
        return (
          <div
            key={ext}
            className="tui-row"
            role="button"
            onClick={() => onToggleExtension(ext, !checked)}
            style={{
              gap: 4,
              alignItems: "center",
              padding: "4px 12px",
              justifyContent: "space-between",
              cursor: "pointer",
              borderRadius: 4,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--tui-bg-hover)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            {/* Stop propagation so the checkbox toggle doesn't double-fire with the row onClick */}
            <div onClick={(e) => e.stopPropagation()}>
              <UICheckbox
                label={ext}
                checked={checked}
                onChange={(c) => onToggleExtension(ext, c)}
              />
            </div>
            <UIBadge label={String(extensionMap.get(ext) ?? 0)} tone="neutral" />
          </div>
        );
      })}
    </div>
  );
}

/** Adapt DiffFile to the shape expected by buildFileTree */
function toPseudoFileMeta(files: DiffFile[]) {
  return files.map((f) => ({
    path: f.path,
    previousPath: f.oldPath,
    status: f.status,
    additions: f.hunks.reduce((s, h) => s + h.lines.filter((l) => l.type === "add").length, 0),
    deletions: f.hunks.reduce((s, h) => s + h.lines.filter((l) => l.type === "delete").length, 0),
    sha: null,
  }));
}

export function DiffFilesSidebar({
  files,
  activeFile,
  onFileClick,
  extensionMap,
  enabledExtensions,
  onToggleExtension,
  isFiltering,
}: Props) {
  const [viewMode, setViewMode] = useState<FileListView>("tree");
  const [showFilterPopover, setShowFilterPopover] = useState(false);
  const hasExtensions = extensionMap.size > 0;

  const pseudoMeta = useMemo(() => toPseudoFileMeta(files), [files]);
  const tree = useMemo(() => buildTree(pseudoMeta, (f) => f.path), [pseudoMeta]);

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
        className="tui-row"
        style={{
          justifyContent: "space-between",
          alignItems: "center",
          padding: "8px 12px",
          borderBottom: "1px solid var(--tui-border)",
        }}
      >
        <div className="tui-row" style={{ gap: 4, alignItems: "center", position: "relative" }}>
          <span style={{ fontWeight: 600, fontSize: "13px" }}>Files</span>
          {hasExtensions && (
            <>
              <UIIconButton
                icon={FilterIcon}
                label="Filter"
                title="Filter by file extension"
                variant="ghost"
                size="sm"
                active={showFilterPopover || isFiltering}
                onClick={() => setShowFilterPopover((prev) => !prev)}
              />
              {showFilterPopover && (
                <ExtensionFilterPopover
                  extensionMap={extensionMap}
                  enabledExtensions={enabledExtensions}
                  onToggleExtension={onToggleExtension}
                  onClose={() => setShowFilterPopover(false)}
                />
              )}
            </>
          )}
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

      {/* File list */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {files.length === 0 ? (
          <div style={{ padding: "24px 12px", textAlign: "center", color: "var(--tui-text-secondary)", fontSize: "12px" }}>
            No files match the current filter
          </div>
        ) : viewMode === "tree" ? (
          <UITreeView
            node={tree}
            activeItem={activeFile}
            itemPath={(f) => f.path}
            onItemClick={onFileClick}
            renderItemMeta={(f) => (
              <span className={`fp-status fp-status-${f.status === "added" ? "added" : f.status === "deleted" ? "deleted" : f.status === "renamed" ? "renamed" : "modified"}`}>
                {statusSymbol(f.status)}
              </span>
            )}
          />
        ) : (
          <UIGroupList>
            {files.map((file) => {
              const fileName = file.path.split("/").pop() ?? file.path;
              const dirPath = file.path.includes("/")
                ? file.path.slice(0, file.path.lastIndexOf("/"))
                : "";
              return (
                <UIGroupItem
                  key={file.path}
                  title={fileName}
                  subtitle={dirPath || undefined}
                  active={file.path === activeFile}
                  onClick={() => onFileClick(file.path)}
                  meta={
                    <span className={`fp-status fp-status-${file.status === "added" ? "added" : file.status === "deleted" ? "deleted" : file.status === "renamed" ? "renamed" : "modified"}`}>
                      {statusSymbol(file.status)}
                    </span>
                  }
                />
              );
            })}
          </UIGroupList>
        )}
      </div>
    </div>
  );
}
