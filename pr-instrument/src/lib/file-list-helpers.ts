// PR-specific file status helpers

import type { FileStatus } from "../types.ts";

export function statusSymbol(status: FileStatus): string {
  if (status === "added") return "+";
  if (status === "deleted") return "\u2212";
  if (status === "renamed") return "R";
  return "\u2219";
}

export function statusTone(status: FileStatus): "success" | "danger" | "info" | "neutral" {
  if (status === "added") return "success";
  if (status === "deleted") return "danger";
  if (status === "renamed") return "info";
  return "neutral";
}
