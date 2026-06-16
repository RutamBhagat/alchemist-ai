import type { AgentStream, Message, StreamSlice } from "./chat-model";

export function emptyStream(stream_id: string): AgentStream {
  return { stream_id, status: "streaming", parts: [] };
}

export function syncMessage(
  messages: Message[],
  stream_id: string,
  stream: AgentStream,
): Message[] {
  return messages.map((message) =>
    message.role === "agent" && message.stream_id === stream_id
      ? { ...stream, role: "agent" }
      : message,
  );
}

export function ensureStream(state: StreamSlice, stream_id: string) {
  const existing = state.streamsById[stream_id];
  if (existing) {
    return {
      stream: existing,
      streamOrder: state.streamOrder,
      streamsById: state.streamsById,
      messages: state.messages,
    };
  }

  const stream = emptyStream(stream_id);
  let claimed = false;
  const claimedMessages = state.messages.map((message) => {
    if (claimed || message.role === "user") return message;
    if (message.stream_id || message.parts.length > 0) return message;
    claimed = true;
    return { ...stream, role: "agent" as const };
  });

  return {
    stream,
    streamOrder: [...state.streamOrder, stream_id],
    streamsById: { ...state.streamsById, [stream_id]: stream },
    messages: claimed
      ? claimedMessages
      : [...state.messages, { ...stream, role: "agent" as const }],
  };
}
