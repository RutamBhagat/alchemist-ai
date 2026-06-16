import type {
  ContextSnapshotMessage,
  StreamEndMessage,
  TokenMessage,
  ToolCallMessage,
  ToolResultMessage,
} from "../../../agent-server/src/types";
import { create } from "zustand";
import type {
  AgentStream,
  ChatStreamState,
  ToolCall,
} from "./chat-stream-model";
import {
  addToolCallToStream,
  appendTokenToStream,
  emptyChatStreamState,
  endStreamById,
  setToolResultForCall,
} from "./chat-stream-model";

export type ContextSnapshot = Pick<ContextSnapshotMessage, "context_id" | "data">;
export type ContextSlot = {
  snapshots: ContextSnapshot[];
};

export type UserMessage = {
  id: string;
  role: "user";
  text: string;
};

export type ChatEntry =
  | { kind: "user"; id: string }
  | { kind: "agent_stream"; stream_id: string };

type ChatState = ChatStreamState & {
  entryOrder: ChatEntry[];
  userMessagesById: Record<string, UserMessage>;
  contexts: Record<string, ContextSlot>;
  selectedContextId: string | null;
  nextUserMessageId: number;
  addUserMessage: (text: string) => void;
  retryFromUserMessage: (entryIndex: number) => void;
  appendToken: (event: TokenMessage & { target: string }) => void;
  addToolCall: (event: ToolCallMessage) => void;
  setToolResult: (event: ToolResultMessage) => void;
  endStream: (event: StreamEndMessage) => void;
  setContext: (context: ContextSnapshot) => void;
  selectContext: (contextId: string) => void;
};

function appendStreamEntry(
  state: ChatState,
  next: ChatStreamState,
  stream_id: string,
): Pick<ChatState, "entryOrder" | "streamOrder" | "streamsById" | "toolsByCallId"> {
  if (state.streamsById[stream_id]) {
    return {
      entryOrder: state.entryOrder,
      streamOrder: next.streamOrder,
      streamsById: next.streamsById,
      toolsByCallId: next.toolsByCallId,
    };
  }

  return {
    entryOrder: [...state.entryOrder, { kind: "agent_stream", stream_id }],
    streamOrder: next.streamOrder,
    streamsById: next.streamsById,
    toolsByCallId: next.toolsByCallId,
  };
}

function retainEntriesThrough(
  state: ChatState,
  entryIndex: number,
): Pick<
  ChatState,
  | "contexts"
  | "entryOrder"
  | "selectedContextId"
  | "streamOrder"
  | "streamsById"
  | "toolsByCallId"
  | "userMessagesById"
> {
  const entryOrder = state.entryOrder.slice(0, entryIndex + 1);
  const retainedUserIds = new Set<string>();
  const retainedStreamIds = new Set<string>();

  for (const entry of entryOrder) {
    if (entry.kind === "user") {
      retainedUserIds.add(entry.id);
    } else {
      retainedStreamIds.add(entry.stream_id);
    }
  }

  const userMessagesById: Record<string, UserMessage> = {};
  for (const id of retainedUserIds) {
    const message = state.userMessagesById[id];
    if (message) {
      userMessagesById[id] = message;
    }
  }

  const streamsById: Record<string, AgentStream> = {};
  for (const stream_id of retainedStreamIds) {
    const stream = state.streamsById[stream_id];
    if (stream) {
      streamsById[stream_id] = stream;
    }
  }

  const toolsByCallId: Record<string, ToolCall> = {};
  for (const [call_id, tool] of Object.entries(state.toolsByCallId)) {
    if (retainedStreamIds.has(tool.stream_id)) {
      toolsByCallId[call_id] = tool;
    }
  }

  return {
    contexts: {},
    entryOrder,
    selectedContextId: null,
    streamOrder: state.streamOrder.filter((stream_id) =>
      retainedStreamIds.has(stream_id),
    ),
    streamsById,
    toolsByCallId,
    userMessagesById,
  };
}

export const useChatStore = create<ChatState>((set) => ({
  ...emptyChatStreamState(),
  entryOrder: [],
  userMessagesById: {},
  contexts: {},
  selectedContextId: null,
  nextUserMessageId: 0,
  addUserMessage: (text) =>
    set((state) => {
      const nextUserMessageId = state.nextUserMessageId + 1;
      const id = `user:${nextUserMessageId}`;

      return {
        entryOrder: [...state.entryOrder, { kind: "user", id }],
        nextUserMessageId,
        userMessagesById: {
          ...state.userMessagesById,
          [id]: { id, role: "user", text },
        },
      };
    }),
  retryFromUserMessage: (entryIndex) =>
    set((state) => {
      const entry = state.entryOrder[entryIndex];
      if (entry?.kind !== "user") {
        return state;
      }

      return retainEntriesThrough(state, entryIndex);
    }),
  appendToken: (event) =>
    set((state) =>
      appendStreamEntry(state, appendTokenToStream(state, event), event.stream_id),
    ),
  addToolCall: (event) =>
    set((state) =>
      appendStreamEntry(state, addToolCallToStream(state, event), event.stream_id),
    ),
  setToolResult: (event) => set((state) => setToolResultForCall(state, event)),
  endStream: (event) => set((state) => endStreamById(state, event)),
  setContext: (context) =>
    set((state) => ({
      contexts: {
        ...state.contexts,
        [context.context_id]: {
          snapshots: [
            ...(state.contexts[context.context_id]?.snapshots ?? []),
            context,
          ],
        },
      },
      selectedContextId: context.context_id,
    })),
  selectContext: (selectedContextId) => set({ selectedContextId }),
}));