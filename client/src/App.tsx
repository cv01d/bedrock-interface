import { useEffect } from "react";
import { useStore } from "./state/store";
import { ChatView } from "./views/ChatView";
import { ProjectsView } from "./views/ProjectsView";
import { SettingsView } from "./views/SettingsView";

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
          className={view === "settings" ? "active" : ""}
          title="Settings"
          onClick={() => setView("settings")}
        >
          ⚙️
        </button>
      </nav>
      {view === "chat" && <ChatView />}
      {view === "projects" && <ProjectsView />}
      {view === "settings" && <SettingsView />}
    </div>
  );
}
