// Conversation tab — metadata + description + timeline

import React, { useCallback } from "react";
import ReactDOM from "react-dom";
import {
  UIMarkdownRenderer,
  UIBadge,
  UIEmptyState,
  UIContainer,
  UIKeyValue,
  UILink,
  UIButton,
  UIIconButton,
  UIIcon,
  UISegmentedControl,
  useInstrumentApi,
} from "tango-api";
import type {
  PullRequestDetail,
  PullRequestConversationItem,
  PullRequestReviewThread,
  PullRequestTimelineEvent,
  PullRequestTimelineItem,
} from "../types.ts";

type Props = {
  detail: PullRequestDetail;
  seenCount: number;
  totalFiles: number;
  onDescriptionUpdated?: () => void;
};

function formatRelativeTime(value: string): string {
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return "";
  const now = Date.now();
  const diffMs = now - ts;
  if (diffMs < 0) return "just now";

  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  // Older than 30 days — show date
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

type CheckAggregateState = "success" | "failure" | "running" | "neutral";

function aggregateCheckState(checks: PullRequestDetail["checks"]): CheckAggregateState {
  if (checks.length === 0) return "neutral";
  let running = false;
  for (const check of checks) {
    const status = String(check.status ?? "").toUpperCase();
    const conclusion = String(check.conclusion ?? "").toUpperCase();
    if (
      conclusion === "FAILURE"
      || conclusion === "TIMED_OUT"
      || conclusion === "CANCELLED"
      || conclusion === "STARTUP_FAILURE"
      || conclusion === "ACTION_REQUIRED"
    ) {
      return "failure";
    }
    if (status === "IN_PROGRESS" || status === "QUEUED" || status === "PENDING" || !conclusion) {
      running = true;
    }
  }
  return running ? "running" : "success";
}


function checkStateForItem(check: PullRequestDetail["checks"][number]): CheckAggregateState {
  const status = String(check.status ?? "").toUpperCase();
  const conclusion = String(check.conclusion ?? "").toUpperCase();
  if (conclusion === "FAILURE" || conclusion === "TIMED_OUT" || conclusion === "CANCELLED" || conclusion === "STARTUP_FAILURE" || conclusion === "ACTION_REQUIRED") return "failure";
  if (status === "IN_PROGRESS" || status === "QUEUED" || status === "PENDING" || !conclusion) return "running";
  return "success";
}

function CheckIcon({ state, size = 18 }: { state: CheckAggregateState; size?: number }) {
  const config = {
    success: { color: "#3fb950", icon: <path d="M7.5 12l2.5 2.5 5-5" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /> },
    failure: { color: "#f85149", icon: <><line x1="9" y1="9" x2="15" y2="15" stroke="#fff" strokeWidth="2" strokeLinecap="round" /><line x1="15" y1="9" x2="9" y2="15" stroke="#fff" strokeWidth="2" strokeLinecap="round" /></> },
    running: { color: "#d29922", icon: <circle cx="12" cy="12" r="3" fill="#fff" /> },
    neutral: { color: "#6e7681", icon: <circle cx="12" cy="12" r="3" fill="#fff" /> },
  }[state];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <circle cx="12" cy="12" r="11" fill={config.color} />
      {config.icon}
    </svg>
  );
}

function summarizeChecks(checks: PullRequestDetail["checks"]): string {
  let success = 0, failed = 0, running = 0;
  for (const check of checks) {
    const s = checkStateForItem(check);
    if (s === "failure") failed++;
    else if (s === "running") running++;
    else success++;
  }
  return `${success} passed \u00B7 ${running} running \u00B7 ${failed} failed`;
}

const STATUS_LABEL: Record<CheckAggregateState, { text: string; color: string }> = {
  success: { text: "success", color: "#3fb950" },
  failure: { text: "failure", color: "#f85149" },
  running: { text: "in_progress", color: "#d29922" },
  neutral: { text: "pending", color: "#6e7681" },
};

