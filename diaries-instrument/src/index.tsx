import { defineReactInstrument } from "tango-api";
import { DiariesSidebar } from "./components/DiariesSidebar.tsx";
import { DiaryView } from "./components/DiaryView.tsx";
import { DebugPanel } from "./components/DebugPanel.tsx";
import { useState, useEffect } from "react";
import { todayDateKey } from "./lib/date-utils.ts";

// Shared state: selected diary date (module-level, panels share same bundle)
let sharedSelectedDate: string = todayDateKey();
const listeners: Set<() => void> = new Set();

export function setSelectedDate(date: string) {
  sharedSelectedDate = date;
  listeners.forEach((fn) => fn());
}

export function useSelectedDate() {
  const [date, setDate] = useState(sharedSelectedDate);
  useEffect(() => {
    const handler = () => setDate(sharedSelectedDate);
    listeners.add(handler);
    return () => {
      listeners.delete(handler);
    };
  }, []);
  return date;
}

// Shared state: dates currently being generated (survives component unmount/remount)
const generatingDates = new Set<string>();
const generatingListeners = new Set<() => void>();
const generatingStartedAt = new Map<string, number>();
const STALE_TIMEOUT_MS = 120_000; // 2 minutes

export function markGenerating(date: string) {
  generatingDates.add(date);
  generatingStartedAt.set(date, Date.now());
  generatingListeners.forEach((fn) => fn());
}

export function clearGenerating(date: string) {
  generatingDates.delete(date);
  generatingStartedAt.delete(date);
  generatingListeners.forEach((fn) => fn());
}

export function useIsGenerating(date: string): boolean {
  const [generating, setGenerating] = useState(() => generatingDates.has(date));

  useEffect(() => {
    const handler = () => setGenerating(generatingDates.has(date));
    generatingListeners.add(handler);
    handler(); // sync in case state changed between render and effect
    return () => { generatingListeners.delete(handler); };
  }, [date]);

  // Staleness safety net: auto-clear if generation takes too long
  useEffect(() => {
    if (!generating) return;
    const startedAt = generatingStartedAt.get(date);
    if (!startedAt) return;
    const elapsed = Date.now() - startedAt;
    const remaining = STALE_TIMEOUT_MS - elapsed;
    if (remaining <= 0) {
      clearGenerating(date);
      return;
    }
    const timer = setTimeout(() => clearGenerating(date), remaining);
    return () => clearTimeout(timer);
  }, [date, generating]);

  return generating;
}

export default defineReactInstrument({
  defaults: {
    visible: {
      sidebar: true,
      first: true,
      second: true,
      right: false,
    },
  },
  panels: {
    sidebar: DiariesSidebar,
    first: DiaryView,
    second: DebugPanel,
  },
});
