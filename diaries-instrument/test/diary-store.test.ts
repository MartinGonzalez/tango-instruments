import { describe, expect, test, beforeEach } from "bun:test";
import { DiaryStore } from "../src/lib/diary-store.ts";
import type { DiaryActivity, DiaryRawData, DiarySummary } from "../src/types.ts";

function createMockStorage() {
  const files = new Map<string, string>();
  return {
    files,
    readFile: async (path: string) => {
      const content = files.get(path);
      if (!content) throw new Error(`File not found: ${path}`);
      return content;
    },
    writeFile: async (path: string, content: string) => {
      files.set(path, content);
    },
    deleteFile: async (path: string) => {
      files.delete(path);
    },
    listFiles: async (dir?: string) => {
      const prefix = dir ? `${dir}/` : "";
      return Array.from(files.keys()).filter((k) => k.startsWith(prefix));
    },
  };
}

function createActivity(overrides: Partial<DiaryActivity> = {}): DiaryActivity {
  return {
    id: "act-1",
    timestamp: "2026-03-04T10:00:00.000Z",
    source: "test",
    category: "coding-sessions",
    title: "Test activity",
    description: "Did some testing",
    metadata: {},
    ...overrides,
  };
}

describe("DiaryStore", () => {
  let store: DiaryStore;
  let mockStorage: ReturnType<typeof createMockStorage>;

  beforeEach(() => {
    mockStorage = createMockStorage();
    store = new DiaryStore(mockStorage);
  });

  describe("readRaw / readSummary", () => {
    test("returns null for non-existent raw", async () => {
      const result = await store.readRaw("2026-03-04");
      expect(result).toBeNull();
    });

    test("returns null for non-existent summary", async () => {
      const result = await store.readSummary("2026-03-04");
      expect(result).toBeNull();
    });

    test("returns parsed raw data", async () => {
      const raw: DiaryRawData = {
        date: "2026-03-04",
        lastUpdated: "2026-03-04T10:00:00.000Z",
        sections: {},
      };
      mockStorage.files.set("diaries/2026-03-04_raw.json", JSON.stringify(raw));

      const result = await store.readRaw("2026-03-04");
      expect(result).toEqual(raw);
    });
  });

  describe("readDiary (combined view)", () => {
    test("returns null when neither raw nor summary exists", async () => {
      const result = await store.readDiary("2026-03-04");
      expect(result).toBeNull();
    });

    test("returns entry with raw data only", async () => {
      const raw: DiaryRawData = {
        date: "2026-03-04",
        lastUpdated: "2026-03-04T10:00:00.000Z",
        sections: {},
      };
      mockStorage.files.set("diaries/2026-03-04_raw.json", JSON.stringify(raw));

      const result = await store.readDiary("2026-03-04");
      expect(result).not.toBeNull();
      expect(result!.dailySummary).toBe("");
      expect(result!.projectTasks).toEqual({});
      expect(result!.hasNewActivity).toBe(false);
    });

    test("returns entry with summary only", async () => {
      const summary: DiarySummary = {
        date: "2026-03-04",
        generatedAt: "2026-03-04T12:00:00.000Z",
        rawHash: "abc",
        dailySummary: "## project\nDid stuff",
        projectTasks: { project: [{ name: "Task", sessionIds: ["abc"], description: "Did stuff" }] },
      };
      mockStorage.files.set("diaries/2026-03-04_summary.json", JSON.stringify(summary));

      const result = await store.readDiary("2026-03-04");
      expect(result).not.toBeNull();
      expect(result!.dailySummary).toBe("## project\nDid stuff");
      expect(result!.projectTasks).toEqual(summary.projectTasks);
    });

    test("detects new activity when raw hash differs from summary hash", async () => {
      const raw: DiaryRawData = {
        date: "2026-03-04",
        lastUpdated: "2026-03-04T10:00:00.000Z",
        sections: {
          "coding-sessions": {
            id: "coding-sessions",
            title: "Coding Sessions",
            activities: [createActivity()],
            summary: "",
          },
        },
      };
      const summary: DiarySummary = {
        date: "2026-03-04",
        generatedAt: "2026-03-04T09:00:00.000Z",
        rawHash: "stale-hash",
        dailySummary: "Old summary",
        projectTasks: {},
      };
      mockStorage.files.set("diaries/2026-03-04_raw.json", JSON.stringify(raw));
      mockStorage.files.set("diaries/2026-03-04_summary.json", JSON.stringify(summary));

      const result = await store.readDiary("2026-03-04");
      expect(result!.hasNewActivity).toBe(true);
    });
  });

  describe("listDiaryDates", () => {
    test("returns empty array when no diaries exist", async () => {
      const result = await store.listDiaryDates();
      expect(result).toEqual([]);
    });

    test("returns unique dates sorted most recent first", async () => {
      mockStorage.files.set("diaries/2026-03-02_raw.json", "{}");
      mockStorage.files.set("diaries/2026-03-04_raw.json", "{}");
      mockStorage.files.set("diaries/2026-03-04_summary.json", "{}");
      mockStorage.files.set("diaries/2026-03-03_raw.json", "{}");

      const result = await store.listDiaryDates();
      expect(result).toEqual(["2026-03-04", "2026-03-03", "2026-03-02"]);
    });
  });

  describe("addActivity", () => {
    test("creates new raw file and section when none exists", async () => {
      const activity = createActivity();

      await store.addActivity("2026-03-04", activity);

      const raw = await store.readRaw("2026-03-04");
      expect(raw).not.toBeNull();
      expect(raw!.sections["coding-sessions"]).toBeDefined();
      expect(raw!.sections["coding-sessions"].activities).toHaveLength(1);
    });

    test("appends to existing section", async () => {
      await store.addActivity("2026-03-04", createActivity({ id: "act-1" }));
      await store.addActivity("2026-03-04", createActivity({ id: "act-2", title: "Second" }));

      const raw = await store.readRaw("2026-03-04");
      expect(raw!.sections["coding-sessions"].activities).toHaveLength(2);
    });

    test("deduplicates by activity ID", async () => {
      const activity = createActivity({ id: "act-1" });

      await store.addActivity("2026-03-04", activity);
      await store.addActivity("2026-03-04", activity);

      const raw = await store.readRaw("2026-03-04");
      expect(raw!.sections["coding-sessions"].activities).toHaveLength(1);
    });

    test("does not touch summary file", async () => {
      const summary: DiarySummary = {
        date: "2026-03-04",
        generatedAt: "2026-03-04T12:00:00.000Z",
        rawHash: "abc",
        dailySummary: "My summary",
        projectTasks: {},
      };
      mockStorage.files.set("diaries/2026-03-04_summary.json", JSON.stringify(summary));

      await store.addActivity("2026-03-04", createActivity());

      const result = await store.readSummary("2026-03-04");
      expect(result!.dailySummary).toBe("My summary");
    });
  });

  describe("deleteDiary", () => {
    test("removes both raw and summary files", async () => {
      mockStorage.files.set("diaries/2026-03-04_raw.json", "{}");
      mockStorage.files.set("diaries/2026-03-04_summary.json", "{}");

      await store.deleteDiary("2026-03-04");

      expect(mockStorage.files.has("diaries/2026-03-04_raw.json")).toBe(false);
      expect(mockStorage.files.has("diaries/2026-03-04_summary.json")).toBe(false);
    });
  });
});
