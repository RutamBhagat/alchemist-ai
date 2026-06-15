import type {
  ScriptContextEvent,
  ScriptTokenEvent,
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
  | { kind: "connection"; status: ConnectionStatus }
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
