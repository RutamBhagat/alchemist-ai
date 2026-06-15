import { create } from "zustand";

type Message = { role: "user" | "agent"; text: string };

type ChatState = {
  messages: Message[];
  addUserMessage: (text: string) => void;
  appendToken: (text: string) => void;
};

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
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
}));
