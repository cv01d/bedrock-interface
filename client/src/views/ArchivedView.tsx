import { useEffect } from "react";
import { useStore } from "../state/store";
import { api } from "../lib/api";

export function ArchivedView() {
  const {
    archivedChats,
    loadArchivedChats,
    loadChats,
    projects,
    openChatAt,
  } = useStore();

  useEffect(() => {
    loadArchivedChats();
  }, [loadArchivedChats]);

  const unarchive = async (id: number) => {
    await api.setChatArchived(id, false);
    await Promise.all([loadArchivedChats(), loadChats()]);
  };

  const remove = async (id: number) => {
    await api.deleteChat(id);
    loadArchivedChats();
  };

  return (
    <div className="panel">
      <h2 className="panel-title">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="4" width="18" height="4" rx="1" />
          <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" />
          <path d="M10 12h4" />
        </svg>
        Archived chats
      </h2>
      {archivedChats.length === 0 && (
        <div className="muted">
          No archived chats. Archive a chat from the chats list to tuck it away
          here.
        </div>
      )}
      <div className="fav-rows">
        {archivedChats.map((c) => (
          <div key={c.id} className="fav-row">
            <div
              className="fav-open"
              role="button"
              tabIndex={0}
              title="Open this chat"
              onClick={() => openChatAt(c.id, null)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  openChatAt(c.id, null);
                }
              }}
            >
              <span className="fav-main">
                <span className="fav-name">{c.title}</span>
                <span className="fav-sub">
                  {projects.find((p) => p.id === c.projectId)?.name ?? "—"}
                </span>
              </span>
            </div>
            <div className="fav-row-actions">
              <button title="Unarchive chat" onClick={() => unarchive(c.id)}>
                Unarchive
              </button>
              <button
                className="danger"
                title="Delete chat"
                onClick={() => remove(c.id)}
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
