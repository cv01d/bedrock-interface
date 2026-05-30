import { useEffect, useState } from "react";
import type { AttachmentInfo, ContentBlock, Message } from "@chat/shared";
import { useStore } from "../state/store";
import { api, streamMessage } from "../lib/api";
import { MessageList } from "../components/MessageList";
import { Composer } from "../components/Composer";

export function ChatView() {
  const {
    chats,
    projects,
    models,
    modelError,
    selectedModelId,
    setSelectedModelId,
    loadChats,
    loadProjects,
    settings,
    setView,
  } = useStore();

  const [activeChatId, setActiveChatId] = useState<number | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<number | null>(null);
  const [newChatProjectId, setNewChatProjectId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [toolStatus, setToolStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [usage, setUsage] = useState({
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  });
  const [editingChatId, setEditingChatId] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState("");

  useEffect(() => {
    loadChats();
    loadProjects();
  }, [loadChats, loadProjects]);

  const credsMissing =
    !settings?.hasAwsAccessKeyId || !settings?.hasAwsSecretAccessKey;

  const currentProjectId = activeChatId ? activeProjectId : newChatProjectId;

  const selectChat = async (id: number) => {
    const chat = await api.getChat(id);
    setActiveChatId(chat.id);
    setActiveProjectId(chat.projectId);
    setMessages(chat.messages);
    setSelectedModelId(chat.modelId);
    setStreamingText(null);
    setToolStatus(null);
    setUsage({
      costUsd: chat.costUsd,
      inputTokens: chat.inputTokens,
      outputTokens: chat.outputTokens,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
  };

  const newChat = () => {
    setActiveChatId(null);
    setActiveProjectId(null);
    setNewChatProjectId(null);
    setMessages([]);
    setStreamingText(null);
    setToolStatus(null);
    setUsage({
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
  };

  const commitRename = async () => {
    if (editingChatId == null) return;
    const id = editingChatId;
    const title = editingTitle.trim();
    setEditingChatId(null);
    if (title) {
      await api.updateChat(id, { title });
      loadChats();
    }
  };

  const onSelectModel = async (id: string) => {
    setSelectedModelId(id);
    if (activeChatId) {
      await api.updateChat(activeChatId, { modelId: id });
      loadChats();
    }
  };

  const onSummarize = async () => {
    if (!currentProjectId) return;
    setBanner("Summarizing project memory…");
    try {
      await api.summarizeProject(currentProjectId);
      setBanner("Project memory updated. View or edit it in Projects.");
    } catch (err) {
      setBanner(err instanceof Error ? err.message : String(err));
    }
  };

  const onSend = async (text: string, attachments: AttachmentInfo[]) => {
    if (!selectedModelId) {
      setBanner("Pick a model first.");
      return;
    }
    setBusy(true);
    setBanner(null);

    let chatId = activeChatId;
    if (!chatId) {
      try {
        const chat = await api.createChat(selectedModelId, newChatProjectId);
        chatId = chat.id;
        setActiveChatId(chat.id);
        setActiveProjectId(chat.projectId);
        await loadChats();
      } catch (err) {
        setBanner(err instanceof Error ? err.message : String(err));
        setBusy(false);
        return;
      }
    }

    // Optimistic user message.
    const blocks: ContentBlock[] = [];
    for (const a of attachments) {
      blocks.push({
        type: a.kind === "image" ? "image" : "document",
        attachmentId: a.id,
        mime: a.mime,
        name: a.name,
      });
    }
    if (text.trim()) blocks.push({ type: "text", text });
    const optimistic: Message = {
      id: -Date.now(),
      chatId,
      seq: messages.length + 1,
      role: "user",
      blocks,
      modelId: null,
      stopReason: null,
      inputTokens: null,
      outputTokens: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    setStreamingText("");

    const model = models.find((m) => m.id === selectedModelId);
    streamMessage(
      chatId,
      {
        text,
        attachmentIds: attachments.map((a) => a.id),
        enableTools: model?.supportsTools ?? false,
        enableCaching: model?.supportsCaching ?? false,
      },
      (event) => {
        switch (event.type) {
          case "start":
            setStreamingText("");
            break;
          case "delta":
            setStreamingText((prev) => (prev ?? "") + event.text);
            break;
          case "tool_call_start":
            setToolStatus(
              event.name === "generate_image"
                ? "🎨 Generating image…"
                : event.name === "web_search"
                  ? "🌐 Searching the web…"
                  : "🔎 Searching chat history…"
            );
            break;
          case "tool_result":
            setToolStatus(
              event.name === "generate_image"
                ? event.resultCount > 0
                  ? "🎨 Image generated"
                  : "🎨 Image generation failed"
                : event.name === "web_search"
                  ? `🌐 Web search → ${event.resultCount} result${
                      event.resultCount === 1 ? "" : "s"
                    }`
                  : `🔎 History search → ${event.resultCount} result${
                      event.resultCount === 1 ? "" : "s"
                    }`
            );
            break;
          case "message_saved":
            setMessages((prev) => {
              const next = [...prev, event.message];
              return next;
            });
            setStreamingText(null);
            setToolStatus(null);
            break;
          case "done":
            setBusy(false);
            setStreamingText(null);
            setToolStatus(null);
            setUsage({
              costUsd: event.chatCostUsd,
              inputTokens: event.chatInputTokens,
              outputTokens: event.chatOutputTokens,
              cacheReadTokens: event.cacheReadTokens,
              cacheWriteTokens: event.cacheWriteTokens,
            });
            loadChats();
            break;
          case "error":
            setBusy(false);
            setStreamingText(null);
            setToolStatus(null);
            setBanner(event.message);
            break;
        }
      }
    );
  };

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-header">
          <strong>Chats</strong>
          <button className="primary" onClick={newChat}>
            + New
          </button>
        </div>
        <div className="sidebar-list">
          {chats.length === 0 && (
            <div className="muted" style={{ padding: 10 }}>
              No chats yet.
            </div>
          )}
          {chats.map((c) => (
            <div
              key={c.id}
              className={`list-item ${c.id === activeChatId ? "active" : ""}`}
              onClick={() => selectChat(c.id)}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                {editingChatId === c.id ? (
                  <input
                    className="rename-input"
                    autoFocus
                    value={editingTitle}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setEditingTitle(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        commitRename();
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        setEditingChatId(null);
                      }
                    }}
                  />
                ) : (
                  <div className="title">{c.title}</div>
                )}
                <div className="sub">
                  {projects.find((p) => p.id === c.projectId)?.name ?? "—"}
                </div>
              </div>
              <div className="item-actions">
                <button
                  title="Rename chat"
                  style={{ border: "none", background: "none", padding: 2 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingChatId(c.id);
                    setEditingTitle(c.title);
                  }}
                >
                  ✎
                </button>
                <button
                  className="danger"
                  title="Delete chat"
                  style={{ border: "none", background: "none", padding: 2 }}
                  onClick={async (e) => {
                    e.stopPropagation();
                    await api.deleteChat(c.id);
                    if (c.id === activeChatId) newChat();
                    loadChats();
                  }}
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      </aside>

      <section className="main">
        {credsMissing && (
          <div className="banner warn" style={{ margin: 12 }}>
            AWS credentials are not configured.{" "}
            <button onClick={() => setView("settings")}>Open Settings</button>
          </div>
        )}
        {modelError && (
          <div className="banner error" style={{ margin: 12 }}>
            Could not load models: {modelError}
          </div>
        )}
        {banner && (
          <div className="banner ok" style={{ margin: 12 }}>
            {banner}
          </div>
        )}

        <MessageList
          key={activeChatId ?? "new"}
          messages={messages}
          streamingText={streamingText}
          toolStatus={toolStatus}
          models={models}
        />

        <Composer
          models={models}
          projects={projects}
          selectedModelId={selectedModelId}
          onSelectModel={onSelectModel}
          projectId={currentProjectId}
          onSelectProject={setNewChatProjectId}
          onSend={onSend}
          onSummarize={onSummarize}
          busy={busy}
          canSummarize={currentProjectId != null}
          projectLocked={activeChatId != null}
          usage={usage}
        />
      </section>
    </div>
  );
}
