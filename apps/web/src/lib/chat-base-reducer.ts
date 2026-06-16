import type { ContextSnapshot, ContextSlot, Message, StreamSlice, ToolCall } from "./chat-model";

type BaseState = StreamSlice & {
  contexts: Record<string, ContextSlot>;
  selectedContextId: string | null;
  toolsByCallId: Record<string, ToolCall>;
};

const emptyAgent = (): Message => ({ role: "agent", status: "streaming", parts: [] });

export function addUserMessageState(state: BaseState, text: string) {
  return { messages: [...state.messages, { role: "user" as const, text }, emptyAgent()] };
}

export function retryFromUserMessageState(state: BaseState, messageIndex: number) {
  const message = state.messages[messageIndex];
  if (message?.role !== "user") return state;
  return {
    contexts: {},
    selectedContextId: null,
    streamOrder: [],
    streamsById: {},
    toolsByCallId: {},
    messages: [...state.messages.slice(0, messageIndex + 1), emptyAgent()],
  };
}

export function setContextState(state: BaseState, context: ContextSnapshot) {
  return {
    contexts: {
      ...state.contexts,
      [context.context_id]: {
        snapshots: [...(state.contexts[context.context_id]?.snapshots ?? []), context],
      },
    },
    selectedContextId: context.context_id,
  };
}
