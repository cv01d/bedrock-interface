import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import type { ContentBlock, Message, ModelInfo } from "@chat/shared";

// react-markdown does not render raw HTML by default (no rehype-raw), so model
// output cannot inject scripts — safe to render without extra sanitization.
// remark-breaks turns single newlines into <br> so line-based formatting
// (poems, addresses, lyrics) is preserved instead of collapsed into one line.
function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>
      {text}
    </ReactMarkdown>
  );
}

// Bare hostname for a compact source label; falls back to the raw URL.
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function Blocks({
  blocks,
  markdown,
}: {
  blocks: ContentBlock[];
  markdown?: boolean;
}) {
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.type) {
          case "text":
            return (
              <div key={i} className="bubble">
                {markdown ? <Markdown text={b.text} /> : b.text}
              </div>
            );
          case "image":
            return (
              <img
                key={i}
                className="msg-image"
                src={`/api/attachments/${b.attachmentId}`}
                alt={b.name}
                title={b.name}
              />
            );
          case "document":
            return (
              <span key={i} className="attachment-pill">
                📄 {b.name}
              </span>
            );
          case "toolUse":
            return (
              <div key={i} className="tool-chip">
                {b.name === "generate_image"
                  ? "🎨 Generating image…"
                  : b.name === "web_search"
                    ? "🌐 Searching the web…"
                    : "🔎 Searching chat history…"}
              </div>
            );
          case "toolResult":
            if (b.images && b.images.length > 0) {
              return (
                <div key={i} className="generated-images">
                  {b.images.map((img) => (
                    <img
                      key={img.attachmentId}
                      className="msg-image generated"
                      src={`/api/attachments/${img.attachmentId}`}
                      alt={img.name}
                      title={img.name}
                    />
                  ))}
                </div>
              );
            }
            if (b.webResults) {
              return (
                <div key={i} className="web-sources">
                  <div className="web-sources-head">
                    🌐 Web results ({b.webResults.length})
                  </div>
                  {b.webResults.map((r, j) => (
                    <a
                      key={j}
                      className="web-source"
                      href={r.url}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      <span className="web-source-title">{r.title || r.url}</span>
                      <span className="web-source-url">{hostOf(r.url)}</span>
                    </a>
                  ))}
                </div>
              );
            }
            if (b.status === "error") {
              return (
                <div key={i} className="tool-chip">
                  ⚠️ {b.summary ?? "Tool failed"}
                </div>
              );
            }
            return (
              <div key={i} className="tool-chip">
                🔎 History search → {b.content.length} result
                {b.content.length === 1 ? "" : "s"}
              </div>
            );
          default:
            return null;
        }
      })}
    </>
  );
}

function ModelAvatar() {
  return (
    <span className="avatar" aria-hidden="true">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2l2.6 6.8L21 11.5l-6.4 2.7L12 22l-2.6-7.8L3 11.5l6.4-2.7z" />
      </svg>
    </span>
  );
}

export function MessageList({
  messages,
  streamingText,
  toolStatus,
  models,
}: {
  messages: Message[];
  streamingText: string | null;
  toolStatus: string | null;
  models: ModelInfo[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Only auto-scroll when the user is already parked at the bottom; if they've
  // scrolled up to read, leave their position alone (streaming deltas would
  // otherwise yank them back down on every frame).
  const stickToBottom = useRef(true);

  const onScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottom.current = distanceFromBottom < 80;
  };

  useEffect(() => {
    if (!stickToBottom.current) return;
    const el = containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streamingText, toolStatus]);

  const labelFor = (modelId: string | null) =>
    models.find((m) => m.id === modelId)?.label ?? "the model";

  // A tool-result message that carries content worth displaying (generated
  // images or web sources). These arrive role "user" by the Bedrock protocol
  // but are really model output we want to show.
  const hasDisplayableResult = (m: Message) =>
    m.blocks.some(
      (b) =>
        b.type === "toolResult" &&
        ((b.images && b.images.length > 0) ||
          (b.webResults && b.webResults.length > 0))
    );
  const isToolResultOnly = (m: Message) =>
    m.role === "user" && m.blocks.every((b) => b.type === "toolResult");

  // Hide pure tool-result turns (e.g. the history-search round-trip) unless they
  // carry images or web sources to show. Other turns render normally.
  const visible = messages.filter((m) => {
    if (m.blocks.length === 0) return false;
    if (isToolResultOnly(m)) return hasDisplayableResult(m);
    return true;
  });

  return (
    <div className="messages" ref={containerRef} onScroll={onScroll}>
      {visible.length === 0 && !streamingText && (
        <div className="empty">Send a message to start the conversation.</div>
      )}
      {visible.map((m) => {
        // Generated images arrive on a "user" tool-result message; show them in
        // the assistant column (without the model-attribution footer).
        const asAssistant = m.role === "assistant" || isToolResultOnly(m);
        return asAssistant ? (
          <div key={m.id} className="msg assistant">
            <div className="assistant-row">
              <ModelAvatar />
              <div className="assistant-col">
                <Blocks blocks={m.blocks} markdown />
                {m.role === "assistant" && (
                  <div className="msg-foot">
                    Response generated by {labelFor(m.modelId)}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div key={m.id} className="msg user">
            <Blocks blocks={m.blocks} />
          </div>
        );
      })}
      {toolStatus && (
        <div className="msg assistant">
          <div className="tool-chip">{toolStatus}</div>
        </div>
      )}
      {streamingText !== null && (
        <div className="msg assistant">
          <div className="assistant-row">
            <ModelAvatar />
            <div className="assistant-col">
              <div className="bubble">
                {streamingText === "" ? (
                  <span className="typing-dots">
                    <span /><span /><span />
                  </span>
                ) : (
                  <>
                    <Markdown text={streamingText} />
                    <span className="muted">▌</span>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
