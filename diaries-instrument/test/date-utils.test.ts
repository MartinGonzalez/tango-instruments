import { describe, expect, test } from "bun:test";
import {
  todayDateKey,
  toDateKey,
  formatDateDisplay,
  formatDateRelative,
} from "../src/lib/date-utils.ts";

describe("todayDateKey", () => {
  test("returns date in YYYY-MM-DD format", () => {
    const result = todayDateKey();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("matches current local date", () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    expect(todayDateKey()).toBe(`${year}-${month}-${day}`);
  });
});

describe("toDateKey", () => {
  test("extracts date from ISO timestamp", () => {
    expect(toDateKey("2026-03-04T15:30:00.000Z")).toBe("2026-03-04");
  });

  test("handles date-only string", () => {
    expect(toDateKey("2026-03-04")).toBe("2026-03-04");
  });

  test("handles timestamps with timezone offset", () => {
    const result = toDateKey("2026-03-04T23:00:00-03:00");
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("formatDateDisplay", () => {
  test("formats date as Month Day, Year", () => {
    expect(formatDateDisplay("2026-03-04")).toBe("March 4, 2026");
  });

  test("formats January correctly", () => {
    expect(formatDateDisplay("2026-01-15")).toBe("January 15, 2026");
  });

  test("formats December correctly", () => {
    expect(formatDateDisplay("2025-12-31")).toBe("December 31, 2025");
  });
});

describe("formatDateRelative", () => {
  test("returns Today for current date", () => {
    const today = todayDateKey();
    expect(formatDateRelative(today)).toBe("Today");
  });

  test("returns Yesterday for previous date", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const key = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;
    expect(formatDateRelative(key)).toBe("Yesterday");
  });

  test("returns full date for older dates", () => {
    expect(formatDateRelative("2020-01-01")).toBe("January 1, 2020");
  });
});
