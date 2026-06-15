import type { ContextSnapshotMessage } from "../../../agent-server/src/types";
import { create } from "zustand";

export type ContextSnapshot = Pick<ContextSnapshotMessage, "context_id" | "data">;
export type ContextSlot = {
  current: ContextSnapshot;
  previous: ContextSnapshot | null;
};

type Message = { role: "user" | "agent"; text: string };

type ChatState = {
  messages: Message[];
  contexts: Record<string, ContextSlot>;
  selectedContextId: string | null;
  addUserMessage: (text: string) => void;
  appendToken: (text: string) => void;
  setContext: (context: ContextSnapshot) => void;
  selectContext: (contextId: string) => void;
};

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  contexts: {},
  selectedContextId: null,
  addUserMessage: (text) =>
    set((state) => ({
      messages: [...state.messages, { role: "user", text }, { role: "agent", text: "" }],
    })),
  appendToken: (text) =>
    set((state) => {
      const messages = [...state.messages];
      const last = messages.at(-1);
      if (!last || last.role !== "agent") return state;
      messages[messages.length - 1] = { ...last, text: last.text + text };
      return { messages };
    }),
  setContext: (context) =>
    set((state) => ({
      contexts: {
        ...state.contexts,
        [context.context_id]: {
          current: context,
          previous: state.contexts[context.context_id]?.current ?? null,
        },
      },
      selectedContextId: context.context_id,
    })),
  selectContext: (selectedContextId) => set({ selectedContextId }),
}));
