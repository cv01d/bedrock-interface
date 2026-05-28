import type { Tool } from "@aws-sdk/client-bedrock-runtime";
import type { SearchHistoryResult } from "@chat/shared";
import { searchMessages } from "../../db/repo.js";

export const SEARCH_TOOL_NAME = "search_chat_history";

const SCAN_CAP = 5000;
const SNIPPET_RADIUS = 160;

export const searchHistoryTool: Tool = {
  toolSpec: {
    name: SEARCH_TOOL_NAME,
    description:
      "Search the user's past chat messages across their chat history. " +
      "Use this when the user references an earlier conversation, asks what was " +
      "discussed before, or when you need facts that may have been established in " +
      "prior chats. Returns matching message excerpts with the chat title and date.",
    inputSchema: {
      json: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Search terms. Space-separated words are matched case-insensitively; a message matches if it contains any term.",
          },
          project_id: {
            type: "number",
            description:
              "Optional. Restrict the search to chats in this project id.",
          },
          since_days: {
            type: "number",
            description: "How many days back to search. Default 90.",
          },
          limit: {
            type: "number",
            description: "Max results to return. Default 20, max 50.",
          },
        },
        required: ["query"],
      },
    },
  },
};

interface SearchInput {
  query?: string;
  project_id?: number;
  since_days?: number;
  limit?: number;
}

function makeSnippet(text: string, terms: string[]): string {
  const lower = text.toLowerCase();
  let idx = -1;
  for (const t of terms) {
    const i = lower.indexOf(t);
    if (i !== -1 && (idx === -1 || i < idx)) idx = i;
  }
  if (idx === -1) return text.slice(0, SNIPPET_RADIUS * 2);
  const start = Math.max(0, idx - SNIPPET_RADIUS);
  const end = Math.min(text.length, idx + SNIPPET_RADIUS);
  return (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
}

export function runSearchHistory(rawInput: unknown): SearchHistoryResult[] {
  const input = (rawInput ?? {}) as SearchInput;
  const query = (input.query ?? "").trim();
  if (!query) return [];

  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
  const sinceDays = input.since_days ?? 90;

  const rows = searchMessages({
    projectId: input.project_id,
    sinceDays,
    scanLimit: SCAN_CAP,
  });

  const matches = rows
    .filter((r) => {
      const lower = r.text.toLowerCase();
      return terms.some((t) => lower.includes(t));
    })
    // rows already arrive newest-first from the query
    .slice(0, limit);

  return matches.map((r) => ({
    chatId: r.chatId,
    chatTitle: r.chatTitle,
    role: r.role,
    snippet: makeSnippet(r.text, terms),
    createdAt: r.createdAt,
  }));
}
