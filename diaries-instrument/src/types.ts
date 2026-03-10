export type DiaryActivity = {
  id: string;
  timestamp: string;
  source: string;
  category: ActivityCategory;
  title: string;
  description: string;
  metadata: Record<string, unknown>;
};

export type ActivityCategory =
  | "coding-sessions"
  | "pull-requests"
  | "reviews"
  | "general";

export type DiarySection = {
  id: string;
  title: string;
  activities: DiaryActivity[];
  summary: string;
};

export type ProjectTask = {
  name: string;
  sessionIds: string[];
  description: string;
  manual?: boolean;
};

/** Raw activity data — written only by the activity collector */
export type DiaryRawData = {
  date: string;
  lastUpdated: string;
  sections: Record<string, DiarySection>;
};

/** AI-generated summary — written only by regenerateSummary / deleteTaskCard */
export type DiarySummary = {
  date: string;
  generatedAt: string;
  rawHash: string;
  dailySummary: string;
  tldr: string[];
  projectTasks: Record<string, ProjectTask[]>;
};

/** Combined view sent to the frontend */
export type DiaryEntry = {
  date: string;
  lastUpdated: string;
  sections: Record<string, DiarySection>;
  dailySummary: string;
  tldr: string[];
  projectTasks: Record<string, ProjectTask[]>;
  hasNewActivity: boolean;
};

export const SECTION_DEFINITIONS: Record<
  ActivityCategory,
  { id: string; title: string }
> = {
  "coding-sessions": { id: "coding-sessions", title: "Coding Sessions" },
  "pull-requests": { id: "pull-requests", title: "Pull Requests" },
  reviews: { id: "reviews", title: "Reviews" },
  general: { id: "general", title: "General" },
};

export type DiaryDateInfo = {
  date: string;
  displayDate: string;
  activityCount: number;
  hasSummary: boolean;
};
