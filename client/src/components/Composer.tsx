import { useRef, useState } from "react";
import type { AttachmentInfo, ModelInfo, ProjectSummary } from "@chat/shared";
import { api } from "../lib/api";
import { ModelOptions } from "./ModelOptions";

export function Composer({
  models,
  projects,
  selectedModelId,
  onSelectModel,
  projectId,
  onSelectProject,
  onSend,
  onSummarize,
  busy,
  canSummarize,
  projectLocked,
  usage,
}: {
  models: ModelInfo[];
  projects: ProjectSummary[];
  selectedModelId: string | null;
  onSelectModel: (id: string) => void;
  projectId: number | null;
  onSelectProject: (id: number | null) => void;
  onSend: (text: string, attachments: AttachmentInfo[]) => void;
  onSummarize: () => void;
  busy: boolean;
  canSummarize: boolean;
  projectLocked: boolean;
  usage: { costUsd: number; inputTokens: number; outputTokens: number };
}) {
  const model = models.find((m) => m.id === selectedModelId);
  const fmtCost = (n: number) =>
    n >= 0.01 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`;
  const fmtTok = (n: number) => n.toLocaleString();
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<AttachmentInfo[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const send = () => {
    if (busy || (!text.trim() && attachments.length === 0)) return;
    onSend(text, attachments);
    setText("");
    setAttachments([]);
  };

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      const uploaded: AttachmentInfo[] = [];
      for (const file of Array.from(files)) {
        uploaded.push(await api.upload(file));
      }
      setAttachments((prev) => [...prev, ...uploaded]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="composer">
      <div className="controls">
        <select
          value={selectedModelId ?? ""}
          onChange={(e) => onSelectModel(e.target.value)}
        >
          {models.length === 0 && <option value="">No models</option>}
          <ModelOptions models={models} />
        </select>

        <select
          value={projectId ?? ""}
          disabled={projectLocked}
          title={
            projectLocked
              ? "Project is fixed for an existing chat"
              : "Attach this chat to a project"
          }
          onChange={(e) =>
            onSelectProject(e.target.value ? Number(e.target.value) : null)
          }
        >
          <option value="">No project</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        <button
          onClick={onSummarize}
          disabled={!canSummarize || busy}
          title={
            canSummarize
              ? "Summarize this project's chats into rolling memory"
              : "Attach this chat to a project to enable summarize"
          }
        >
          🧠 Summarize
        </button>

        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy || uploading}
          title="Attach an image or document"
        >
          {uploading ? "Uploading…" : "📎 Attach"}
        </button>
        <input
          ref={fileRef}
          type="file"
          hidden
          multiple
          accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,text/csv,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/html,text/plain,text/markdown"
          onChange={(e) => onFiles(e.target.files)}
        />

        <div className="spacer" />

        <span
          className="cost-ticker"
          title={
            model
              ? `Running cost & token usage for this chat.\n${model.label}: $${model.inputPer1M}/1M in, $${model.outputPer1M}/1M out${
                  model.estimatedPrice ? " (estimated)" : ""
                }`
              : "Running cost & token usage for this chat"
          }
        >
          {model?.estimatedPrice ? "~" : ""}
          {fmtCost(usage.costUsd)}
          <span className="cost-rate">
            {" "}
            · {fmtTok(usage.inputTokens)} in / {fmtTok(usage.outputTokens)} out tok
          </span>
        </span>
      </div>

      {error && <div className="banner error">{error}</div>}

      {attachments.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          {attachments.map((a) => (
            <span key={a.id} className="attachment-pill">
              {a.kind === "image" ? "🖼️" : "📄"} {a.name}
              <button
                style={{ border: "none", background: "none", padding: 0 }}
                onClick={() =>
                  setAttachments((prev) => prev.filter((x) => x.id !== a.id))
                }
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="input-row">
        <textarea
          rows={2}
          placeholder="Type a message… (Enter to send, Shift+Enter for newline)"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button className="primary" onClick={send} disabled={busy}>
          {busy ? "…" : "Send"}
        </button>
      </div>
    </div>
  );
}
