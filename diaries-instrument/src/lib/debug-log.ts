export type DebugEntry = {
  timestamp: string;
  source: string;
  event: string;
  detail: string;
};

const MAX_ENTRIES = 200;
const entries: DebugEntry[] = [];

export function debugLog(source: string, event: string, detail: string): void {
  entries.push({
    timestamp: new Date().toISOString(),
    source,
    event,
    detail: detail.slice(0, 2000),
  });
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES);
  }
}

export function getDebugEntries(): DebugEntry[] {
  return [...entries];
}

export function clearDebugEntries(): void {
  entries.length = 0;
}
