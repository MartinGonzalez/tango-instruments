import { useCallback, useEffect, useRef, useState } from "react";
import {
  useInstrumentApi,
  useHostEvent,
  UIRoot,
  UIButton,
} from "tango-api";
import type { DebugEntry } from "../lib/debug-log.ts";
import type { DiaryEntry } from "../types.ts";
import { useSelectedDate } from "../index.tsx";

type FrontendLogEntry = {
  timestamp: string;
  source: string;
  event: string;
  detail: string;
};

type Tab = "logs" | "raw-data";

export function DebugPanel() {
  const [activeTab, setActiveTab] = useState<Tab>("logs");

  return (
    <UIRoot>
      <div style={{ padding: "12px" }}>
        <div
          style={{
            display: "flex",
            gap: "0",
            marginBottom: "12px",
            borderBottom: "1px solid var(--tui-border)",
          }}
        >
          <TabButton
            label="Logs"
            active={activeTab === "logs"}
            onClick={() => setActiveTab("logs")}
          />
          <TabButton
            label="Raw Data"
            active={activeTab === "raw-data"}
            onClick={() => setActiveTab("raw-data")}
          />
        </div>

        {activeTab === "logs" ? <LogsTab /> : <RawDataTab />}
      </div>
    </UIRoot>
  );
}

function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "6px 14px",
        fontSize: "12px",
        fontWeight: active ? 600 : 400,
        color: active ? "var(--tui-primary)" : "var(--tui-text-secondary)",
        background: "transparent",
        border: "none",
        borderBottom: active ? "2px solid var(--tui-primary)" : "2px solid transparent",
        cursor: "pointer",
        marginBottom: "-1px",
      }}
    >
      {label}
    </button>
  );
}

