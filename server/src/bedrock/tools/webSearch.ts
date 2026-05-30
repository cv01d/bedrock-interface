import type { Tool } from "@aws-sdk/client-bedrock-runtime";
import type { WebSearchResult } from "@chat/shared";
import { getTavilyApiKey } from "../../db/repo.js";

export const WEB_SEARCH_TOOL_NAME = "web_search";

const TAVILY_ENDPOINT = "https://api.tavily.com/search";
const REQUEST_TIMEOUT_MS = 15_000;

export const webSearchTool: Tool = {
  toolSpec: {
    name: WEB_SEARCH_TOOL_NAME,
    description:
      "Search the public web for current information. Use this when the user " +
      "asks about recent events, real-time facts, prices, documentation, or " +
      "anything that may have changed since your training cutoff, or when you " +
      "are unsure and want to verify. Returns ranked results (title, URL, and a " +
      "content excerpt) and sometimes a synthesized answer. Cite the URLs you use.",
    inputSchema: {
      json: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query. Be specific and keyword-rich.",
          },
          max_results: {
            type: "number",
            description: "How many results to return. Default 5, max 10.",
          },
          topic: {
            type: "string",
            enum: ["general", "news"],
            description:
              "Optional. Use 'news' for recent/current-events queries, otherwise 'general'.",
          },
        },
        required: ["query"],
      },
    },
  },
};

interface WebSearchInput {
  query?: string;
  max_results?: number;
  topic?: string;
}

export type WebSearchResponse =
  | { ok: true; answer: string; results: WebSearchResult[] }
  | { ok: false; error: string };

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
}

interface TavilyResponse {
  answer?: string;
  results?: TavilyResult[];
}

export async function runWebSearch(rawInput: unknown): Promise<WebSearchResponse> {
  const input = (rawInput ?? {}) as WebSearchInput;
  const query = (input.query ?? "").trim();
  if (!query) return { ok: false, error: "No search query was provided." };

  const apiKey = getTavilyApiKey();
  if (!apiKey) {
    return {
      ok: false,
      error: "No Tavily API key is configured. Add one in Settings to enable web search.",
    };
  }

  const maxResults = Math.min(Math.max(Math.round(input.max_results ?? 5), 1), 10);
  const topic = input.topic === "news" ? "news" : "general";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(TAVILY_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query,
        topic,
        max_results: maxResults,
        search_depth: "basic",
        include_answer: true,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      if (res.status === 401 || res.status === 403) {
        return { ok: false, error: "Tavily rejected the API key (check it in Settings)." };
      }
      return {
        ok: false,
        error: `Tavily search failed (HTTP ${res.status})${detail ? `: ${detail.slice(0, 200)}` : ""}.`,
      };
    }

    const data = (await res.json()) as TavilyResponse;
    const results: WebSearchResult[] = (data.results ?? [])
      .filter((r) => r.url)
      .map((r) => ({
        title: (r.title ?? r.url ?? "").trim(),
        url: r.url ?? "",
        content: (r.content ?? "").trim(),
      }));

    return { ok: true, answer: (data.answer ?? "").trim(), results };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, error: "Web search timed out." };
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}
