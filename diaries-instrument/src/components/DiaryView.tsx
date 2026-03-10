import { useCallback, useEffect, useRef, useState } from "react";
import {
  useInstrumentApi,
  useHostEvent,
  UIRoot,
  UIScrollArea,
  UIFooter,
  UIEmptyState,
  UIButton,
  UIMarkdownRenderer,
} from "tango-api";
import type { DiaryEntry, ProjectTask } from "../types.ts";
import { useSelectedDate, useIsGenerating, markGenerating, clearGenerating } from "../index.tsx";
import { formatDateDisplay, todayDateKey } from "../lib/date-utils.ts";

function countActivities(diary: DiaryEntry): number {
  return Object.values(diary.sections).reduce(
    (sum, s) => sum + s.activities.length,
    0
  );
}

type SessionRef = { sessionId: string; cwd: string };

function buildSessionLookup(diary: DiaryEntry): Map<string, SessionRef> {
  const map = new Map<string, SessionRef>();
  for (const section of Object.values(diary.sections)) {
    for (const activity of section.activities) {
      const sessionId = String(activity.metadata?.sessionId ?? "");
      const cwd = String(activity.metadata?.cwd ?? "");
      if (!sessionId) continue;
      const shortId = sessionId.slice(0, 8);
      if (!map.has(shortId)) {
        map.set(shortId, { sessionId, cwd });
      }
    }
  }
  return map;
}

