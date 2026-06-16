import type { AgentStream, StreamSlice } from "./chat-model";
import { ensureStream, syncMessage } from "./chat-streams";

export type TokenEvent = {
  stream_id: string;
  seq: number;
  text: string;
  target: string;
};

export type StreamEndEvent = { stream_id: string; seq: number };

export function appendTokenState(state: StreamSlice, event: TokenEvent) {
  const ensured = ensureStream(state, event.stream_id);
  const parts = [...ensured.stream.parts];
  const last = parts.at(-1);

  if (last?.kind === "text" && last.target === event.target && !last.frozen) {
    parts[parts.length - 1] = { ...last, text: last.text + event.text };
  } else {
    parts.push({
      kind: "text",
      id: event.target,
      target: event.target,
      text: event.text,
      frozen: false,
    });
  }

  const stream: AgentStream = {
    ...ensured.stream,
    parts,
    status: "streaming",
    last_seq: event.seq,
  };

  return {
    streamOrder: ensured.streamOrder,
    streamsById: { ...ensured.streamsById, [event.stream_id]: stream },
    messages: syncMessage(ensured.messages, event.stream_id, stream),
  };
}

export function endStreamState(state: StreamSlice, event: StreamEndEvent) {
  const ensured = ensureStream(state, event.stream_id);
  const stream: AgentStream = {
    ...ensured.stream,
    status: "complete",
    last_seq: event.seq,
  };

  return {
    streamOrder: ensured.streamOrder,
    streamsById: { ...ensured.streamsById, [event.stream_id]: stream },
    messages: syncMessage(ensured.messages, event.stream_id, stream),
  };
}
