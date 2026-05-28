import { create } from "zustand";
import type {
  ChatSummary,
  ModelInfo,
  ProjectSummary,
  Settings,
} from "@chat/shared";
import { api } from "../lib/api";

export type View = "chat" | "projects" | "settings";

interface AppState {
  view: View;
  setView: (v: View) => void;

  settings: Settings | null;
  models: ModelInfo[];
  modelError: string | null;
  chats: ChatSummary[];
  projects: ProjectSummary[];

  selectedModelId: string | null;
  setSelectedModelId: (id: string) => void;

  loadSettings: () => Promise<void>;
  loadModels: () => Promise<void>;
  loadChats: () => Promise<void>;
  loadProjects: () => Promise<void>;
}

export const useStore = create<AppState>((set, get) => ({
  view: "chat",
  setView: (v) => set({ view: v }),

  settings: null,
  models: [],
  modelError: null,
  chats: [],
  projects: [],

  selectedModelId: null,
  setSelectedModelId: (id) => set({ selectedModelId: id }),

  loadSettings: async () => {
    const settings = await api.getSettings();
    set({ settings });
  },

  loadModels: async () => {
    try {
      const models = await api.getModels();
      set({ models, modelError: null });
      if (!get().selectedModelId && models.length > 0) {
        set({ selectedModelId: models[0].id });
      }
    } catch (err) {
      set({
        models: [],
        modelError: err instanceof Error ? err.message : String(err),
      });
    }
  },

  loadChats: async () => set({ chats: await api.listChats() }),
  loadProjects: async () => set({ projects: await api.listProjects() }),
}));
