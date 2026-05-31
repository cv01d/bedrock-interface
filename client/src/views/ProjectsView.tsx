import { useEffect, useState } from "react";
import type { ChatSummary, Project } from "@chat/shared";
import { useStore } from "../state/store";
import { api } from "../lib/api";

export function ProjectsView() {
  const { projects, loadProjects, openChatAt } = useStore();
  const [active, setActive] = useState<Project | null>(null);
  const [draft, setDraft] = useState<Project | null>(null);
  const [projectChats, setProjectChats] = useState<ChatSummary[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const open = async (id: number) => {
    const [p, chats] = await Promise.all([
      api.getProject(id),
      api.listProjectChats(id),
    ]);
    setActive(p);
    setDraft(p);
    setProjectChats(chats);
    setDirty(false);
    setBanner(null);
  };

  const createNew = async () => {
    const p = await api.createProject("Untitled project");
    await loadProjects();
    setActive(p);
    setDraft(p);
    setProjectChats([]);
    setDirty(false);
  };

  const edit = (patch: Partial<Project>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d));
    setDirty(true);
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const updated = await api.updateProject(draft.id, {
        name: draft.name,
        systemPrompt: draft.systemPrompt,
        projectData: draft.projectData,
        rollingSummary: draft.rollingSummary,
      });
      setActive(updated);
      setDraft(updated);
      setDirty(false);
      await loadProjects();
      setBanner("Saved.");
    } catch (err) {
      setBanner(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const summarize = async () => {
    if (!draft) return;
    setSummarizing(true);
    setBanner("Summarizing…");
    try {
      const { project } = await api.summarizeProject(draft.id);
      setActive(project);
      setDraft((d) => (d ? { ...d, rollingSummary: project.rollingSummary } : d));
      setDirty(false);
      setBanner("Rolling summary regenerated.");
    } catch (err) {
      setBanner(err instanceof Error ? err.message : String(err));
    } finally {
      setSummarizing(false);
    }
  };

  const remove = async () => {
    if (!active) return;
    if (!confirm(`Delete project "${active.name}"? Chats are kept but detached.`))
      return;
    await api.deleteProject(active.id);
    setActive(null);
    setDraft(null);
    await loadProjects();
  };

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-header">
          <strong>Projects</strong>
          <button className="primary" onClick={createNew}>
            + New
          </button>
        </div>
        <div className="sidebar-list">
          {projects.length === 0 && (
            <div className="muted" style={{ padding: 10 }}>
              No projects yet.
            </div>
          )}
          {projects.map((p) => (
            <div
              key={p.id}
              className={`list-item ${p.id === active?.id ? "active" : ""}`}
              onClick={() => open(p.id)}
            >
              <div className="title">{p.name}</div>
            </div>
          ))}
        </div>
      </aside>

      <section className="main">
        {!draft ? (
          <div className="empty">Select or create a project.</div>
        ) : (
          <div className="panel">
            {banner && <div className="banner ok">{banner}</div>}

            <div className="field">
              <label>Project name</label>
              <input
                value={draft.name}
                onChange={(e) => edit({ name: e.target.value })}
              />
            </div>

            <div className="field">
              <label>
                System prompt — prepended to every chat in this project
              </label>
              <textarea
                rows={5}
                value={draft.systemPrompt}
                onChange={(e) => edit({ systemPrompt: e.target.value })}
              />
            </div>

            <div className="field">
              <label>
                Project data — general context included with every request
              </label>
              <textarea
                rows={6}
                value={draft.projectData}
                onChange={(e) => edit({ projectData: e.target.value })}
              />
            </div>

            <div className="field">
              <label>
                Rolling summary / memory — auto-generated, editable here
              </label>
              <textarea
                rows={10}
                value={draft.rollingSummary}
                onChange={(e) => edit({ rollingSummary: e.target.value })}
              />
            </div>

            <div className="row">
              <button className="primary" onClick={save} disabled={!dirty || saving}>
                {saving ? "Saving…" : "Save changes"}
              </button>
              <button onClick={summarize} disabled={summarizing}>
                {summarizing ? "Summarizing…" : "Regenerate summary"}
              </button>
              <div className="spacer" />
              <button className="danger" onClick={remove}>
                Delete project
              </button>
            </div>
            {dirty && (
              <p className="muted" style={{ marginTop: 10 }}>
                Unsaved changes.
              </p>
            )}

            <div className="field" style={{ marginTop: 24 }}>
              <label>Chats in this project ({projectChats.length})</label>
              {projectChats.length === 0 ? (
                <div className="muted">No chats in this project yet.</div>
              ) : (
                <div className="fav-rows">
                  {projectChats.map((c) => (
                    <div
                      key={c.id}
                      className="fav-row"
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
                      style={{ cursor: "pointer" }}
                    >
                      <span className="fav-main">
                        <span className="fav-name">{c.title}</span>
                      </span>
                      {c.archived && (
                        <span className="chat-badge">Archived</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
