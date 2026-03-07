import type {
  DiaryRawData,
  DiarySummary,
  DiaryEntry,
  DiaryActivity,
} from "../types.ts";
import { SECTION_DEFINITIONS } from "../types.ts";

type StorageAPI = {
  readFile: (path: string, encoding?: string) => Promise<string>;
  writeFile: (path: string, content: string, encoding?: string) => Promise<void>;
  deleteFile: (path: string) => Promise<void>;
  listFiles: (dir?: string) => Promise<string[]>;
};

/**
 * Simple djb2 hash — fast, deterministic, good enough for change detection.
 */
function hashString(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

export function computeRawHash(raw: DiaryRawData): string {
  return hashString(JSON.stringify(raw.sections));
}

export class DiaryStore {
  #storage: StorageAPI;
  #rawLock = new Map<string, Promise<void>>();

  constructor(storage: StorageAPI) {
    this.#storage = storage;
  }

  #withRawLock<T>(date: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.#rawLock.get(date) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.#rawLock.set(date, next.then(() => {}, () => {}));
    return next;
  }

  // --- Raw data (activities) ---

  async readRaw(date: string): Promise<DiaryRawData | null> {
    try {
      const content = await this.#storage.readFile(`diaries/${date}_raw.json`);
      return JSON.parse(content) as DiaryRawData;
    } catch {
      return null;
    }
  }

  async writeRaw(raw: DiaryRawData): Promise<void> {
    raw.lastUpdated = new Date().toISOString();
    await this.#storage.writeFile(
      `diaries/${raw.date}_raw.json`,
      JSON.stringify(raw, null, 2)
    );
  }

  // --- Summary ---

  async readSummary(date: string): Promise<DiarySummary | null> {
    try {
      const content = await this.#storage.readFile(`diaries/${date}_summary.json`);
      return JSON.parse(content) as DiarySummary;
    } catch {
      return null;
    }
  }

  async writeSummary(summary: DiarySummary): Promise<void> {
    await this.#storage.writeFile(
      `diaries/${summary.date}_summary.json`,
      JSON.stringify(summary, null, 2)
    );
  }

  // --- Combined view for frontend ---

  async readDiary(date: string): Promise<DiaryEntry | null> {
    const raw = await this.readRaw(date);
    const summary = await this.readSummary(date);

    if (!raw && !summary) return null;

    const hasNewActivity = summary
      ? computeRawHash(raw ?? createEmptyRaw(date)) !== summary.rawHash
      : false;

    return {
      date,
      lastUpdated: raw?.lastUpdated ?? summary?.generatedAt ?? "",
      sections: raw?.sections ?? {},
      dailySummary: summary?.dailySummary ?? "",
      projectTasks: summary?.projectTasks ?? {},
      hasNewActivity,
    };
  }

  // --- Mutations ---

  async addActivity(date: string, activity: DiaryActivity): Promise<void> {
    return this.#withRawLock(date, async () => {
      let raw = await this.readRaw(date);
      if (!raw) {
        raw = createEmptyRaw(date);
      }

      const sectionDef = SECTION_DEFINITIONS[activity.category];
      const sectionId = sectionDef.id;

      if (!raw.sections[sectionId]) {
        raw.sections[sectionId] = {
          id: sectionId,
          title: sectionDef.title,
          activities: [],
          summary: "",
        };
      }

      const section = raw.sections[sectionId];
      const existingIndex = section.activities.findIndex(
        (a) => a.id === activity.id
      );

      if (existingIndex === -1) {
        section.activities.push(activity);
      } else {
        section.activities[existingIndex] = activity;
      }

      await this.writeRaw(raw);
    });
  }

  async updateActivityProject(
    date: string,
    sessionId: string,
    project: string,
    cwd: string,
  ): Promise<void> {
    return this.#withRawLock(date, async () => {
      const raw = await this.readRaw(date);
      if (!raw) return;

      let changed = false;
      for (const section of Object.values(raw.sections)) {
        for (const activity of section.activities) {
          const meta = activity.metadata as Record<string, unknown>;
          if (meta?.sessionId === sessionId && meta?.project === "Unknown") {
            meta.project = project;
            meta.cwd = cwd;
            changed = true;
          }
        }
      }

      if (changed) {
        await this.writeRaw(raw);
      }
    });
  }

  async deleteDiary(date: string): Promise<void> {
    // Delete both files, ignore errors if one doesn't exist
    await Promise.allSettled([
      this.#storage.deleteFile(`diaries/${date}_raw.json`),
      this.#storage.deleteFile(`diaries/${date}_summary.json`),
    ]);
  }

  async listDiaryDates(): Promise<string[]> {
    const files = await this.#storage.listFiles("diaries");
    const dates = new Set<string>();
    for (const f of files) {
      const match = f.replace("diaries/", "").match(/^(\d{4}-\d{2}-\d{2})_(raw|summary)\.json$/);
      if (match) dates.add(match[1]);
    }
    return [...dates].sort((a, b) => b.localeCompare(a));
  }
}

function createEmptyRaw(date: string): DiaryRawData {
  return {
    date,
    lastUpdated: new Date().toISOString(),
    sections: {},
  };
}
