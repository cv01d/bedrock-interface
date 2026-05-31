import { useEffect, useState } from "react";
import type { FavoriteItem } from "@chat/shared";
import { useStore } from "../state/store";
import { api } from "../lib/api";

export function FavoritesView() {
  const { favorites, loadFavorites, openChatAt } = useStore();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");

  useEffect(() => {
    loadFavorites();
  }, [loadFavorites]);

  const displayName = (f: FavoriteItem) =>
    f.label?.trim() || f.snippet || "(no text)";

  const startRename = (f: FavoriteItem) => {
    setEditingId(f.messageId);
    setEditValue(f.label ?? "");
  };

  const commitRename = async () => {
    if (editingId == null) return;
    const messageId = editingId;
    setEditingId(null);
    await api.renameFavorite(messageId, editValue);
    loadFavorites();
  };

  const remove = async (messageId: number) => {
    await api.removeFavorite(messageId);
    loadFavorites();
  };

  return (
    <div className="panel">
      <h2 className="panel-title">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M6 2h12a1 1 0 0 1 1 1v18l-7-4-7 4V3a1 1 0 0 1 1-1z" />
        </svg>
        Favorites
      </h2>
      {favorites.length === 0 && (
        <div className="muted">
          No favorites yet. Bookmark a turn with the bookmark button in a chat.
        </div>
      )}
      <div className="fav-rows">
        {favorites.map((f) => (
          <div key={f.id} className="fav-row">
            <div
              className="fav-open"
              role="button"
              tabIndex={0}
              title="Open this turn in its chat"
              onClick={() => {
                if (editingId !== f.messageId) openChatAt(f.chatId, f.messageId);
              }}
              onKeyDown={(e) => {
                if (
                  editingId !== f.messageId &&
                  (e.key === "Enter" || e.key === " ")
                ) {
                  e.preventDefault();
                  openChatAt(f.chatId, f.messageId);
                }
              }}
            >
              <span className={`fav-role ${f.role}`}>
                {f.role === "assistant" ? "AI" : "You"}
              </span>
              <span className="fav-main">
                {editingId === f.messageId ? (
                  <input
                    className="rename-input"
                    autoFocus
                    value={editValue}
                    placeholder={f.snippet}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        commitRename();
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        setEditingId(null);
                      }
                    }}
                  />
                ) : (
                  <span className="fav-name">{displayName(f)}</span>
                )}
                <span className="fav-sub">{f.chatTitle}</span>
              </span>
            </div>
            <div className="fav-row-actions">
              <button
                title="Rename favorite"
                onClick={(e) => {
                  e.stopPropagation();
                  startRename(f);
                }}
              >
                ✎
              </button>
              <button
                className="danger"
                title="Remove favorite"
                onClick={(e) => {
                  e.stopPropagation();
                  remove(f.messageId);
                }}
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
