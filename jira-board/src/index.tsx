import { useState, useEffect, useCallback } from "react";
import {
  defineReactInstrument,
  useInstrumentApi,
  useInstrumentAction,
  useHostEvent,
  UIRoot,
  UIScrollArea,
  UIPanelHeader,
  UIList,
  UIListItem,
  UIBadge,
  UIKeyValue,
  UIMarkdownRenderer,
  UIEmptyState,
  UIIconButton,
  UILink,
  UISection,
  UICard,
} from "tango-api";

// --- Types ---

interface JiraIssue {
  key: string;
  fields: {
    summary?: string;
    status?: { name: string };
    assignee?: { displayName: string };
    priority?: { name: string };
    issuetype?: { name: string };
    description?: unknown;
    created?: string;
    updated?: string;
    labels?: string[];
    sprint?: { name: string };
    [k: string]: unknown;
  };
}

type SourceId = "core-client-30" | "core-client" | "assigned-to-me";

interface SourceConfig {
  id: SourceId;
  label: string;
}

const SOURCES: SourceConfig[] = [
  { id: "core-client-30", label: "Core Client 30%" },
  { id: "core-client", label: "Core Client" },
  { id: "assigned-to-me", label: "Assigned to me" },
];

// --- Helpers ---

function statusTone(status: string): "neutral" | "info" | "success" | "warning" | "danger" {
  const s = status.toLowerCase();
  if (s.includes("done") || s.includes("closed") || s.includes("resolved")) return "success";
  if (s.includes("progress") || s.includes("review")) return "info";
  if (s.includes("blocked")) return "danger";
  if (s.includes("todo") || s.includes("open") || s.includes("backlog")) return "neutral";
  return "warning";
}

