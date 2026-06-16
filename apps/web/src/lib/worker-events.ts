import type {
  ContextSnapshotMessage,
  ServerMessage,
  StreamEndMessage,
  TokenMessage,
  ToolCallMessage,
  ToolResultMessage,
} from "../../../agent-server/src/types";

export type TurnId = string;
export type AttemptId = string;

export type ConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "streaming"
  | "waiting"
  | "reconnecting"
  | "disconnected";

export type WorkerEvent =
  | {
      kind: "token";
      turnId: TurnId;
      attemptId: AttemptId;
      seq: TokenMessage["seq"];
      stream_id: TokenMessage["stream_id"];
      text: TokenMessage["text"];
      target: string;
    }
  | {
      kind: "context";
      turnId: TurnId;
      attemptId: AttemptId;
      context_id: ContextSnapshotMessage["context_id"];
      data: ContextSnapshotMessage["data"];
    }
  | { kind: "turn_interrupted" }
  | { kind: "notification"; type: "error"; message: string }
  | { kind: "connection"; status: ConnectionStatus }
  | {
      kind: "trace";
      id: number;
      at: number;
      direction: "in" | "out" | "system";
      type:
        | ServerMessage["type"]
        | "PONG"
        | "TOOL_ACK"
        | "USER_MESSAGE"
        | "RESUME"
        | "RETRY_STARTED";
      turnId?: TurnId;
      attemptId?: AttemptId;
      seq?: number;
      stream_id?: string;
      call_id?: string;
      target?: string;
      text?: string;
      label: string;
    }
  | {
      kind: "tool_call";
      turnId: TurnId;
      attemptId: AttemptId;
      seq: ToolCallMessage["seq"];
      stream_id: ToolCallMessage["stream_id"];
      call_id: ToolCallMessage["call_id"];
      tool_name: ToolCallMessage["tool_name"];
      args: ToolCallMessage["args"];
      result?: ToolResultMessage["result"];
    }
  | {
      kind: "tool_result";
      turnId: TurnId;
      attemptId: AttemptId;
      seq: ToolResultMessage["seq"];
      stream_id: ToolResultMessage["stream_id"];
      call_id: ToolResultMessage["call_id"];
      result: ToolResultMessage["result"];
    }
  | {
      kind: "stream_end";
      turnId: TurnId;
      attemptId: AttemptId;
      seq: StreamEndMessage["seq"];
      stream_id: StreamEndMessage["stream_id"];
    };
