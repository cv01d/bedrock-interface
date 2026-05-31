import { useEffect } from "react";
import { useStore } from "./state/store";
import { ChatView } from "./views/ChatView";
import { ProjectsView } from "./views/ProjectsView";
import { SettingsView } from "./views/SettingsView";
import { FavoritesView } from "./views/FavoritesView";
import { ArchivedView } from "./views/ArchivedView";

export function App() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const loadSettings = useStore((s) => s.loadSettings);
  const loadModels = useStore((s) => s.loadModels);

  useEffect(() => {
    loadSettings();
    loadModels();
  }, [loadSettings, loadModels]);

  return (
    <div className="app">
      <nav className="rail">
        <button
          className={view === "chat" ? "active" : ""}
          title="Chats"
          onClick={() => setView("chat")}
        >
          💬
        </button>
        <button
          className={view === "projects" ? "active" : ""}
          title="Projects"
          onClick={() => setView("projects")}
        >
          📁
        </button>
        <button
          className={view === "favorites" ? "active" : ""}
          title="Favorites"
          onClick={() => setView("favorites")}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M6 2h12a1 1 0 0 1 1 1v18l-7-4-7 4V3a1 1 0 0 1 1-1z" />
          </svg>
        </button>
        <button
          className={view === "archived" ? "active" : ""}
          title="Archived chats"
          onClick={() => setView("archived")}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="4" width="18" height="4" rx="1" />
            <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" />
            <path d="M10 12h4" />
          </svg>
        </button>
        <button
          className={view === "settings" ? "active" : ""}
          title="Settings"
          onClick={() => setView("settings")}
        >
          ⚙️
        </button>
      </nav>
      {view === "chat" && <ChatView />}
      {view === "projects" && <ProjectsView />}
      {view === "favorites" && <FavoritesView />}
      {view === "archived" && <ArchivedView />}
      {view === "settings" && <SettingsView />}
    </div>
  );
}
