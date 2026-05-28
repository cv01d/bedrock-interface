import type {
  AttachmentInfo,
  Chat,
  ChatSummary,
  ModelInfo,
  Project,
  ProjectSummary,
  SendMessageBody,
  Settings,
  SettingsUpdate,
  SSEEvent,
} from "@chat/shared";

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.error ?? detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  // Settings
  getSettings: () => jsonFetch<Settings>("/api/settings"),
  updateSettings: (patch: SettingsUpdate) =>
    jsonFetch<{ settings: Settings; validation: { ok: boolean; modelCount?: number; error?: string } }>(
      "/api/settings",
      { method: "PUT", body: JSON.stringify(patch) }
    ),

  // Models
  getModels: () => jsonFetch<ModelInfo[]>("/api/models"),

  // Projects
  listProjects: () => jsonFetch<ProjectSummary[]>("/api/projects"),
  createProject: (name: string) =>
    jsonFetch<Project>("/api/projects", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  getProject: (id: number) => jsonFetch<Project>(`/api/projects/${id}`),
  updateProject: (id: number, patch: Partial<Project>) =>
    jsonFetch<Project>(`/api/projects/${id}`, {
      method: "PUT",
      body: JSON.stringify(patch),
    }),
  deleteProject: (id: number) =>
    jsonFetch<void>(`/api/projects/${id}`, { method: "DELETE" }),
  summarizeProject: (id: number) =>
    jsonFetch<{ rollingSummary: string; project: Project }>(
      `/api/projects/${id}/summarize`,
      { method: "POST" }
    ),

  // Chats
  listChats: () => jsonFetch<ChatSummary[]>("/api/chats"),
  createChat: (modelId: string, projectId: number | null) =>
    jsonFetch<ChatSummary>("/api/chats", {
      method: "POST",
      body: JSON.stringify({ modelId, projectId }),
    }),
  getChat: (id: number) => jsonFetch<Chat>(`/api/chats/${id}`),
  updateChat: (id: number, patch: { title?: string; modelId?: string }) =>
    jsonFetch<ChatSummary>(`/api/chats/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  deleteChat: (id: number) =>
    jsonFetch<void>(`/api/chats/${id}`, { method: "DELETE" }),

  // Upload (multipart, not JSON)
  upload: async (file: File): Promise<AttachmentInfo> => {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? res.statusText);
    }
    return (await res.json()) as AttachmentInfo;
  },
};

// Streams a chat message response, invoking onEvent for each SSE event.
// Returns an abort function.
export function streamMessage(
  chatId: number,
  body: SendMessageBody,
  onEvent: (event: SSEEvent) => void
): () => void {
  const controller = new AbortController();

  (async () => {
    try {
      const res = await fetch(`/api/chats/${chatId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const detail = await res.text().catch(() => res.statusText);
        onEvent({ type: "error", message: detail || "Request failed" });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let idx: number;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const raw = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const line = raw.startsWith("data:") ? raw.slice(5).trim() : raw.trim();
          if (!line) continue;
          try {
            const event = JSON.parse(line) as SSEEvent;
            onEvent(event);
            // Yield after each event so React renders before the next event processes.
            // This is critical because when all SSE events arrive in one TCP chunk
            // (common on localhost), without this yield, React batches all updates and
            // processes message_saved/done (which set streamingText=null) before
            // rendering any intermediate deltas.
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
          } catch (e) {
            console.error("[SSE Parse Error]", e, line);
            /* ignore malformed frame */
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        console.error("[SSE Stream Error]", err);
        onEvent({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  })();

  return () => controller.abort();
}