function formatDate(iso?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

// --- ADF to Markdown converter ---

interface AdfNode {
  type: string;
  text?: string;
  content?: AdfNode[];
  marks?: { type: string }[];
  attrs?: Record<string, unknown>;
}

function adfToMarkdown(node: unknown): string {
  if (!node || typeof node !== "object") return typeof node === "string" ? node : "";
  const n = node as AdfNode;

  // Text leaf node
  if (n.type === "text") {
    let text = n.text ?? "";
    if (n.marks) {
      for (const mark of n.marks) {
        if (mark.type === "strong") text = `**${text}**`;
        else if (mark.type === "em") text = `*${text}*`;
        else if (mark.type === "code") text = `\`${text}\``;
        else if (mark.type === "strike") text = `~~${text}~~`;
      }
    }
    return text;
  }

  const children = (n.content ?? []).map(adfToMarkdown).join("");

  switch (n.type) {
    case "doc":
      return children;
    case "paragraph":
      return children + "\n\n";
    case "heading": {
      const level = (n.attrs?.level as number) ?? 1;
      return "#".repeat(level) + " " + children + "\n\n";
    }
    case "bulletList":
      return children;
    case "orderedList":
      return children;
    case "listItem":
      return "- " + children.trim() + "\n";
    case "codeBlock":
      return "```\n" + children + "\n```\n\n";
    case "blockquote":
      return children.split("\n").map((l: string) => "> " + l).join("\n") + "\n\n";
    case "hardBreak":
      return "\n";
    case "rule":
      return "---\n\n";
    case "mention":
      return `@${n.attrs?.text ?? "user"}`;
    case "inlineCard":
    case "mediaGroup":
    case "mediaSingle":
    case "media":
      return "";
    default:
      return children;
  }
}

const HEADER_STYLE = { padding: "8px 12px 0" };

// --- Sidebar Panel ---

function SidebarPanel() {
  const api = useInstrumentApi();
  const selectSource = useInstrumentAction<{ sourceId: string }>("selectSource");
  const [activeSource, setActiveSource] = useState<SourceId | null>(null);

  // Restore last selection on mount
  useEffect(() => {
    let cancelled = false;
    api.storage.getProperty<SourceId>("selectedSource").then((saved) => {
      if (!saved || cancelled) return;
      setActiveSource(saved);
      selectSource({ sourceId: saved }).catch(() => {});
    });
    return () => { cancelled = true; };
  }, []);

  const handleSelect = useCallback((sourceId: SourceId) => {
    setActiveSource(sourceId);
    api.storage.setProperty("selectedSource", sourceId);
    selectSource({ sourceId }).catch(() => {});
  }, [api, selectSource]);

  return (
    <UIRoot>
      <UIPanelHeader title="Jira Board" style={HEADER_STYLE} />
      <UIScrollArea>
        <UIList>
          {SOURCES.map((source) => (
            <UIListItem
              key={source.id}
              title={source.label}
              active={activeSource === source.id}
              onClick={() => handleSelect(source.id)}
            />
          ))}
        </UIList>
      </UIScrollArea>
    </UIRoot>
  );
}

// --- Ticket List Panel ---

function TicketListPanel() {
  const api = useInstrumentApi();
  const selectSource = useInstrumentAction<{ sourceId: string }, { issues: JiraIssue[]; sourceId: string }>("selectSource");
  const selectTicket = useInstrumentAction<{ key: string }>("selectTicket");

  const [issues, setIssues] = useState<JiraIssue[]>([]);
  const [sourceLabel, setSourceLabel] = useState("");
  const [loading, setLoading] = useState(false);
  const [currentSourceId, setCurrentSourceId] = useState<SourceId | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [loadingTicket, setLoadingTicket] = useState<string | null>(null);

  const loadSource = useCallback(async (sourceId: SourceId) => {
    const source = SOURCES.find((s) => s.id === sourceId);
    setSourceLabel(source?.label ?? "");
    setCurrentSourceId(sourceId);
    setLoading(true);
    setIssues([]);
    setSelectedKey(null);
    try {
      const result = await selectSource({ sourceId });
      setIssues(result.issues ?? []);
    } catch {
      // Backend not ready
    } finally {
      setLoading(false);
    }
  }, [selectSource]);

  // Watch storage for sidebar source changes
  useEffect(() => {
    let cancelled = false;
    let lastSource: string | null = null;

    const check = async () => {
      const saved = await api.storage.getProperty<SourceId>("selectedSource");
      if (!cancelled && saved && saved !== lastSource) {
        lastSource = saved;
        loadSource(saved);
      }
    };

    check();
    const interval = setInterval(check, 300);
    return () => { cancelled = true; clearInterval(interval); };
  }, [api, loadSource]);

  const handleSelectTicket = useCallback(async (key: string) => {
    setSelectedKey(key);
    setLoadingTicket(key);
    try {
      await selectTicket({ key });
    } finally {
      setLoadingTicket(null);
    }
  }, [selectTicket]);

  if (!sourceLabel) {
    return (
      <UIRoot>
        <UIEmptyState title="Select a board" description="Choose a board or filter from the sidebar" />
      </UIRoot>
    );
  }

  return (
    <UIRoot>
      <UIPanelHeader
        title={sourceLabel}
        subtitle={loading ? "Loading..." : `${issues.length} tickets`}
        style={HEADER_STYLE}
      />
      <UIScrollArea>
        {loading ? (
          <UIEmptyState title="Fetching issues..." />
        ) : issues.length === 0 ? (
          <UIEmptyState title="No tickets" description="No tickets found for this board" />
        ) : (
          <UIList>
            {issues.map((issue) => (
              <UIListItem
                key={issue.key}
                title={issue.key}
                subtitle={issue.fields.summary ?? ""}
                active={selectedKey === issue.key}
                onClick={() => handleSelectTicket(issue.key)}
              />
            ))}
          </UIList>
        )}
      </UIScrollArea>
    </UIRoot>
  );
}

// --- Ticket Detail Panel ---

function TicketDetailPanel() {
  const api = useInstrumentApi();

  const [issue, setIssue] = useState<JiraIssue | null>(null);

  // Listen for backend pushing ticket detail
  useHostEvent(
    "instrument.event",
    useCallback((payload: { event: string; payload?: { issue?: JiraIssue } }) => {
      if (payload.event === "ticket.loaded" && payload.payload?.issue) {
        setIssue(payload.payload.issue);
      }
    }, []),
  );

  if (!issue) {
    return (
      <UIRoot>
        <UIEmptyState title="Select a ticket" description="Click a ticket from the list to view details" />
      </UIRoot>
    );
  }

  const f = issue.fields;
  const jiraUrl = `https://tactilegames.atlassian.net/browse/${issue.key}`;

  return (
    <UIRoot>
      <UIPanelHeader
        title={issue.key}
        subtitle={f.summary ?? ""}
        style={HEADER_STYLE}
        rightActions={
          <UIIconButton icon="external-link" label="Open in Jira" onClick={() => api.ui.openUrl(jiraUrl)} />
        }
      />
      <UIScrollArea>
        <UISection title="Details">
          <UIKeyValue
            items={[
              { label: "Status", value: f.status?.name ? <UIBadge label={f.status.name} tone={statusTone(f.status.name)} /> : "—" },
              { label: "Type", value: f.issuetype?.name ?? "—" },
              { label: "Priority", value: f.priority?.name ?? "—" },
              { label: "Assignee", value: f.assignee?.displayName ?? "Unassigned" },
              { label: "Labels", value: f.labels?.length ? f.labels.join(", ") : "None" },
              { label: "Created", value: formatDate(f.created) },
              { label: "Updated", value: formatDate(f.updated) },
            ]}
          />
        </UISection>

        {f.description && (
          <UISection title="Description">
            <UICard>
              <UIMarkdownRenderer
                content={typeof f.description === "string" ? f.description : adfToMarkdown(f.description)}
                renderMarkdown={api.ui.renderMarkdown}
              />
            </UICard>
          </UISection>
        )}

        <UISection>
          <UILink href={jiraUrl} label="Open in Jira" external />
        </UISection>
      </UIScrollArea>
    </UIRoot>
  );
}

// --- Instrument Definition ---

export default defineReactInstrument({
  defaults: {
    visible: {
      sidebar: true,
      first: true,
      second: true,
    },
  },
  panels: {
    sidebar: SidebarPanel,
    first: TicketListPanel,
    second: TicketDetailPanel,
  },
});
