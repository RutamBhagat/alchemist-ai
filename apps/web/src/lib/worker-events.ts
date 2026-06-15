import type {
  ScriptContextEvent,
  ScriptTokenEvent,
  ServerMessage,
  ToolCallMessage,
  ToolResultMessage,
} from "../../../agent-server/src/types";

export type ConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "streaming"
  | "waiting"
  | "reconnecting"
  | "disconnected";

export type WorkerEvent =
  | ScriptTokenEvent
  | ScriptContextEvent
  | { kind: "notification"; type: "error"; message: string }
  | { kind: "connection"; status: ConnectionStatus }
  | {
      kind: "trace";
      id: number;
      at: number;
      direction: "in" | "out";
      type: ServerMessage["type"] | "PONG" | "TOOL_ACK" | "USER_MESSAGE" | "RESUME";
      seq?: number;
      stream_id?: string;
      call_id?: string;
      text?: string;
      label: string;
    }
  | {
      kind: "tool_call";
      call_id: ToolCallMessage["call_id"];
      tool_name: ToolCallMessage["tool_name"];
      args: ToolCallMessage["args"];
      result?: ToolResultMessage["result"];
    }
  | {
      kind: "tool_result";
      call_id: ToolResultMessage["call_id"];
      result: ToolResultMessage["result"];
    };
