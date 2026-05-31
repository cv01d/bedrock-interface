import { create } from "zustand";
import type {
  ChatSummary,
  FavoriteItem,
  ImageModelInfo,
  ModelInfo,
  ProjectSummary,
  Settings,
} from "@chat/shared";
import { api } from "../lib/api";

export type View =
  | "chat"
  | "projects"
  | "settings"
  | "favorites"
  | "archived";

// A request to open a chat (optionally scrolling to a message) from another
// view, e.g. clicking a favorite in the Favorites tab.
export interface PendingChatOpen {
  chatId: number;
  messageId: number | null;
}

interface AppState {
  view: View;
  setView: (v: View) => void;

  pendingChatOpen: PendingChatOpen | null;
  openChatAt: (chatId: number, messageId: number | null) => void;
  clearPendingChatOpen: () => void;

  settings: Settings | null;
  models: ModelInfo[];
  imageModels: ImageModelInfo[];
  modelError: string | null;
  chats: ChatSummary[];
  archivedChats: ChatSummary[];
  projects: ProjectSummary[];
  favorites: FavoriteItem[];

  selectedModelId: string | null;
  setSelectedModelId: (id: string) => void;

  loadSettings: () => Promise<void>;
  loadModels: () => Promise<void>;
  loadImageModels: () => Promise<void>;
  loadChats: () => Promise<void>;
  loadArchivedChats: () => Promise<void>;
  loadProjects: () => Promise<void>;
  loadFavorites: () => Promise<void>;
}

export const useStore = create<AppState>((set, get) => ({
  view: "chat",
  setView: (v) => set({ view: v }),

  pendingChatOpen: null,
  openChatAt: (chatId, messageId) =>
    set({ view: "chat", pendingChatOpen: { chatId, messageId } }),
  clearPendingChatOpen: () => set({ pendingChatOpen: null }),

  settings: null,
  models: [],
  imageModels: [],
  modelError: null,
  chats: [],
  archivedChats: [],
  projects: [],
  favorites: [],

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

  loadImageModels: async () => {
    try {
      set({ imageModels: await api.getImageModels() });
    } catch {
      set({ imageModels: [] });
    }
  },

  loadChats: async () => set({ chats: await api.listChats() }),
  loadArchivedChats: async () =>
    set({ archivedChats: await api.listChats(true) }),
  loadProjects: async () => set({ projects: await api.listProjects() }),
  loadFavorites: async () => set({ favorites: await api.listFavorites() }),
}));