function LogsTab() {
  const api = useInstrumentApi();
  const [backendEntries, setBackendEntries] = useState<DebugEntry[]>([]);
  const [frontendEntries, setFrontendEntries] = useState<FrontendLogEntry[]>([]);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const frontendEntriesRef = useRef(frontendEntries);
  frontendEntriesRef.current = frontendEntries;

  useHostEvent("session.stream", (payload: any) => {
    const eventType = `${payload?.event?.type ?? "?"}/${payload?.event?.subtype ?? ""}`;
    const entry: FrontendLogEntry = {
      timestamp: new Date().toISOString(),
      source: "FRONTEND:session.stream",
      event: eventType,
      detail: `sid=${String(payload?.sessionId ?? "?").slice(0, 12)}… keys=${Object.keys(payload?.event ?? {}).join(",")}`,
    };
    const next = [...frontendEntriesRef.current, entry].slice(-100);
    setFrontendEntries(next);
  });

  useHostEvent("session.ended", (payload: any) => {
    const entry: FrontendLogEntry = {
      timestamp: new Date().toISOString(),
      source: "FRONTEND:session.ended",
      event: "ended",
      detail: `sid=${String(payload?.sessionId ?? "?").slice(0, 12)}… exitCode=${payload?.exitCode}`,
    };
    const next = [...frontendEntriesRef.current, entry].slice(-100);
    setFrontendEntries(next);
  });

  useHostEvent("snapshot.update", (payload: any) => {
    const taskCount = payload?.tasks?.length ?? 0;
    const entry: FrontendLogEntry = {
      timestamp: new Date().toISOString(),
      source: "FRONTEND:snapshot.update",
      event: "snapshot",
      detail: `tasks=${taskCount}`,
    };
    const next = [...frontendEntriesRef.current, entry].slice(-100);
    setFrontendEntries(next);
  });

  useHostEvent("instrument.event", (payload: any) => {
    const entry: FrontendLogEntry = {
      timestamp: new Date().toISOString(),
      source: "FRONTEND:instrument.event",
      event: String(payload?.event ?? "?"),
      detail: `from=${payload?.instrumentId} data=${JSON.stringify(payload?.payload).slice(0, 100)}`,
    };
    const next = [...frontendEntriesRef.current, entry].slice(-100);
    setFrontendEntries(next);
  });

  const fetchLog = useCallback(async () => {
    try {
      const result = await api.actions.call<
        Record<string, never>,
        { entries: DebugEntry[] }
      >("getDebugLog", {});
      setBackendEntries(result.entries);
    } catch {
      // ignore
    }
  }, [api]);

  useEffect(() => {
    fetchLog();
  }, [fetchLog]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchLog, 2_000);
    return () => clearInterval(interval);
  }, [fetchLog, autoRefresh]);

  const handleClear = useCallback(async () => {
    await api.actions.call("clearDebugLog", {});
    setBackendEntries([]);
    setFrontendEntries([]);
  }, [api]);

  const handleTestEmit = useCallback(async () => {
    await api.actions.call("testEmit", {});
    setTimeout(fetchLog, 500);
  }, [api, fetchLog]);

  const allEntries: FrontendLogEntry[] = [
    ...backendEntries.map((e) => ({
      timestamp: e.timestamp,
      source: `BACKEND:${e.source}`,
      event: e.event,
      detail: e.detail,
    })),
    ...frontendEntries,
  ].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  return (
    <>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "8px",
        }}
      >
        <span
          style={{
            fontSize: "11px",
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.5px",
            color: "#606672",
          }}
        >
          Debug Log ({allEntries.length} entries — B:{backendEntries.length} F:{frontendEntries.length})
        </span>
        <div style={{ display: "flex", gap: "8px" }}>
          <UIButton label="Test Emit" variant="primary" onClick={handleTestEmit} />
          <UIButton label={autoRefresh ? "Pause" : "Resume"} variant="secondary" onClick={() => setAutoRefresh((v) => !v)} />
          <UIButton label="Refresh" variant="secondary" onClick={fetchLog} />
          <UIButton label="Clear" variant="secondary" onClick={handleClear} />
        </div>
      </div>

      <div
        style={{
          fontFamily: "monospace",
          fontSize: "11px",
          lineHeight: "1.5",
          background: "var(--tui-bg-secondary)",
          borderRadius: "6px",
          padding: "8px",
          maxHeight: "calc(100vh - 120px)",
          overflow: "auto",
        }}
      >
        {allEntries.length === 0 ? (
          <div style={{ color: "var(--tui-text-secondary)", padding: "20px", textAlign: "center" }}>
            No events received yet. Try sending a message in another Tango session.
          </div>
        ) : (
          [...allEntries].reverse().map((entry, i) => {
            const time = new Date(entry.timestamp).toLocaleTimeString("en-US", {
              hour12: false,
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            });
            const isFrontend = entry.source.startsWith("FRONTEND:");
            const sourceColor = isFrontend ? "#ef4444" : getSourceColor(entry.source.replace("BACKEND:", ""));
            return (
              <div
                key={`${entry.timestamp}-${i}`}
                style={{
                  borderBottom: "1px solid var(--tui-border)",
                  padding: "3px 0",
                }}
              >
                <span style={{ color: "var(--tui-text-secondary)" }}>{time}</span>
                {" "}
                <span style={{ color: sourceColor, fontWeight: 600 }}>
                  [{entry.source}]
                </span>
                {" "}
                <span style={{ color: "var(--tui-primary)" }}>{entry.event}</span>
                {" "}
                <span style={{ color: "var(--tui-text)" }}>{entry.detail}</span>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}

function RawDataTab() {
  const api = useInstrumentApi();
  const selectedDate = useSelectedDate();
  const [diary, setDiary] = useState<DiaryEntry | null>(null);

  const fetchDiary = useCallback(async () => {
    try {
      const result = await api.actions.call<
        { date: string },
        { diary: DiaryEntry | null }
      >("getDiary", { date: selectedDate });
      setDiary(result.diary);
    } catch {
      setDiary(null);
    }
  }, [api, selectedDate]);

  useEffect(() => {
    fetchDiary();
  }, [fetchDiary]);

  useEffect(() => {
    const interval = setInterval(fetchDiary, 10_000);
    return () => clearInterval(interval);
  }, [fetchDiary]);

  if (!diary) {
    return (
      <div style={{ color: "var(--tui-text-secondary)", padding: "20px", textAlign: "center", fontSize: "13px" }}>
        No diary data for this date.
      </div>
    );
  }

  const allActivities = Object.values(diary.sections).flatMap((s) => s.activities);

  if (allActivities.length === 0) {
    return (
      <div style={{ color: "var(--tui-text-secondary)", padding: "20px", textAlign: "center", fontSize: "13px" }}>
        No activities recorded yet.
      </div>
    );
  }

  return (
    <div
      style={{
        maxHeight: "calc(100vh - 120px)",
        overflow: "auto",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "8px",
        }}
      >
        <span
          style={{
            fontSize: "11px",
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.5px",
            color: "#606672",
          }}
        >
          {allActivities.length} {allActivities.length === 1 ? "activity" : "activities"}
        </span>
        <UIButton label="Refresh" variant="secondary" onClick={fetchDiary} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        {allActivities
          .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
          .map((activity) => {
            const time = new Date(activity.timestamp).toLocaleTimeString("en-US", {
              hour: "2-digit",
              minute: "2-digit",
            });
            const project = String((activity.metadata as Record<string, unknown>)?.project ?? "");
            const sid = String((activity.metadata as Record<string, unknown>)?.sessionId ?? "").slice(0, 8);

            return (
              <div
                key={activity.id}
                style={{
                  padding: "8px 10px",
                  borderRadius: "6px",
                  background: "var(--tui-bg-secondary)",
                  fontSize: "12px",
                  lineHeight: "1.4",
                }}
              >
                <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "2px" }}>
                  <span style={{ color: "var(--tui-text-secondary)" }}>{time}</span>
                  {project && (
                    <span style={{ color: "var(--tui-primary)", fontWeight: 600 }}>{project}</span>
                  )}
                  {sid && (
                    <span
                      style={{
                        fontFamily: "monospace",
                        fontSize: "10px",
                        color: "var(--tui-text-secondary)",
                        padding: "1px 4px",
                        borderRadius: "3px",
                        border: "1px solid var(--tui-border)",
                      }}
                    >
                      {sid}
                    </span>
                  )}
                  <span
                    style={{
                      fontSize: "10px",
                      color: "var(--tui-text-secondary)",
                      textTransform: "uppercase",
                    }}
                  >
                    {activity.category}
                  </span>
                </div>
                <div style={{ color: "var(--tui-text)", fontWeight: 500 }}>
                  {activity.title}
                </div>
                {activity.description && (
                  <div
                    style={{
                      color: "var(--tui-text-secondary)",
                      marginTop: "2px",
                      whiteSpace: "pre-wrap",
                      maxHeight: "60px",
                      overflow: "hidden",
                    }}
                  >
                    {activity.description.slice(0, 200)}
                    {activity.description.length > 200 ? "…" : ""}
                  </div>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}

function getSourceColor(source: string): string {
  switch (source) {
    case "backend":
      return "#22c55e";
    case "collector":
      return "#3b82f6";
    case "session.stream":
      return "#f59e0b";
    case "session.idResolved":
      return "#8b5cf6";
    case "instrument.event":
      return "#ec4899";
    default:
      return "var(--tui-text-secondary)";
  }
}
