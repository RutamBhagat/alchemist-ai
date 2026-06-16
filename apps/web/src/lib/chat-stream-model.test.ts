import { describe, expect, it } from "vitest";
import type { AgentStream, ChatStreamState, StreamPart, TextPart } from "./chat-stream-model";
import {
  addToolCallToStream,
  appendTokenToStream,
  emptyChatStreamState,
  endStreamById,
  setToolResultForCall,
} from "./chat-stream-model";

function stream(state: ChatStreamState, streamId: string): AgentStream {
  const value = state.streamsById[streamId];
  expect(value).toBeDefined();
  return value as AgentStream;
}

function textPart(part: StreamPart | undefined): TextPart {
  expect(part?.kind).toBe("text");
  return part as TextPart;
}

describe("chat stream model", () => {
  it("partitions interleaved tokens and tool calls by stream_id", () => {
    let state = emptyChatStreamState();

    state = appendTokenToStream(state, {
      stream_id: "A",
      seq: 1,
      target: "stream:A:text:1",
      text: "The ",
    });
    state = appendTokenToStream(state, {
      stream_id: "B",
      seq: 2,
      target: "stream:B:text:1",
      text: "Hello ",
    });
    state = appendTokenToStream(state, {
      stream_id: "A",
      seq: 3,
      target: "stream:A:text:1",
      text: "answer ",
    });
    state = addToolCallToStream(state, {
      stream_id: "B",
      seq: 4,
      call_id: "c1",
      tool_name: "lookup",
      args: { query: "test" },
    });
    state = appendTokenToStream(state, {
      stream_id: "A",
      seq: 5,
      target: "stream:A:text:1",
      text: "is...",
    });

    expect(state.streamOrder).toEqual(["A", "B"]);

    const streamA = stream(state, "A");
    expect(streamA.status).toBe("streaming");
    expect(streamA.last_seq).toBe(5);
    expect(streamA.parts).toHaveLength(1);
    expect(textPart(streamA.parts[0])).toMatchObject({
      text: "The answer is...",
      frozen: false,
    });

    const streamB = stream(state, "B");
    expect(streamB.status).toBe("tool_pending");
    expect(streamB.last_seq).toBe(4);
    expect(streamB.parts).toHaveLength(2);
    expect(textPart(streamB.parts[0])).toMatchObject({
      text: "Hello ",
      frozen: true,
    });
    expect(streamB.parts[1]).toEqual({ kind: "tool", call_id: "c1" });
    expect(state.toolsByCallId.c1).toMatchObject({
      call_id: "c1",
      stream_id: "B",
      status: "waiting",
    });
  });

  it("creates a new text part when the target changes or the previous text is frozen", () => {
    let state = emptyChatStreamState();

    state = appendTokenToStream(state, {
      stream_id: "A",
      seq: 1,
      target: "stream:A:text:1",
      text: "Before ",
    });
    state = addToolCallToStream(state, {
      stream_id: "A",
      seq: 2,
      call_id: "c1",
      tool_name: "lookup",
      args: {},
    });
    state = appendTokenToStream(state, {
      stream_id: "A",
      seq: 3,
      target: "stream:A:text:2",
      text: "After",
    });

    const streamA = stream(state, "A");
    expect(streamA.parts).toHaveLength(3);
    expect(textPart(streamA.parts[0])).toMatchObject({
      text: "Before ",
      frozen: true,
    });
    expect(streamA.parts[1]).toEqual({ kind: "tool", call_id: "c1" });
    expect(textPart(streamA.parts[2])).toMatchObject({
      text: "After",
      frozen: false,
    });
  });

  it("treats duplicate tool calls as idempotent replay", () => {
    let state = emptyChatStreamState();

    state = addToolCallToStream(state, {
      stream_id: "A",
      seq: 1,
      call_id: "c1",
      tool_name: "lookup",
      args: { query: "first" },
    });

    const beforeDuplicate = state;

    state = addToolCallToStream(state, {
      stream_id: "A",
      seq: 1,
      call_id: "c1",
      tool_name: "lookup",
      args: { query: "duplicate" },
    });

    expect(state).toBe(beforeDuplicate);
    expect(stream(state, "A").parts).toEqual([{ kind: "tool", call_id: "c1" }]);
    expect(state.toolsByCallId.c1?.args).toEqual({ query: "first" });
  });

  it("patches tool results by call_id and validates stream ownership", () => {
    let state = emptyChatStreamState();

    state = addToolCallToStream(state, {
      stream_id: "A",
      seq: 1,
      call_id: "c1",
      tool_name: "lookup",
      args: {},
    });

    const beforeWrongStream = state;

    state = setToolResultForCall(state, {
      stream_id: "B",
      seq: 2,
      call_id: "c1",
      result: { value: "wrong" },
    });

    expect(state).toBe(beforeWrongStream);

    state = setToolResultForCall(state, {
      stream_id: "A",
      seq: 3,
      call_id: "c1",
      result: { value: "ok" },
    });

    expect(state.toolsByCallId.c1).toMatchObject({
      result: { value: "ok" },
      status: "complete",
    });
    expect(stream(state, "A")).toMatchObject({
      status: "streaming",
      last_seq: 3,
    });
  });

  it("marks only the addressed stream complete", () => {
    let state = emptyChatStreamState();

    state = appendTokenToStream(state, {
      stream_id: "A",
      seq: 1,
      target: "stream:A:text:1",
      text: "A",
    });
    state = appendTokenToStream(state, {
      stream_id: "B",
      seq: 2,
      target: "stream:B:text:1",
      text: "B",
    });
    state = endStreamById(state, { stream_id: "A", seq: 3 });

    expect(stream(state, "A")).toMatchObject({
      status: "complete",
      last_seq: 3,
    });
    expect(stream(state, "B")).toMatchObject({
      status: "streaming",
      last_seq: 2,
    });
  });
});