function ChecksIndicator({ state, checks }: { state: CheckAggregateState; checks: PullRequestDetail["checks"] }) {
  const [show, setShow] = React.useState(false);
  const iconRef = React.useRef<HTMLDivElement>(null);
  const [pos, setPos] = React.useState({ top: 0, left: 0 });

  const handleEnter = () => {
    if (checks.length === 0) return;
    const rect = iconRef.current?.getBoundingClientRect();
    if (rect) setPos({ top: rect.bottom + 6, left: rect.left });
    setShow(true);
  };

  return (
    <div
      ref={iconRef}
      style={{ display: "inline-flex", alignItems: "center", cursor: checks.length > 0 ? "pointer" : "default" }}
      onMouseEnter={handleEnter}
      onMouseLeave={() => setShow(false)}
    >
      <CheckIcon state={state} />
      {show && checks.length > 0 && ReactDOM.createPortal(
        <div style={{
          position: "fixed",
          top: pos.top,
          left: pos.left,
          zIndex: 9999,
          background: "#252525",
          border: "1px solid var(--tui-border)",
          borderRadius: 8,
          boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
          minWidth: 260,
          maxWidth: 360,
        }}>
          <div style={{
            padding: "8px 12px",
            borderBottom: "1px solid var(--tui-border)",
            fontSize: "11px",
            color: "#6e6e6e",
          }}>
            {summarizeChecks(checks)}
          </div>
          <div style={{ padding: "6px 0", display: "flex", flexDirection: "column", gap: 2 }}>
            {checks.map((check) => {
              const s = checkStateForItem(check);
              const label = STATUS_LABEL[s];
              return (
                <div key={check.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 12px" }}>
                  <span style={{
                    fontSize: "11px",
                    color: "var(--tui-text)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    flex: 1,
                    minWidth: 0,
                  }}>{check.name}</span>
                  <span style={{
                    fontSize: "11px",
                    color: label.color,
                    flexShrink: 0,
                    fontWeight: 500,
                  }}>{label.text}</span>
                </div>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Timeline Icons — inline SVGs for each event type
// ---------------------------------------------------------------------------

const ICON_SIZE = 14;
const iconStyle: React.CSSProperties = { width: ICON_SIZE, height: ICON_SIZE, flexShrink: 0, display: "block" };
const iconContainerStyle: React.CSSProperties = {
  position: "relative",
  zIndex: 1,
  flexShrink: 0,
  width: 28,
  height: 28,
  borderRadius: "50%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  overflow: "hidden",
};

function IconWrap({ className, children, color, borderColor }: {
  className: string;
  children: React.ReactNode;
  color?: string;
  borderColor?: string;
}) {
  return (
    <div className={`pr-timeline-icon ${className}`} style={{
      ...iconContainerStyle,
      ...(color ? { color } : {}),
      ...(borderColor ? { borderColor } : {}),
    }}>
      {children}
    </div>
  );
}

function TimelineIcon({ item }: { item: PullRequestTimelineItem }) {
  if (item.kind === "issue_comment") {
    return (
      <IconWrap className="icon-comment">
        <svg viewBox="0 0 16 16" fill="currentColor" width={ICON_SIZE} height={ICON_SIZE} style={iconStyle}>
          <path d="M1 2.75C1 1.784 1.784 1 2.75 1h10.5c.966 0 1.75.784 1.75 1.75v7.5A1.75 1.75 0 0113.25 12H9.06l-2.573 2.573A1.458 1.458 0 014 13.543V12H2.75A1.75 1.75 0 011 10.25v-7.5z" />
        </svg>
      </IconWrap>
    );
  }

  if (item.kind === "review") {
    if (item.state === "APPROVED") {
      return (
        <IconWrap className="icon-approved">
          <svg viewBox="0 0 16 16" fill="currentColor" width={ICON_SIZE} height={ICON_SIZE} style={iconStyle}>
            <path fillRule="evenodd" d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" />
          </svg>
        </IconWrap>
      );
    }
    if (item.state === "CHANGES_REQUESTED") {
      return (
        <IconWrap className="icon-changes-requested" color="#ef4444" borderColor="#ef4444">
          <svg viewBox="0 0 16 16" fill="currentColor" width={ICON_SIZE} height={ICON_SIZE} style={iconStyle}>
            <path fillRule="evenodd" d="M2 1.75C2 .784 2.784 0 3.75 0h8.5C13.216 0 14 .784 14 1.75v12.5A1.75 1.75 0 0112.25 16h-8.5A1.75 1.75 0 012 14.25V1.75zm1.75-.25a.25.25 0 00-.25.25v12.5c0 .138.112.25.25.25h8.5a.25.25 0 00.25-.25V1.75a.25.25 0 00-.25-.25h-8.5zM5 4.25a.75.75 0 01.75-.75h4.5a.75.75 0 010 1.5h-4.5A.75.75 0 015 4.25zm0 3a.75.75 0 01.75-.75h4.5a.75.75 0 010 1.5h-4.5A.75.75 0 015 7.25zm0 3a.75.75 0 01.75-.75h2.5a.75.75 0 010 1.5h-2.5a.75.75 0 01-.75-.75z" />
          </svg>
        </IconWrap>
      );
    }
    return (
      <IconWrap className="icon-review-commented">
        <svg viewBox="0 0 16 16" fill="currentColor" width={ICON_SIZE} height={ICON_SIZE} style={iconStyle}>
          <path d="M1 2.75C1 1.784 1.784 1 2.75 1h10.5c.966 0 1.75.784 1.75 1.75v7.5A1.75 1.75 0 0113.25 12H9.06l-2.573 2.573A1.458 1.458 0 014 13.543V12H2.75A1.75 1.75 0 011 10.25v-7.5z" />
        </svg>
      </IconWrap>
    );
  }

  if (item.kind === "review_thread") {
    return (
      <IconWrap className="icon-review-thread">
        <svg viewBox="0 0 16 16" fill="currentColor" width={ICON_SIZE} height={ICON_SIZE} style={iconStyle}>
          <path fillRule="evenodd" d="M2 1.75C2 .784 2.784 0 3.75 0h8.5C13.216 0 14 .784 14 1.75v12.5A1.75 1.75 0 0112.25 16h-8.5A1.75 1.75 0 012 14.25V1.75zm1.75-.25a.25.25 0 00-.25.25v12.5c0 .138.112.25.25.25h8.5a.25.25 0 00.25-.25V1.75a.25.25 0 00-.25-.25h-8.5zM5 4.25a.75.75 0 01.75-.75h4.5a.75.75 0 010 1.5h-4.5A.75.75 0 015 4.25zm0 3a.75.75 0 01.75-.75h4.5a.75.75 0 010 1.5h-4.5A.75.75 0 015 7.25zm0 3a.75.75 0 01.75-.75h2.5a.75.75 0 010 1.5h-2.5a.75.75 0 01-.75-.75z" />
        </svg>
      </IconWrap>
    );
  }

  // timeline_event
  const evt = item as PullRequestTimelineEvent;
  const svgProps = { viewBox: "0 0 16 16", fill: "currentColor", width: ICON_SIZE, height: ICON_SIZE, style: iconStyle } as const;

  switch (evt.eventType) {
    case "committed":
      return (
        <IconWrap className="icon-committed">
          <svg {...svgProps}>
            <path fillRule="evenodd" d="M10.5 7.75a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0zm1.43.75a4.002 4.002 0 01-7.86 0H.75a.75.75 0 010-1.5h3.32a4.002 4.002 0 017.86 0h3.32a.75.75 0 010 1.5h-3.32z" />
          </svg>
        </IconWrap>
      );
    case "force_pushed":
      return (
        <IconWrap className="icon-force-pushed">
          <svg {...svgProps}>
            <path fillRule="evenodd" d="M8.22 1.754a.25.25 0 00-.44 0L1.698 13.132a.25.25 0 00.22.368h12.164a.25.25 0 00.22-.368L8.22 1.754zm-1.763-.707c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0114.082 15H1.918a1.75 1.75 0 01-1.543-2.575L6.457 1.047zM9 11a1 1 0 11-2 0 1 1 0 012 0zm-.25-5.25a.75.75 0 00-1.5 0v2.5a.75.75 0 001.5 0v-2.5z" />
          </svg>
        </IconWrap>
      );
    case "labeled":
    case "unlabeled":
      return (
        <IconWrap className="icon-labeled">
          <svg {...svgProps}>
            <path fillRule="evenodd" d="M2.5 7.775V2.75a.25.25 0 01.25-.25h5.025a.25.25 0 01.177.073l6.25 6.25a.25.25 0 010 .354l-5.025 5.025a.25.25 0 01-.354 0l-6.25-6.25a.25.25 0 01-.073-.177zm-1.5 0V2.75C1 1.784 1.784 1 2.75 1h5.025c.464 0 .91.184 1.238.513l6.25 6.25a1.75 1.75 0 010 2.474l-5.026 5.026a1.75 1.75 0 01-2.474 0l-6.25-6.25A1.752 1.752 0 011 7.775zM6 5a1 1 0 100 2 1 1 0 000-2z" />
          </svg>
        </IconWrap>
      );
    case "merged":
      return (
        <IconWrap className="icon-merged">
          <svg {...svgProps}>
            <path fillRule="evenodd" d="M5 3.254V3.25v.005a.75.75 0 110-.005v.004zm.45 1.9a2.25 2.25 0 10-1.95.218v5.256a2.25 2.25 0 101.5 0V7.123A5.735 5.735 0 009.25 9h1.378a2.251 2.251 0 100-1.5H9.25a4.25 4.25 0 01-3.8-2.346zM12.75 9a.75.75 0 100-1.5.75.75 0 000 1.5zm-8.5 4.5a.75.75 0 100-1.5.75.75 0 000 1.5z" />
          </svg>
        </IconWrap>
      );
    case "closed":
      return (
        <IconWrap className="icon-closed">
          <svg {...svgProps}>
            <path fillRule="evenodd" d="M2.343 13.657A8 8 0 1113.657 2.343 8 8 0 012.343 13.657zM6.03 4.97a.75.75 0 00-1.06 1.06L6.94 8 4.97 9.97a.75.75 0 101.06 1.06L8 9.06l1.97 1.97a.75.75 0 101.06-1.06L9.06 8l1.97-1.97a.75.75 0 10-1.06-1.06L8 6.94 6.03 4.97z" />
          </svg>
        </IconWrap>
      );
    case "reopened":
      return (
        <IconWrap className="icon-reopened">
          <svg {...svgProps}>
            <path d="M8 9.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3z" />
            <path fillRule="evenodd" d="M8 0a8 8 0 100 16A8 8 0 008 0zM1.5 8a6.5 6.5 0 1113 0 6.5 6.5 0 01-13 0z" />
          </svg>
        </IconWrap>
      );
    case "review_requested":
    case "review_request_removed":
      return (
        <IconWrap className="icon-review-requested">
          <svg {...svgProps}>
            <path fillRule="evenodd" d="M1.679 7.932c.412-.621 1.242-1.75 2.366-2.717C5.175 4.242 6.527 3.5 8 3.5c1.473 0 2.825.742 3.955 1.715 1.124.967 1.954 2.096 2.366 2.717a.119.119 0 010 .136c-.412.621-1.242 1.75-2.366 2.717C10.825 11.758 9.473 12.5 8 12.5c-1.473 0-2.825-.742-3.955-1.715C2.921 9.818 2.091 8.69 1.679 8.068a.119.119 0 010-.136zM8 2c-1.981 0-3.67.992-4.933 2.078C1.797 5.169.88 6.423.43 7.1a1.619 1.619 0 000 1.798c.45.678 1.367 1.932 2.637 3.024C4.329 13.008 6.019 14 8 14c1.981 0 3.67-.992 4.933-2.078 1.27-1.091 2.187-2.345 2.637-3.023a1.619 1.619 0 000-1.798c-.45-.678-1.367-1.932-2.637-3.023C11.671 2.992 9.981 2 8 2zm0 8a2 2 0 100-4 2 2 0 000 4z" />
          </svg>
        </IconWrap>
      );
    case "assigned":
    case "unassigned":
      return (
        <IconWrap className="icon-assigned">
          <svg {...svgProps}>
            <path fillRule="evenodd" d="M10.5 5a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0zm.061 3.073a4 4 0 10-5.123 0 6.004 6.004 0 00-3.431 5.142.75.75 0 001.498.07 4.5 4.5 0 018.99 0 .75.75 0 101.498-.07 6.005 6.005 0 00-3.432-5.142z" />
          </svg>
        </IconWrap>
      );
    case "convert_to_draft":
    case "ready_for_review":
      return (
        <IconWrap className="icon-draft">
          <svg {...svgProps}>
            <path fillRule="evenodd" d="M2 1.75C2 .784 2.784 0 3.75 0h8.5C13.216 0 14 .784 14 1.75v12.5A1.75 1.75 0 0112.25 16h-8.5A1.75 1.75 0 012 14.25V1.75zm1.75-.25a.25.25 0 00-.25.25v12.5c0 .138.112.25.25.25h8.5a.25.25 0 00.25-.25V1.75a.25.25 0 00-.25-.25h-8.5z" />
          </svg>
        </IconWrap>
      );
    default:
      return (
        <IconWrap className="icon-committed">
          <svg {...svgProps}>
            <circle cx="8" cy="8" r="3" />
          </svg>
        </IconWrap>
      );
  }
}

// ---------------------------------------------------------------------------
// Compact timeline entry — one-liner for metadata events
// ---------------------------------------------------------------------------

function CompactTimelineEntry({ event }: { event: PullRequestTimelineEvent }) {
  const { eventType, actorLogin, createdAt, detail } = event;

  let actionText = "";
  let detailNode: React.ReactNode = null;

  switch (eventType) {
    case "committed":
      actionText = "committed";
      detailNode = (
        <>
          <span className="pr-timeline-compact-detail">{String(detail.shortSha ?? "")}</span>
          <span>{String(detail.message ?? "").split("\n")[0]}</span>
        </>
      );
      break;
    case "force_pushed":
      actionText = "force-pushed";
      detailNode = (
        <>
          <span className="pr-timeline-compact-detail">{String(detail.beforeSha ?? "")}</span>
          <span>{"\u2192"}</span>
          <span className="pr-timeline-compact-detail">{String(detail.afterSha ?? "")}</span>
        </>
      );
      break;
    case "labeled":
      actionText = "added label";
      detailNode = <LabelChip name={String(detail.labelName ?? "")} color={String(detail.labelColor ?? "")} />;
      break;
    case "unlabeled":
      actionText = "removed label";
      detailNode = <LabelChip name={String(detail.labelName ?? "")} color={String(detail.labelColor ?? "")} />;
      break;
    case "assigned":
      actionText = `assigned @${String(detail.assigneeLogin ?? "")}`;
      break;
    case "unassigned":
      actionText = `unassigned @${String(detail.assigneeLogin ?? "")}`;
      break;
    case "review_requested":
      actionText = `requested review from @${String(detail.reviewerLogin ?? "")}`;
      break;
    case "review_request_removed":
      actionText = `removed review request for @${String(detail.reviewerLogin ?? "")}`;
      break;
    case "merged":
      actionText = "merged this pull request";
      break;
    case "closed":
      actionText = "closed this pull request";
      break;
    case "reopened":
      actionText = "reopened this pull request";
      break;
    case "convert_to_draft":
      actionText = "converted to draft";
      break;
    case "ready_for_review":
      actionText = "marked as ready for review";
      break;
    default:
      actionText = eventType;
  }

  return (
    <div className="pr-timeline-compact" style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap", fontSize: 12, lineHeight: 1.5 }}>
      <span className="pr-timeline-compact-actor" style={{ fontWeight: 600, color: "var(--tui-text)" }}>@{actorLogin}</span>
      <span className="pr-timeline-compact-action" style={{ color: "var(--tui-text-secondary)" }}>{actionText}</span>
      {detailNode}
      <span style={{ color: "var(--tui-text-secondary)", opacity: 0.5 }}>{"\u00B7"}</span>
      <span className="pr-timeline-compact-time" style={{ fontSize: 11, color: "var(--tui-text-secondary)", opacity: 0.7 }}>{formatRelativeTime(createdAt)}</span>
    </div>
  );
}

function LabelChip({ name, color }: { name: string; color: string }) {
  const bgColor = color ? `#${color}22` : "rgba(255,255,255,0.06)";
  const textColor = color ? `#${color}` : "var(--tui-text-secondary)";
  const borderColor = color ? `#${color}44` : "rgba(255,255,255,0.15)";
  return (
    <span className="pr-timeline-label-chip" style={{ background: bgColor, color: textColor, borderColor }}>
      {name}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Commit entry — GitHub-style inline: [author] message ... sha
// ---------------------------------------------------------------------------

function CommitEntry({ event }: { event: PullRequestTimelineEvent }) {
  const message = String(event.detail.message ?? "").split("\n")[0];
  const shortSha = String(event.detail.shortSha ?? "");
  const url = String(event.detail.url ?? "");

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 8,
      fontSize: 12,
      lineHeight: 1.5,
      width: "100%",
    }}>
      <span style={{
        fontWeight: 600,
        color: "var(--tui-text)",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        flex: 1,
        minWidth: 0,
      }}>{message}</span>
      {url ? (
        <UILink href={url} label={shortSha} />
      ) : (
        <span style={{
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          fontSize: 11,
          color: "#60a5fa",
          flexShrink: 0,
        }}>{shortSha}</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compact review entry — one-liner for reviews without a body
// ---------------------------------------------------------------------------

function CompactReviewEntry({ item }: { item: PullRequestConversationItem & { kind: "review" } }) {
  const stateLabels: Record<string, string> = {
    APPROVED: "approved",
    CHANGES_REQUESTED: "requested changes",
    COMMENTED: "reviewed",
    DISMISSED: "dismissed review",
  };
  const action = stateLabels[item.state] ?? "reviewed";

  return (
    <div className="pr-timeline-compact" style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
      <span className="pr-timeline-compact-actor" style={{ fontWeight: 600 }}>@{item.authorLogin}</span>
      <span className="pr-timeline-compact-action">{action}</span>
      <span style={{ color: "var(--tui-text-secondary)", opacity: 0.5 }}>{"\u00B7"}</span>
      <span className="pr-timeline-compact-time" style={{ fontSize: 11, color: "var(--tui-text-secondary)", opacity: 0.7 }}>{formatRelativeTime(item.createdAt)}</span>
    </div>
  );
}

/** Returns true if a conversation item should render as a compact one-liner */
function isCompactConversationItem(item: PullRequestConversationItem): boolean {
  // Reviews with no body → compact
  if (item.kind === "review" && !item.body.trim()) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Reply box — inline textarea + send button
// ---------------------------------------------------------------------------

function ReplyBox({ onSubmit, onCancel }: {
  onSubmit: (body: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [body, setBody] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  const handleSubmit = async () => {
    const trimmed = body.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(trimmed);
      setBody("");
      onCancel();
    } catch {
      // Keep the box open so the user can retry
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Write a reply..."
        rows={3}
        style={{
          width: "100%",
          background: "var(--tui-bg-secondary, #1a1a1a)",
          color: "var(--tui-text)",
          border: "1px solid var(--tui-border)",
          borderRadius: 6,
          padding: "8px 10px",
          fontSize: 12,
          resize: "vertical",
          fontFamily: "inherit",
          outline: "none",
          boxSizing: "border-box",
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            handleSubmit();
          }
        }}
      />
      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
        <UIButton label="Cancel" variant="secondary" size="sm" onClick={onCancel} />
        <UIButton
          label={submitting ? "Sending..." : "Reply"}
          variant="primary"
          size="sm"
          disabled={!body.trim() || submitting}
          onClick={handleSubmit}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Full card items (comments, reviews, threads) — wrapped in timeline layout
// ---------------------------------------------------------------------------

function FullTimelineItem({ item, proxyImage, onReplyIssueComment, onReplyReviewThread, onResolveThread, onUnresolveThread }: {
  item: PullRequestConversationItem;
  proxyImage?: (src: string) => Promise<string>;
  onReplyIssueComment?: (body: string) => Promise<void>;
  onReplyReviewThread?: (commentId: string, body: string) => Promise<void>;
  onResolveThread?: (thread: PullRequestReviewThread) => Promise<void>;
  onUnresolveThread?: (thread: PullRequestReviewThread) => Promise<void>;
}) {
  const [showReply, setShowReply] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);

  if (item.kind === "issue_comment") {
    return (
      <UIContainer>
        <div className="tui-row" style={{ gap: 8, alignItems: "center", marginBottom: 6 }}>
          <UIBadge label="COMMENT" tone="neutral" />
          <span style={{ fontSize: "12px", fontWeight: 500 }}>@{item.authorLogin}</span>
          <span style={{ color: "var(--tui-text-secondary)", fontSize: "11px" }}>{formatRelativeTime(item.createdAt)}</span>
        </div>
        <UIMarkdownRenderer content={item.body || "_No content_"} proxyImage={proxyImage} />
        {onReplyIssueComment && !showReply && (
          <div style={{ marginTop: 6 }}>
            <UIButton label="Reply" variant="secondary" size="sm" onClick={() => setShowReply(true)} />
          </div>
        )}
        {showReply && onReplyIssueComment && (
          <ReplyBox
            onSubmit={onReplyIssueComment}
            onCancel={() => setShowReply(false)}
          />
        )}
      </UIContainer>
    );
  }

  if (item.kind === "review") {
    const reviewTone = item.state === "APPROVED"
      ? "success"
      : item.state === "CHANGES_REQUESTED"
        ? "danger"
        : "neutral" as const;

    return (
      <UIContainer>
        <div className="tui-row" style={{ gap: 8, alignItems: "center", marginBottom: 6 }}>
          <UIBadge label={`REVIEW \u00B7 ${item.state}`} tone={reviewTone} />
          <span style={{ fontSize: "12px", fontWeight: 500 }}>@{item.authorLogin}</span>
          <span style={{ color: "var(--tui-text-secondary)", fontSize: "11px" }}>{formatRelativeTime(item.createdAt)}</span>
        </div>
        <UIMarkdownRenderer content={item.body} proxyImage={proxyImage} />
      </UIContainer>
    );
  }

  // review_thread
  const threadTitle = item.line != null ? `${item.path}:${item.line}` : item.path;
  const lastComment = item.comments[item.comments.length - 1];

  // Resolved thread — collapsed by default, expandable to see content
  if (item.isResolved === true) {
    const rootAuthor = item.comments[0]?.authorLogin ?? "unknown";
    return (
      <UIContainer>
        <div
          className="tui-row"
          style={{ gap: 8, alignItems: "center", cursor: "pointer" }}
          onClick={() => setExpanded(!expanded)}
        >
          <span style={{ fontSize: "11px", color: "var(--tui-text-secondary)", userSelect: "none" }}>{expanded ? "\u25BC" : "\u25B6"}</span>
          <span style={{ fontSize: "12px", color: "var(--tui-text-secondary)" }}>{threadTitle}</span>
          <span style={{ fontSize: "12px", fontWeight: 500 }}>@{rootAuthor}</span>
          <UIBadge label="Resolved" tone="success" />
          {item.nodeId && onUnresolveThread && (
            <UIButton label="Unresolve" variant="secondary" size="sm" onClick={(e: React.MouseEvent) => { e.stopPropagation(); onUnresolveThread(item); }} />
          )}
        </div>
        {expanded && (
          <div style={{ marginTop: 8 }}>
            {item.comments.map((comment) => (
              <div key={comment.id} style={{ padding: "8px 0", borderTop: "1px solid var(--tui-border)" }}>
                <div className="tui-row" style={{ gap: 8, marginBottom: 4 }}>
                  <span style={{ fontWeight: 500, fontSize: "12px" }}>@{comment.authorLogin}</span>
                  <span style={{ color: "var(--tui-text-secondary)", fontSize: "11px" }}>{formatRelativeTime(comment.createdAt)}</span>
                </div>
                <UIMarkdownRenderer content={comment.body || "_No content_"} proxyImage={proxyImage} />
              </div>
            ))}
          </div>
        )}
      </UIContainer>
    );
  }

  // Unresolved thread — full content
  return (
    <UIContainer>
      <div className="tui-row" style={{ gap: 8, alignItems: "center", marginBottom: 6 }}>
        <UIBadge label="REVIEW THREAD" tone="info" />
        <span style={{ fontSize: "12px" }}>{threadTitle}</span>
        <span style={{ color: "var(--tui-text-secondary)", fontSize: "11px" }}>{formatRelativeTime(item.createdAt)}</span>
      </div>
      {item.comments.map((comment) => (
        <div key={comment.id} style={{ padding: "8px 0", borderTop: "1px solid var(--tui-border)" }}>
          <div className="tui-row" style={{ gap: 8, marginBottom: 4 }}>
            <span style={{ fontWeight: 500, fontSize: "12px" }}>@{comment.authorLogin}</span>
            <span style={{ color: "var(--tui-text-secondary)", fontSize: "11px" }}>{formatRelativeTime(comment.createdAt)}</span>
          </div>
          <UIMarkdownRenderer content={comment.body || "_No content_"} proxyImage={proxyImage} />
        </div>
      ))}
      <div style={{ marginTop: 6, borderTop: "1px solid var(--tui-border)", paddingTop: 8, display: "flex", gap: 6 }}>
        {onReplyReviewThread && lastComment && !showReply && (
          <UIButton label="Reply" variant="secondary" size="sm" onClick={() => setShowReply(true)} />
        )}
        {item.nodeId && onResolveThread && (
          <UIButton label="Resolve" variant="secondary" size="sm" onClick={() => onResolveThread(item)} />
        )}
      </div>
      {showReply && onReplyReviewThread && lastComment && (
        <div style={{ borderTop: "1px solid var(--tui-border)", paddingTop: 8 }}>
          <ReplyBox
            onSubmit={(body) => onReplyReviewThread(lastComment.id, body)}
            onCancel={() => setShowReply(false)}
          />
        </div>
      )}
    </UIContainer>
  );
}

export function ConversationTabContainerContent({ detail, seenCount, totalFiles, onDescriptionUpdated }: Props) {
  const api = useInstrumentApi();
  const checksState = aggregateCheckState(detail.checks);

  const proxyImage = useCallback(async (url: string): Promise<string> => {
    const result = await api.actions.call("proxyImage", { url });
    return (result as { dataUri: string }).dataUri;
  }, [api]);

  // Editable description state
  const [editingBody, setEditingBody] = React.useState(false);
  const [bodyDraft, setBodyDraft] = React.useState("");
  const [savingBody, setSavingBody] = React.useState(false);
  const [bodyViewMode, setBodyViewMode] = React.useState<"raw" | "preview">("raw");

  const handleStartEditBody = React.useCallback(() => {
    setBodyDraft(detail.body);
    setBodyViewMode("raw");
    setEditingBody(true);
  }, [detail.body]);

  const handleSaveBody = React.useCallback(async () => {
    if (savingBody) return;
    setSavingBody(true);
    try {
      await api.actions.call("updatePullRequest", {
        repo: detail.repo,
        number: detail.number,
        body: bodyDraft,
      });
      setEditingBody(false);
      onDescriptionUpdated?.();
    } catch {
      // Keep editor open so user can retry
    } finally {
      setSavingBody(false);
    }
  }, [api, detail.repo, detail.number, bodyDraft, savingBody, onDescriptionUpdated]);

  const handleCancelEditBody = React.useCallback(() => {
    setEditingBody(false);
  }, []);

  return (
    <>
      <UIKeyValue labelWidth="90px" items={[
        { label: "Repository", value: <UILink href={`https://github.com/${detail.repo}`} label={detail.repo} /> },
        { label: "Checks", value: <ChecksIndicator state={checksState} checks={detail.checks} /> },
        { label: "Author", value: `@${detail.authorLogin}` },
        { label: "Seen", value: `${seenCount}/${totalFiles} files` },
      ]} />
      {detail.warnings.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {detail.warnings.map((w, i) => (
            <UIBadge key={i} label={w} tone="warning" />
          ))}
        </div>
      )}
      <div style={{ borderTop: "1px solid var(--tui-border)", margin: "12px 0" }} />
      <div className="tui-row" style={{ alignItems: "center", gap: 6, marginBottom: 8 }}>
        <h3 style={{ fontSize: "13px", color: "var(--tui-text-secondary)", margin: 0 }}>PR Description</h3>
        {!editingBody && (
          <UIIconButton
            icon={<UIIcon name="pencil" size={14} />}
            label="Edit description"
            onClick={handleStartEditBody}
          />
        )}
      </div>
      {editingBody ? (
        <div className="tui-col" style={{ gap: 8 }}>
          <UISegmentedControl
            options={[
              { value: "raw", label: "Raw" },
              { value: "preview", label: "Preview" },
            ]}
            value={bodyViewMode}
            onChange={(v) => setBodyViewMode(v as "raw" | "preview")}
          />
          {bodyViewMode === "raw" ? (
            <textarea
              value={bodyDraft}
              onChange={(e) => setBodyDraft(e.target.value)}
              rows={12}
              style={{
                width: "100%",
                background: "var(--tui-bg-secondary, #1a1a1a)",
                color: "var(--tui-text)",
                border: "1px solid var(--tui-border)",
                borderRadius: 6,
                padding: "8px 10px",
                fontSize: 12,
                resize: "vertical",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          ) : (
            <div style={{
              border: "1px solid var(--tui-border)",
              borderRadius: 6,
              padding: "8px 10px",
              minHeight: 100,
            }}>
              {bodyDraft.trim() ? (
                <UIMarkdownRenderer content={bodyDraft} proxyImage={proxyImage} />
              ) : (
                <span style={{ color: "var(--tui-text-secondary)", fontSize: 12 }}>Nothing to preview</span>
              )}
            </div>
          )}
          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
            <UIButton
              label="Cancel"
              variant="secondary"
              size="sm"
              disabled={savingBody}
              onClick={handleCancelEditBody}
            />
            <UIButton
              label={savingBody ? "Saving..." : "Save"}
              variant="primary"
              size="sm"
              disabled={savingBody}
              onClick={handleSaveBody}
            />
          </div>
        </div>
      ) : detail.body.trim() ? (
        <UIMarkdownRenderer content={detail.body} proxyImage={proxyImage} />
      ) : (
        <UIEmptyState title="No description" />
      )}
    </>
  );
}

export function ConversationTabComments({ detail, onReplied }: {
  detail: PullRequestDetail;
  onReplied?: () => void;
}) {
  const api = useInstrumentApi();
  // The conversation field now contains the merged timeline (conversation items + timeline events).
  const timelineItems = detail.conversation as unknown as PullRequestTimelineItem[];

  const proxyImage = useCallback(async (url: string): Promise<string> => {
    const result = await api.actions.call("proxyImage", { url });
    return (result as { dataUri: string }).dataUri;
  }, [api]);

  const handleReplyIssueComment = React.useCallback(async (body: string) => {
    await api.actions.call("addIssueComment", {
      repo: detail.repo,
      number: detail.number,
      body,
    });
    onReplied?.();
  }, [api, detail.repo, detail.number, onReplied]);

  const handleReplyReviewThread = React.useCallback(async (commentId: string, body: string) => {
    await api.actions.call("replyReviewComment", {
      repo: detail.repo,
      number: detail.number,
      commentId,
      body,
    });
    onReplied?.();
  }, [api, detail.repo, detail.number, onReplied]);

  const handleResolveThread = React.useCallback(async (thread: PullRequestReviewThread) => {
    if (!thread.nodeId) return;
    await api.actions.call("resolveReviewThread", { nodeId: thread.nodeId });
    onReplied?.();
  }, [api, onReplied]);

  const handleUnresolveThread = React.useCallback(async (thread: PullRequestReviewThread) => {
    if (!thread.nodeId) return;
    await api.actions.call("unresolveReviewThread", { nodeId: thread.nodeId });
    onReplied?.();
  }, [api, onReplied]);

  const entryStyle: React.CSSProperties = {
    position: "relative",
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    padding: "6px 0",
  };
  const contentStyle: React.CSSProperties = { flex: 1, minWidth: 0, paddingTop: 3 };

  return (
    <div className="tui-col" style={{ gap: 0 }}>
      <style>{`.tui-markdown-body blockquote { color: rgba(255,255,255,0.45); }`}</style>
      <h3 style={{ fontSize: "13px", color: "var(--tui-text-secondary)", margin: "4px 0 8px" }}>Timeline</h3>
      {timelineItems.length === 0 ? (
        <UIEmptyState title="No activity yet" />
      ) : (
        <div className="pr-timeline" style={{ position: "relative", paddingLeft: 0 }}>
          {/* Vertical line */}
          <div style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: 13,
            width: 2,
            background: "var(--tui-border, #333)",
            pointerEvents: "none",
          }} />
          {timelineItems.map((item) => {
            // Commit events: GitHub-style inline row
            if (item.kind === "timeline_event" && item.eventType === "committed") {
              return (
                <div key={item.id} className="pr-timeline-entry" style={entryStyle}>
                  <TimelineIcon item={item} />
                  <div className="pr-timeline-content" style={contentStyle}>
                    <CommitEntry event={item} />
                  </div>
                </div>
              );
            }

            // Other timeline events: compact one-liner
            if (item.kind === "timeline_event") {
              return (
                <div key={item.id} className="pr-timeline-entry" style={entryStyle}>
                  <TimelineIcon item={item} />
                  <div className="pr-timeline-content" style={contentStyle}>
                    <CompactTimelineEntry event={item} />
                  </div>
                </div>
              );
            }

            // Conversation items: compact for body-less reviews, full card otherwise
            const convItem = item as PullRequestConversationItem;
            if (isCompactConversationItem(convItem) && convItem.kind === "review") {
              return (
                <div key={convItem.id} className="pr-timeline-entry" style={entryStyle}>
                  <TimelineIcon item={convItem} />
                  <div className="pr-timeline-content" style={contentStyle}>
                    <CompactReviewEntry item={convItem as PullRequestConversationItem & { kind: "review" }} />
                  </div>
                </div>
              );
            }

            return (
              <div key={convItem.id} className="pr-timeline-entry" style={entryStyle}>
                <TimelineIcon item={convItem} />
                <div className="pr-timeline-content" style={contentStyle}>
                  <div className="pr-timeline-full">
                    <FullTimelineItem
                      item={convItem}
                      proxyImage={proxyImage}
                      onReplyIssueComment={convItem.kind === "issue_comment" ? handleReplyIssueComment : undefined}
                      onReplyReviewThread={convItem.kind === "review_thread" ? handleReplyReviewThread : undefined}
                      onResolveThread={convItem.kind === "review_thread" ? handleResolveThread : undefined}
                      onUnresolveThread={convItem.kind === "review_thread" ? handleUnresolveThread : undefined}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
