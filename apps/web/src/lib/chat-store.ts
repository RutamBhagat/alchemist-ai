import type { ContextSnapshotMessage } from "../../../agent-server/src/types";
import { create } from "zustand";

export type ContextSnapshot = Pick<ContextSnapshotMessage, "context_id" | "data">;
export type ContextSlot = {
  current: ContextSnapshot;
  previous: ContextSnapshot | null;
};

export type ToolCall = {
  id: string;
  tool_name: string;
  args: Record<string, unknown>;
  result?: Record<string, unknown>;
};

export type MessagePart =
  | { kind: "text"; target: string; text: string }
  | { kind: "tool_call"; tool: ToolCall };

export type Message =
  | { role: "user"; text: string }
  | { role: "agent"; parts: MessagePart[] };

type ChatState = {
  messages: Message[];
  contexts: Record<string, ContextSlot>;
  selectedContextId: string | null;
  addUserMessage: (text: string) => void;
  appendToken: (text: string, target: string) => void;
  addToolCall: (tool: ToolCall) => void;
  setToolResult: (callId: string, result: Record<string, unknown>) => void;
  setContext: (context: ContextSnapshot) => void;
  selectContext: (contextId: string) => void;
};

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  contexts: {},
  selectedContextId: null,
  addUserMessage: (text) =>
    set((state) => ({
      messages: [...state.messages, { role: "user", text }, { role: "agent", parts: [] }],
    })),
  appendToken: (text, target) =>
    set((state) => {
      const messages = [...state.messages];
      const last = messages.at(-1);
      if (!last || last.role !== "agent") {
        return state;
      }
      const parts = [...last.parts];
      const previous = parts.at(-1);
      if (previous?.kind === "text" && previous.target === target) {
        parts[parts.length - 1] = { ...previous, text: previous.text + text };
      } else {
        parts.push({ kind: "text", target, text });
      }
      messages[messages.length - 1] = { ...last, parts };
      return { messages };
    }),
  addToolCall: (tool) =>
    set((state) => {
      const messages = [...state.messages];
      const last = messages.at(-1);
      if (!last || last.role !== "agent") {
        return state;
      }
      messages[messages.length - 1] = {
        ...last,
        parts: [...last.parts, { kind: "tool_call", tool }],
      };
      return { messages };
    }),
  setToolResult: (callId, result) =>
    set((state) => ({
      messages: state.messages.map((message) =>
        message.role === "user"
          ? message
          : {
              ...message,
              parts: message.parts.map((part) =>
                part.kind === "tool_call" && part.tool.id === callId
                  ? { ...part, tool: { ...part.tool, result } }
                  : part,
              ),
            },
      ),
    })),
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
