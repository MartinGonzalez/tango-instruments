import { useCallback, useEffect, useState } from "react";
import {
  useInstrumentApi,
  useHostEvent,
  UIRoot,
  UIList,
  UIListItem,
  UIEmptyState,
  UIBadge,
  UIButton,
} from "tango-api";
import type { DiaryDateInfo } from "../types.ts";
import { todayDateKey, formatDateRelative } from "../lib/date-utils.ts";
import { setSelectedDate, useSelectedDate } from "../index.tsx";

export function DiariesSidebar() {
  const api = useInstrumentApi();
  const selectedDate = useSelectedDate();
  const [loading, setLoading] = useState(true);
  const [dates, setDates] = useState<DiaryDateInfo[]>([]);

  const fetchDates = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.actions.call<
        Record<string, never>,
        { dates: DiaryDateInfo[] }
      >("listDiaryDates", {});
      setDates(result.dates);
    } catch {
      setDates([]);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    fetchDates();
  }, [fetchDates]);

  // Silently refresh when the backend records new activity
  const silentRefreshDates = useCallback(async () => {
    try {
      const result = await api.actions.call<
        Record<string, never>,
        { dates: DiaryDateInfo[] }
      >("listDiaryDates", {});
      setDates(result.dates);
    } catch {
      // Silently ignore — existing data stays visible
    }
  }, [api]);

  useHostEvent("instrument.event", useCallback((payload: { event: string }) => {
    if (payload.event === "diary.updated") {
      void silentRefreshDates();
    }
  }, [silentRefreshDates]));

  const today = todayDateKey();
  const hasTodayEntry = dates.some((d) => d.date === today);

  if (loading && dates.length === 0) {
    return (
      <UIRoot>
        <UIEmptyState title="Loading diaries..." />
      </UIRoot>
    );
  }

  return (
    <UIRoot>
      <div
        style={{
          padding: "12px 12px 4px",
          color: "#606672",
          fontSize: "11px",
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.5px",
        }}
      >
        Entries
      </div>

      {!hasTodayEntry && (
        <UIList>
          <UIListItem
            title="Today"
            subtitle="No entries yet"
            active={selectedDate === today}
            onClick={() => setSelectedDate(today)}
          />
        </UIList>
      )}

      {dates.length === 0 && hasTodayEntry === false ? null : (
        <UIList>
          {dates.map((entry) => (
            <UIListItem
              key={entry.date}
              title={formatDateRelative(entry.date)}
              subtitle={
                entry.activityCount > 0
                  ? `${entry.activityCount} ${entry.activityCount === 1 ? "activity" : "activities"}`
                  : "No activities"
              }
              active={selectedDate === entry.date}
              onClick={() => setSelectedDate(entry.date)}
              right={
                entry.date === today ? (
                  <UIBadge label="Today" variant="info" />
                ) : undefined
              }
            />
          ))}
        </UIList>
      )}

      <div
        style={{
          position: "sticky",
          bottom: 0,
          padding: "12px 20px",
          borderTop: "1px solid var(--tui-border)",
          background: "var(--tui-bg)",
        }}
      >
        <UIButton
          label="Refresh"
          variant="primary"
          onClick={() => fetchDates()}
          fullWidth
        />
      </div>
    </UIRoot>
  );
}
