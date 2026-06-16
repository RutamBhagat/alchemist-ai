import type { ContextSnapshotMessage } from "../../../agent-server/src/types";

export type ContextSnapshot = Pick<ContextSnapshotMessage, "context_id" | "data">;
export type ContextSlot = { snapshots: ContextSnapshot[] };
export type StreamStatus = "streaming" | "tool_pending" | "complete";
export type TextPart = {
  kind: "text";
  id: string;
  target: string;
  text: string;
  frozen: boolean;
};
export type ToolPart = { kind: "tool_call"; call_id: string };
export type MessagePart = TextPart | ToolPart;
export type ToolCall = {
  id: string;
  call_id: string;
  stream_id: string;
  tool_name: string;
  args: Record<string, unknown>;
  result?: Record<string, unknown>;
  status: "waiting" | "complete";
};
export type AgentStream = {
  stream_id: string;
  status: StreamStatus;
  parts: MessagePart[];
  last_seq?: number;
};
export type Message =
  | { role: "user"; text: string }
  | (AgentStream & { role: "agent"; stream_id?: string });
export type StreamSlice = {
  messages: Message[];
  streamOrder: string[];
  streamsById: Record<string, AgentStream>;
};
