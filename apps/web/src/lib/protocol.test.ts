import { describe, expect, it } from "vitest";
import { serverMessageSchema } from "./protocol";

describe("serverMessageSchema", () => {
  it("accepts valid heartbeats including an empty challenge", () => {
    const result = serverMessageSchema.safeParse({
      type: "PING",
      seq: 1,
      challenge: "",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ type: "PING", seq: 1, challenge: "" });
    }
  });

  it("rejects corrupt heartbeat payloads instead of normalizing them", () => {
    expect(serverMessageSchema.safeParse({ type: "PING", seq: 1 }).success).toBe(
      false,
    );
    expect(
      serverMessageSchema.safeParse({ type: "PING", seq: 2, challenge: 42 }).success,
    ).toBe(false);
    expect(
      serverMessageSchema.safeParse({ type: "PING", seq: "3", challenge: "x" }).success,
    ).toBe(false);
  });

  it("requires stream ownership fields for stream-scoped messages", () => {
    expect(
      serverMessageSchema.safeParse({ type: "TOKEN", seq: 1, text: "hello" }).success,
    ).toBe(false);
    expect(
      serverMessageSchema.safeParse({
        type: "TOOL_CALL",
        seq: 2,
        call_id: "c1",
        tool_name: "lookup",
        args: {},
      }).success,
    ).toBe(false);
    expect(
      serverMessageSchema.safeParse({ type: "STREAM_END", seq: 3 }).success,
    ).toBe(false);
  });

  it("rejects malformed tool call and result payload shapes", () => {
    expect(
      serverMessageSchema.safeParse({
        type: "TOOL_CALL",
        seq: 1,
        stream_id: "s",
        call_id: "c1",
        tool_name: "lookup",
        args: null,
      }).success,
    ).toBe(false);
    expect(
      serverMessageSchema.safeParse({
        type: "TOOL_RESULT",
        seq: 2,
        stream_id: "s",
        call_id: "c1",
        result: "done",
      }).success,
    ).toBe(false);
  });
});
