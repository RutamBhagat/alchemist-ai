import type { AgentStream, StreamSlice, ToolCall } from "./chat-model";
import { ensureStream, syncMessage } from "./chat-streams";

export type ToolCallEvent = {
  stream_id: string;
  seq: number;
  call_id: string;
  tool_name: string;
  args: Record<string, unknown>;
};

export type ToolResultEvent = {
  stream_id: string;
  seq: number;
  call_id: string;
  result: Record<string, unknown>;
};

type ToolState = StreamSlice & { toolsByCallId: Record<string, ToolCall> };

export function addToolCallState(state: ToolState, event: ToolCallEvent) {
  if (state.toolsByCallId[event.call_id]) return state;

  const ensured = ensureStream(state, event.stream_id);
  const parts = ensured.stream.parts.map((part, index, all) =>
    index === all.length - 1 && part.kind === "text"
      ? { ...part, frozen: true }
      : part,
  );
  parts.push({ kind: "tool_call", call_id: event.call_id });

  const stream: AgentStream = {
    ...ensured.stream,
    parts,
    status: "tool_pending",
    last_seq: event.seq,
  };

  return {
    streamOrder: ensured.streamOrder,
    streamsById: { ...ensured.streamsById, [event.stream_id]: stream },
    messages: syncMessage(ensured.messages, event.stream_id, stream),
    toolsByCallId: {
      ...state.toolsByCallId,
      [event.call_id]: {
        id: event.call_id,
        call_id: event.call_id,
        stream_id: event.stream_id,
        tool_name: event.tool_name,
        args: event.args,
        status: "waiting" as const,
      },
    },
  };
}

export function setToolResultState(state: ToolState, event: ToolResultEvent) {
  const tool = state.toolsByCallId[event.call_id];
  if (!tool) return state;

  const ensured = ensureStream(state, event.stream_id);
  const stream: AgentStream = {
    ...ensured.stream,
    status: "streaming",
    last_seq: event.seq,
  };

  return {
    streamOrder: ensured.streamOrder,
    streamsById: { ...ensured.streamsById, [event.stream_id]: stream },
    messages: syncMessage(ensured.messages, event.stream_id, stream),
    toolsByCallId: {
      ...state.toolsByCallId,
      [event.call_id]: { ...tool, result: event.result, status: "complete" as const },
    },
  };
}
