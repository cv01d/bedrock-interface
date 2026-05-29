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

  // Date only (no time): a per-second timestamp here would change the system
  // prefix on every request and defeat Bedrock prompt caching (which matches a
  // stable prefix within a ~5-minute TTL). Day-level granularity is enough for
  // the model's temporal awareness and keeps the cached prefix stable.
  const nowLocal = new Date().toLocaleDateString("en-US", {
    timeZone: opts.settings.timezone || "UTC",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  parts.push(`Current date (${opts.settings.timezone || "UTC"}): ${nowLocal}`);

  if (opts.snapshot.trim()) parts.push(opts.snapshot.trim());

  if (opts.liveRollingSummary.trim()) {
    parts.push(`# Project memory\n${opts.liveRollingSummary.trim()}`);
  }

  return parts.join("\n\n");
}
