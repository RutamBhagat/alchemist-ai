import type { ServerMessage } from "../../../agent-server/src/types";
import type { WorkerEvent } from "./worker-events";

type OutboundTraceType = "PONG" | "TOOL_ACK" | "USER_MESSAGE" | "RESUME";
type TraceEvent = Extract<WorkerEvent, { kind: "trace" }>;

let traceId = 0;

function postTrace(event: TraceEvent) {
  self.postMessage(event);
}

export function trace(
  message: ServerMessage,
  at: number,
  label = "text" in message ? message.text : message.type,
) {
  postTrace({
    kind: "trace",
    id: ++traceId,
    at,
    direction: "in",
    type: message.type,
    seq: message.seq,
    stream_id: "stream_id" in message ? message.stream_id : undefined,
    call_id: "call_id" in message ? message.call_id : undefined,
    text: "text" in message ? message.text : undefined,
    label,
  });
}

export function traceOut(
  type: OutboundTraceType,
  label: string,
  call_id?: string,
) {
  postTrace({
    kind: "trace",
    id: ++traceId,
    at: performance.now(),
    direction: "out",
    type,
    call_id,
    label,
  });
}
