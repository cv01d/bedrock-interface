import { useEffect, useRef } from "react";
import type { ContentBlock, Message } from "@chat/shared";

function Blocks({ blocks }: { blocks: ContentBlock[] }) {
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.type) {
          case "text":
            return <div key={i} className="bubble">{b.text}</div>;
          case "image":
          case "document":
            return (
              <span key={i} className="attachment-pill">
                {b.type === "image" ? "🖼️" : "📄"} {b.name}
              </span>
            );
          case "toolUse":
            return (
              <div key={i} className="tool-chip">
                🔎 Searching chat history…
              </div>
            );
          case "toolResult":
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

export function MessageList({
  messages,
  streamingText,
  toolStatus,
}: {
  messages: Message[];
  streamingText: string | null;
  toolStatus: string | null;
}) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText, toolStatus]);

  // Hide assistant turns that are only tool-use (no visible text) when we also
  // render a tool chip — but keep them so replay shows the search happened.
  const visible = messages.filter(
    (m) =>
      m.blocks.length > 0 &&
      !(
        m.role === "user" &&
        m.blocks.every((b) => b.type === "toolResult")
      )
  );

  return (
    <div className="messages">
      {visible.length === 0 && !streamingText && (
        <div className="empty">Send a message to start the conversation.</div>
      )}
      {visible.map((m) => (
        <div key={m.id} className={`msg ${m.role}`}>
          <div className="role">{m.role}</div>
          <Blocks blocks={m.blocks} />
        </div>
      ))}
      {toolStatus && (
        <div className="msg assistant">
          <div className="tool-chip">{toolStatus}</div>
        </div>
      )}
      {streamingText !== null && (
        <div className="msg assistant">
          <div className="role">assistant</div>
          <div className="bubble">
            {streamingText === "" ? (
              <span className="typing-dots">
                <span /><span /><span />
              </span>
            ) : (
              <>
                {streamingText}
                <span className="muted">▌</span>
              </>
            )}
          </div>
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}
