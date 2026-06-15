import { describe, expect, it } from "vitest";
import type { ServerMessage } from "../../../agent-server/src/types";
import { createSequenceGate } from "./sequence-gate";

function token(seq: number): ServerMessage {
  return { type: "TOKEN", seq, text: `${seq}`, stream_id: "s" };
}

describe("createSequenceGate", () => {
  it("buffers out-of-order messages until the gap is filled", () => {
    const gate = createSequenceGate();
    gate.startTurn();

    expect(gate.accept(token(3))).toEqual([]);
    expect(gate.accept(token(2))).toEqual([]);
    expect(gate.accept(token(1)).map((message) => message.seq)).toEqual([
      1, 2, 3,
    ]);
  });

  it("dedupes processed and pending sequence numbers", () => {
    const gate = createSequenceGate();
    gate.startTurn();

    expect(gate.accept(token(2))).toEqual([]);
    expect(gate.accept(token(2))).toEqual([]);
    expect(gate.accept(token(1)).map((message) => message.seq)).toEqual([1, 2]);
    expect(gate.accept(token(1))).toEqual([]);
  });

  it("starts a new turn by clearing processed and pending state", () => {
    const gate = createSequenceGate();
    gate.startTurn();

    expect(gate.accept(token(2))).toEqual([]);
    expect(gate.accept(token(1)).map((message) => message.seq)).toEqual([1, 2]);

    gate.startTurn();

    expect(gate.accept(token(1)).map((message) => message.seq)).toEqual([1]);
  });
});
