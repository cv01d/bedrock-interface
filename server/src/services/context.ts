import type { Project, Settings } from "@chat/shared";

// Frozen at chat creation: the project's system prompt + static project data.
// Stored as the chat's snapshot so later edits to the project don't rewrite
// the behavior of an existing chat.
export function buildSnapshot(project: Project | null): string {
  if (!project) return "";
  const parts: string[] = [];
  if (project.systemPrompt.trim()) {
    parts.push(project.systemPrompt.trim());
  }
  if (project.projectData.trim()) {
    parts.push(`# Project data\n${project.projectData.trim()}`);
  }
  return parts.join("\n\n");
}

// Assembled fresh on every request: the frozen snapshot + the *live* rolling
// summary (so project memory stays current) + a dated preamble.
export function buildSystemText(opts: {
  snapshot: string;
  liveRollingSummary: string;
  settings: Settings;
}): string {
  const parts: string[] = [];

  const nowLocal = new Date().toLocaleString("en-US", {
    timeZone: opts.settings.timezone || "UTC",
  });
  parts.push(
    `Current date/time (${opts.settings.timezone || "UTC"}): ${nowLocal}`
  );

  if (opts.snapshot.trim()) parts.push(opts.snapshot.trim());

  if (opts.liveRollingSummary.trim()) {
    parts.push(`# Project memory\n${opts.liveRollingSummary.trim()}`);
  }

  return parts.join("\n\n");
}
