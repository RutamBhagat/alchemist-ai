import type { WorkerEvent } from "./worker-events";

export type TraceEvent = Extract<WorkerEvent, { kind: "trace" }>;
export type TraceRow =
  | TraceEvent
  | { kind: "token_group"; items: TraceEvent[] }
  | { kind: "tool_group"; call: TraceEvent; ack?: TraceEvent; result?: TraceEvent };

export type TraceRowsState = {
  eventTypes: string[];
  pendingAcks: Record<string, TraceEvent>;
  rows: TraceRow[];
};

export const emptyTraceRowsState: TraceRowsState = {
  eventTypes: [],
  pendingAcks: {},
  rows: [],
};

export function appendTraceEvent(
  state: TraceRowsState,
  event: TraceEvent,
): TraceRowsState {
  const eventTypes = state.eventTypes.includes(event.type)
    ? state.eventTypes
    : [...state.eventTypes, event.type].sort();

  if (event.type === "TOOL_ACK" && event.call_id) {
    return {
      eventTypes,
      pendingAcks: { ...state.pendingAcks, [event.call_id]: event },
      rows: state.rows,
    };
  }

  if (event.type === "TOKEN") {
    const last = state.rows.at(-1);
    if (
      last?.kind === "token_group" &&
      last.items.at(-1)?.stream_id === event.stream_id
    ) {
      return {
        eventTypes,
        pendingAcks: state.pendingAcks,
        rows: [
          ...state.rows.slice(0, -1),
          { ...last, items: [...last.items, event] },
        ],
      };
    }
    return {
      eventTypes,
      pendingAcks: state.pendingAcks,
      rows: [...state.rows, { kind: "token_group", items: [event] }],
    };
  }

  if (event.type === "TOOL_CALL" && event.call_id) {
    const { [event.call_id]: ack, ...pendingAcks } = state.pendingAcks;
    return {
      eventTypes,
      pendingAcks,
      rows: [...state.rows, { kind: "tool_group", call: event, ack }],
    };
  }

  if (event.type === "TOOL_RESULT") {
    const index = state.rows.findLastIndex(
      (row) => row.kind === "tool_group" && row.call.call_id === event.call_id,
    );
    if (index !== -1 && state.rows[index]?.kind === "tool_group") {
      const row = state.rows[index];
      if (!row.result) {
        return {
          eventTypes,
          pendingAcks: state.pendingAcks,
          rows: state.rows.with(index, { ...row, result: event }),
        };
      }
    }
  }

  return {
    eventTypes,
    pendingAcks: state.pendingAcks,
    rows: [...state.rows, event],
  };
}
