// gh CLI runner — ported from desktop/src/bun/pr-provider.ts (lines 694-853)

export type GhErrorCode = "gh_missing" | "auth_failed" | "api_error";

export class GhCommandError extends Error {
  code: GhErrorCode;
  args: string[];
  stderr: string;
  exitCode: number;

  constructor(params: {
    code: GhErrorCode;
    message: string;
    args: string[];
    stderr: string;
    exitCode: number;
  }) {
    super(params.message);
    this.name = "GhCommandError";
    this.code = params.code;
    this.args = params.args;
    this.stderr = params.stderr;
    this.exitCode = params.exitCode;
  }
}

export type CommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type CommandRunner = (args: string[]) => Promise<CommandResult>;

export async function runGhCommand(args: string[]): Promise<CommandResult> {
  try {
    const proc = Bun.spawn(["gh", ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    return { stdout, stderr, exitCode };
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      throw new GhCommandError({
        code: "gh_missing",
        message: "gh executable is not available",
        args,
        stderr: error.message,
        exitCode: 127,
      });
    }
    throw error;
  }
}

export async function runGhText(run: CommandRunner, args: string[]): Promise<string> {
  const result = await run(args);
  if (result.exitCode === 0) {
    return result.stdout;
  }

  throw new GhCommandError({
    code: classifyGhFailure(result.stderr),
    message: `gh command failed (${formatArgs(args)})`,
    args,
    stderr: result.stderr,
    exitCode: result.exitCode,
  });
}

export async function runGhJson<T>(run: CommandRunner, args: string[]): Promise<T> {
  const stdout = await runGhText(run, args);
  if (!stdout.trim()) {
    return [] as unknown as T;
  }

  try {
    return JSON.parse(stdout) as T;
  } catch (error) {
    throw new GhCommandError({
      code: "api_error",
      message: `Invalid JSON returned by gh (${formatArgs(args)})`,
      args,
      stderr: error instanceof Error ? error.message : String(error),
      exitCode: 0,
    });
  }
}

export async function runGhPagedJson<T>(run: CommandRunner, args: string[]): Promise<T[]> {
  const pages = await runGhJson<unknown>(run, [...args, "--paginate", "--slurp"]);
  if (!Array.isArray(pages)) return [];

  const out: T[] = [];
  for (const page of pages) {
    if (Array.isArray(page)) {
      out.push(...(page as T[]));
      continue;
    }
    if (page != null) {
      out.push(page as T);
    }
  }

  return out;
}

export function classifyGhFailure(stderr: string): GhErrorCode {
  const normalized = String(stderr ?? "").toLowerCase();

  if (
    normalized.includes("not logged in")
    || normalized.includes("gh auth login")
    || normalized.includes("authentication failed")
    || normalized.includes("requires authentication")
    || normalized.includes("http 401")
    || normalized.includes("bad credentials")
  ) {
    return "auth_failed";
  }

  if (
    normalized.includes("command not found")
    || normalized.includes("no such file or directory")
    || normalized.includes("executable file not found")
  ) {
    return "gh_missing";
  }

  return "api_error";
}

export function toGhCommandError(error: unknown, args: string[]): GhCommandError {
  if (error instanceof GhCommandError) return error;
  return new GhCommandError({
    code: "api_error",
    message: `gh command failed (${formatArgs(args)})`,
    args,
    stderr: error instanceof Error ? error.message : String(error),
    exitCode: 1,
  });
}

function formatArgs(args: string[]): string {
  return ["gh", ...args].join(" ");
}

export function shortError(error: GhCommandError): string {
  const stderr = String(error.stderr ?? "").trim();
  if (!stderr) return error.code;
  const firstLine = stderr.split(/\r?\n/).find((line) => line.trim().length > 0);
  if (!firstLine) return error.code;
  return firstLine;
}
