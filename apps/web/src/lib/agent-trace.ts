import type { ServerMessage } from "../../../agent-server/src/types";
import type { AttemptId, TurnId, WorkerEvent } from "./worker-events";

type OutboundTraceType = "PONG" | "TOOL_ACK" | "USER_MESSAGE" | "RESUME";
type TraceEvent = Extract<WorkerEvent, { kind: "trace" }>;
type TraceIdentity = {
  turnId?: TurnId;
  attemptId?: AttemptId;
  stream_id?: string;
  call_id?: string;
  target?: string;
};

let traceId = 0;

function postTrace(event: TraceEvent) {
  self.postMessage(event);
}

export function trace(
  message: ServerMessage,
  at: number,
  label = "text" in message ? message.text : message.type,
  identity: TraceIdentity = {},
) {
  postTrace({
    kind: "trace",
    id: ++traceId,
    at,
    direction: "in",
    type: message.type,
    turnId: identity.turnId,
    attemptId: identity.attemptId,
    seq: message.seq,
    stream_id:
      identity.stream_id ?? ("stream_id" in message ? message.stream_id : undefined),
    call_id: identity.call_id ?? ("call_id" in message ? message.call_id : undefined),
    target: identity.target,
    text: "text" in message ? message.text : undefined,
    label,
  });
}

export function traceOut(
  type: OutboundTraceType,
  label: string,
  identity: TraceIdentity = {},
) {
  postTrace({
    kind: "trace",
    id: ++traceId,
    at: performance.now(),
    direction: "out",
    type,
    turnId: identity.turnId,
    attemptId: identity.attemptId,
    call_id: identity.call_id,
    target: identity.target,
    label,
  });
}