export function DiaryView() {
  const api = useInstrumentApi();
  const selectedDate = useSelectedDate();
  const [diary, setDiary] = useState<DiaryEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const regenerating = useIsGenerating(selectedDate);

  const fetchDiary = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.actions.call<
        { date: string },
        { diary: DiaryEntry | null }
      >("getDiary", { date: selectedDate });
      setDiary(result.diary);
    } catch {
      setDiary(null);
    } finally {
      setLoading(false);
    }
  }, [api, selectedDate]);

  useEffect(() => {
    fetchDiary();
  }, [fetchDiary]);

  // Silently refresh when the backend records new activity (no loading flash)
  const silentRefresh = useCallback(async () => {
    try {
      const result = await api.actions.call<
        { date: string },
        { diary: DiaryEntry | null }
      >("getDiary", { date: selectedDate });
      setDiary(result.diary);
    } catch {
      // Silently ignore — existing data stays visible
    }
  }, [api, selectedDate]);

  useHostEvent("instrument.event", useCallback((payload: { event: string; payload?: { date?: string } }) => {
    const eventDate = payload.payload?.date;
    if (!eventDate) return;

    switch (payload.event) {
      case "diary.updated":
        if (eventDate === selectedDate) void silentRefresh();
        break;
      case "diary.generated":
        clearGenerating(eventDate);
        if (eventDate === selectedDate) void silentRefresh();
        break;
      case "diary.generateError":
        clearGenerating(eventDate);
        break;
      case "diary.generating":
        markGenerating(eventDate);
        break;
    }
  }, [selectedDate, silentRefresh]));

  const handleRegenerate = useCallback(async () => {
    markGenerating(selectedDate);
    try {
      const result = await api.actions.call<{ date: string }, { success: boolean }>(
        "regenerateSummary", { date: selectedDate }
      );
      // If backend returned { success: false } synchronously (no data), clear state
      if (!result?.success) {
        clearGenerating(selectedDate);
      }
    } catch {
      // RPC timeout is expected — backend continues in background, events will update state
    }
  }, [api, selectedDate]);

  const handleDelete = useCallback(async () => {
    await api.actions.call("deleteDiary", { date: selectedDate });
    setDiary(null);
  }, [api, selectedDate]);

  const activityCount = diary ? countActivities(diary) : 0;
  const hasProjectTasks =
    diary?.projectTasks && Object.keys(diary.projectTasks).length > 0;
  const hasSummary = !!diary?.dailySummary;

  const hasData = diary && (activityCount > 0 || hasProjectTasks || hasSummary);
  const sessionLookup = hasData ? buildSessionLookup(diary) : new Map<string, SessionRef>();

  const handleFocusSession = (shortId: string) => {
    const ref = sessionLookup.get(shortId);
    if (ref) {
      api.sessions.focus({ sessionId: ref.sessionId, cwd: ref.cwd });
    }
  };

  return (
    <UIRoot fixed>
      <UIScrollArea>
        {loading ? (
          <div style={{ padding: "40px 24px", textAlign: "center" }}>
            <UIEmptyState title="Loading diary..." />
          </div>
        ) : !hasData ? (
          <div style={{ padding: "40px 24px", textAlign: "center" }}>
            <UIEmptyState
              title={`No diary for ${formatDateDisplay(selectedDate)}`}
              description={
                selectedDate === todayDateKey()
                  ? "Activities will appear here as you work. Start a coding session and hit Stop when done, or review a PR."
                  : "No activities were recorded for this day."
              }
            />
          </div>
        ) : (
          <div style={{ padding: "16px 24px" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "16px",
              }}
            >
              <div>
                <h2
                  style={{
                    margin: 0,
                    fontSize: "16px",
                    fontWeight: 600,
                    color: "var(--tui-text)",
                  }}
                >
                  {formatDateDisplay(selectedDate)}
                </h2>
                <span
                  style={{ fontSize: "11px", color: "var(--tui-text-secondary)" }}
                >
                  {activityCount} {activityCount === 1 ? "activity" : "activities"}
                  {diary.lastUpdated &&
                    ` · Updated ${new Date(diary.lastUpdated).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`}
                </span>
              </div>
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <UIButton
                  label={
                    regenerating
                      ? "Generating..."
                      : hasProjectTasks || hasSummary
                        ? "Regenerate"
                        : "Generate Summary"
                  }
                  variant={hasProjectTasks || hasSummary ? "secondary" : "primary"}
                  onClick={handleRegenerate}
                  disabled={regenerating}
                />
                <UIButton
                  label="Delete"
                  variant="danger"
                  onClick={handleDelete}
                />
              </div>
            </div>

            {hasProjectTasks && diary.hasNewActivity && (
              <div
                style={{
                  padding: "10px 14px",
                  marginBottom: "16px",
                  borderRadius: "8px",
                  border: "1px solid var(--tui-primary)",
                  background: "var(--tui-bg-secondary)",
                  fontSize: "13px",
                  color: "var(--tui-text)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span>New activity since last summary. Regenerate to include it.</span>
                <UIButton
                  label={regenerating ? "Generating..." : "Regenerate"}
                  variant="primary"
                  onClick={handleRegenerate}
                  disabled={regenerating}
                />
              </div>
            )}

            {diary.tldr?.length > 0 && (
              <UIMarkdownRenderer
                content={
                  "# TL;DR\n" +
                  diary.tldr.join("\n") +
                  "\n\n---"
                }
              />
            )}

            {hasProjectTasks ? (
              <ProjectTasksView
                projectTasks={diary.projectTasks}
                onFocusSession={handleFocusSession}
                onDeleteCard={async (project, sessionIds) => {
                  await api.actions.call("deleteTaskCard", {
                    date: selectedDate,
                    project,
                    sessionIds,
                  });
                  await fetchDiary();
                }}
                onDeleteTask={async (project, taskName) => {
                  await api.actions.call("deleteTask", {
                    date: selectedDate,
                    project,
                    taskName,
                  });
                  await fetchDiary();
                }}
              />
            ) : hasSummary ? (
              <UIMarkdownRenderer content={diary.dailySummary} />
            ) : (
              <div
                style={{
                  padding: "12px 16px",
                  borderRadius: "8px",
                  background: "var(--tui-bg-secondary)",
                  fontSize: "13px",
                  color: "var(--tui-text-secondary)",
                }}
              >
                Activities recorded. Click "Generate Summary" to create your daily
                diary with AI.
              </div>
            )}
          </div>
        )}
      </UIScrollArea>

      <UIFooter>
        <NoteInput date={selectedDate} onNoteAdded={fetchDiary} />
      </UIFooter>
    </UIRoot>
  );
}

type SessionCard = {
  sessionIds: string[];
  tasks: ProjectTask[];
};

function groupTasksBySession(tasks: ProjectTask[]): SessionCard[] {
  const cardMap = new Map<string, SessionCard>();

  for (const task of tasks) {
    // Key = sorted session IDs joined, so tasks sharing the same sessions land in one card
    const key = [...task.sessionIds].sort().join(",") || "__no-session__";

    const existing = cardMap.get(key);
    if (existing) {
      existing.tasks.push(task);
    } else {
      cardMap.set(key, {
        sessionIds: [...task.sessionIds],
        tasks: [task],
      });
    }
  }

  return [...cardMap.values()];
}

function ProjectTasksView({
  projectTasks,
  onFocusSession,
  onDeleteCard,
  onDeleteTask,
}: {
  projectTasks: Record<string, ProjectTask[]>;
  onFocusSession: (shortId: string) => void;
  onDeleteCard: (project: string, sessionIds: string[]) => void;
  onDeleteTask: (project: string, taskName: string) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      {Object.entries(projectTasks).map(([project, tasks]) => {
        const cards = groupTasksBySession(tasks);
        return (
          <div key={project}>
            <h2
              style={{
                margin: "0 0 12px 0",
                fontSize: "15px",
                fontWeight: 600,
                color: "var(--tui-text)",
              }}
            >
              {project}
            </h2>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "10px",
              }}
            >
              {cards.map((card, i) => (
                <SessionGroupCard
                  key={`${project}-${i}`}
                  card={card}
                  onFocusSession={onFocusSession}
                  onDelete={() => onDeleteCard(project, card.sessionIds)}
                  onDeleteTask={(taskName) => onDeleteTask(project, taskName)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SessionGroupCard({
  card,
  onFocusSession,
  onDelete,
  onDeleteTask,
}: {
  card: SessionCard;
  onFocusSession: (shortId: string) => void;
  onDelete: () => void;
  onDeleteTask: (taskName: string) => void;
}) {
  return (
    <div
      style={{
        border: "1px solid var(--tui-border)",
        borderRadius: "8px",
        padding: "14px 16px",
        background: "var(--tui-bg-secondary)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: card.sessionIds.length > 0 ? "12px" : "0",
        }}
      >
        {card.sessionIds.length > 0 && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "6px",
            }}
          >
            {card.sessionIds.map((sid) => (
              <button
                key={sid}
                onClick={() => onFocusSession(sid)}
                title={`Open session ${sid}`}
                style={{
                  padding: "2px 8px",
                  borderRadius: "4px",
                  border: "1px solid var(--tui-border)",
                  background: "var(--tui-bg)",
                  color: "var(--tui-primary)",
                  fontSize: "11px",
                  fontFamily: "monospace",
                  cursor: "pointer",
                }}
              >
                {sid.slice(0, 8)}
              </button>
            ))}
          </div>
        )}
        <button
          onClick={onDelete}
          title="Delete card"
          style={{
            padding: "2px 6px",
            borderRadius: "4px",
            border: "1px solid var(--tui-border)",
            background: "transparent",
            color: "var(--tui-text-secondary)",
            fontSize: "13px",
            cursor: "pointer",
            lineHeight: 1,
            flexShrink: 0,
            marginLeft: "auto",
          }}
        >
          ✕
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        {card.tasks.map((task, i) => (
          <TaskEntry
            key={i}
            task={task}
            onDelete={() => onDeleteTask(task.name)}
          />
        ))}
      </div>
    </div>
  );
}

function NoteInput({
  date,
  onNoteAdded,
}: {
  date: string;
  onNoteAdded: () => void;
}) {
  const api = useInstrumentApi();
  const [open, setOpen] = useState(false);
  const [project, setProject] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [improving, setImproving] = useState(false);
  const projectRef = useRef<HTMLInputElement>(null);

  const busy = submitting || improving;
  const canSubmit = project.trim() !== "" && description.trim() !== "" && !busy;

  const handleCancel = useCallback(() => {
    setOpen(false);
    setProject("");
    setDescription("");
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await api.actions.call("addNote", {
        date,
        project: project.trim(),
        description: description.trim(),
      });
      setProject("");
      setDescription("");
      setOpen(false);
      onNoteAdded();
    } finally {
      setSubmitting(false);
    }
  }, [api, date, project, description, canSubmit, onNoteAdded]);

  const handleImprove = useCallback(async () => {
    if (!description.trim() || busy) return;
    setImproving(true);
    try {
      const result = await api.actions.call<
        { description: string },
        { improved: string }
      >("improveNote", { description: description.trim() });
      if (result.improved) {
        setDescription(result.improved);
      }
    } finally {
      setImproving(false);
    }
  }, [api, description, busy]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        handleSubmit();
      }
      if (e.key === "Escape") {
        handleCancel();
      }
    },
    [handleSubmit, handleCancel]
  );

  const handleOpen = useCallback(() => {
    setOpen(true);
    requestAnimationFrame(() => projectRef.current?.focus());
  }, []);

  return (
    <div
      style={{
        padding: "0 8px",
      }}
    >
      {open ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "8px",
          }}
        >
          <input
            ref={projectRef}
            type="text"
            placeholder="Project name"
            value={project}
            onChange={(e) => setProject(e.target.value)}
            onKeyDown={handleKeyDown}
            style={{
              width: "100%",
              padding: "6px 10px",
              borderRadius: "6px",
              border: "1px solid var(--tui-border)",
              background: "var(--tui-bg-secondary)",
              color: "var(--tui-text)",
              fontSize: "13px",
              fontFamily: "inherit",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
          <textarea
            placeholder="Add a note..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={3}
            style={{
              width: "100%",
              padding: "6px 10px",
              borderRadius: "6px",
              border: "1px solid var(--tui-border)",
              background: "var(--tui-bg-secondary)",
              color: "var(--tui-text)",
              fontSize: "13px",
              fontFamily: "inherit",
              outline: "none",
              resize: "vertical",
              boxSizing: "border-box",
            }}
          />
          <div style={{ display: "flex", justifyContent: "center" }}>
            <div style={{ width: "70%", display: "flex", gap: "8px" }}>
              <div style={{ flex: 1 }}>
                <UIButton
                  label="Cancel"
                  variant="secondary"
                  onClick={handleCancel}
                  disabled={busy}
                  fullWidth
                />
              </div>
              <div style={{ flex: 1 }}>
                <UIButton
                  label={improving ? "Improving..." : "Improve"}
                  icon="ai"
                  variant="secondary"
                  onClick={handleImprove}
                  disabled={!description.trim() || busy}
                  fullWidth
                />
              </div>
              <div style={{ flex: 1 }}>
                <UIButton
                  label={submitting ? "Saving..." : "Save"}
                  variant="primary"
                  onClick={handleSubmit}
                  disabled={!canSubmit}
                  fullWidth
                />
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", justifyContent: "center" }}>
          <div style={{ width: "70%" }}>
            <UIButton
              label="Add Note"
              variant="secondary"
              onClick={handleOpen}
              fullWidth
            />
          </div>
        </div>
      )}
    </div>
  );
}

function TaskEntry({
  task,
  onDelete,
}: {
  task: ProjectTask;
  onDelete: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "relative",
        padding: "6px 8px",
        margin: "-6px -8px",
        borderRadius: "6px",
        background: hovered ? "var(--tui-bg)" : "transparent",
        transition: "background 0.15s ease",
      }}
    >
      {hovered && (
        <button
          onClick={onDelete}
          title={`Delete "${task.name}"`}
          style={{
            position: "absolute",
            top: "6px",
            right: "6px",
            padding: "1px 5px",
            borderRadius: "4px",
            border: "1px solid var(--tui-border)",
            background: "var(--tui-bg-secondary)",
            color: "var(--tui-text-secondary)",
            fontSize: "11px",
            cursor: "pointer",
            lineHeight: 1,
          }}
        >
          ✕
        </button>
      )}
      <h3
        style={{
          margin: "0 0 4px 0",
          fontSize: "13px",
          fontWeight: 600,
          color: "var(--tui-text)",
        }}
      >
        {task.name}
      </h3>
      <div
        style={{
          fontSize: "13px",
          lineHeight: "1.5",
          color: "var(--tui-text-secondary)",
        }}
      >
        {task.description}
      </div>
    </div>
  );
}
