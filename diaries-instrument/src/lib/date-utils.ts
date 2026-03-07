export function todayDateKey(): string {
  const now = new Date();
  return formatLocalDate(now);
}

export function toDateKey(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  return formatLocalDate(date);
}

export function formatDateDisplay(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function formatDateRelative(dateKey: string): string {
  const today = todayDateKey();
  if (dateKey === today) return "Today";

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (dateKey === formatLocalDate(yesterday)) return "Yesterday";

  return formatDateDisplay(dateKey);
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
