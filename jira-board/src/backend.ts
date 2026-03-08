import {
  defineBackend,
  type InstrumentBackendContext,
} from "tango-api/backend";

async function runAcli(args: string[]): Promise<string> {
  const proc = Bun.spawn(["acli", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`acli failed (exit ${exitCode}): ${stderr || stdout}`);
  }
  return stdout;
}

async function runAcliJson<T>(args: string[]): Promise<T> {
  const raw = await runAcli([...args, "--json"]);
  return JSON.parse(raw) as T;
}

interface Sprint {
  id: number;
  name: string;
  state: string;
  goal?: string;
  startDate?: string;
  endDate?: string;
}

interface SprintListResponse {
  sprints: Sprint[];
}

interface WorkItem {
  key: string;
  fields: Record<string, unknown>;
}

interface SprintWorkitemsResponse {
  issues: WorkItem[];
  total: number;
}

const BOARDS: Record<string, number> = {
  "core-client-30": 225,
  "core-client": 662,
};

async function fetchBoardTickets(boardId: number): Promise<WorkItem[]> {
  const sprintData = await runAcliJson<SprintListResponse>([
    "jira", "board", "list-sprints",
    "--id", String(boardId),
    "--state", "active",
  ]);
  const sprint = sprintData.sprints?.[0];
  if (!sprint) return [];

  const data = await runAcliJson<SprintWorkitemsResponse>([
    "jira", "sprint", "list-workitems",
    "--board", String(boardId),
    "--sprint", String(sprint.id),
    "--fields", "key,issuetype,summary,assignee,priority,status",
  ]);
  return data.issues ?? [];
}

async function fetchAssignedToMe(): Promise<WorkItem[]> {
  const data = await runAcliJson<WorkItem[]>([
    "jira", "workitem", "search",
    "--jql", "assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC",
    "--fields", "key,issuetype,summary,assignee,priority,status",
    "--limit", "50",
  ]);
  return Array.isArray(data) ? data : [];
}

export default defineBackend({
  kind: "tango.instrument.backend.v2",

  onStart: async (ctx: InstrumentBackendContext) => {
    ctx.logger.info("Jira Board backend started");
  },

  onStop: async () => {},

  actions: {
    selectSource: {
      input: {
        type: "object",
        properties: {
          sourceId: { type: "string" },
        },
        required: ["sourceId"],
      },
      output: {
        type: "object",
        properties: {
          issues: { type: "array" },
          sourceId: { type: "string" },
        },
      },
      handler: async (ctx: InstrumentBackendContext, input?: { sourceId: string }) => {
        const sourceId = input!.sourceId;
        ctx.logger.info(`Selecting source: ${sourceId}`);

        let issues: WorkItem[] = [];
        try {
          if (sourceId === "assigned-to-me") {
            issues = await fetchAssignedToMe();
          } else {
            const boardId = BOARDS[sourceId];
            if (boardId) {
              issues = await fetchBoardTickets(boardId);
            }
          }
        } catch (err: unknown) {
          ctx.logger.error(`Failed to fetch tickets for ${sourceId}: ${err}`);
        }

        ctx.emit({ event: "tickets.loaded", payload: { sourceId, issues } });
        return { issues, sourceId };
      },
    },

    selectTicket: {
      input: {
        type: "object",
        properties: {
          key: { type: "string" },
        },
        required: ["key"],
      },
      output: {
        type: "object",
        properties: {
          issue: { type: "object" },
        },
      },
      handler: async (ctx: InstrumentBackendContext, input?: { key: string }) => {
        const key = input!.key;
        ctx.logger.info(`Loading ticket: ${key}`);

        const issue = await runAcliJson<WorkItem>([
          "jira", "workitem", "view",
          key,
          "--fields", "*all",
        ]);

        ctx.emit({ event: "ticket.loaded", payload: { issue } });
        return { issue };
      },
    },
  },
});
