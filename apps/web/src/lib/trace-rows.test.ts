import { describe, expect, it } from "vitest";
import {
  appendTraceEvent,
  emptyTraceRowsState,
  type TraceEvent,
} from "./trace-rows";

function event(
  id: number,
  type: TraceEvent["type"],
  fields: Partial<TraceEvent> = {},
): TraceEvent {
  return {
    kind: "trace",
    id,
    at: id,
    direction: "in",
    type,
    label: type,
    ...fields,
  };
}

describe("appendTraceEvent", () => {
  it("extends the last token row for the same stream", () => {
    const state = [
      event(1, "TOKEN", { stream_id: "s1", text: "a" }),
      event(2, "TOKEN", { stream_id: "s1", text: "b" }),
      event(3, "TOKEN", { stream_id: "s2", text: "c" }),
    ].reduce(appendTraceEvent, emptyTraceRowsState);

    expect(state.rows).toHaveLength(2);
    expect(state.rows[0]).toMatchObject({ kind: "token_group" });
    if (state.rows[0].kind !== "token_group") throw new Error("expected tokens");
    expect(state.rows[0].items.map((item) => item.text).join("")).toBe("ab");
  });

  it("pairs tool ack and result with the tool call row", () => {
    const state = [
      event(1, "TOOL_ACK", { call_id: "c1", direction: "out" }),
      event(2, "TOOL_CALL", { call_id: "c1" }),
      event(3, "TOOL_RESULT", { call_id: "c1" }),
    ].reduce(appendTraceEvent, emptyTraceRowsState);

    expect(state.rows).toHaveLength(1);
    expect(state.rows[0]).toMatchObject({
      kind: "tool_group",
      ack: { id: 1 },
      call: { id: 2 },
      result: { id: 3 },
    });
  });
});
