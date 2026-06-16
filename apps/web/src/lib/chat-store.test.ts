import { beforeEach, describe, expect, it } from "vitest";
import { useChatStore } from "./chat-store";

function resetStore() {
  useChatStore.setState({
    contexts: {},
    entryOrder: [],
    nextUserMessageId: 0,
    selectedContextId: null,
    streamOrder: [],
    streamsById: {},
    toolsByCallId: {},
    userMessagesById: {},
  });
}

describe("chat store stream partitioning", () => {
  beforeEach(() => {
    resetStore();
  });

  it("partitions interleaved tokens and tool calls by stream_id", () => {
    const actions = useChatStore.getState();

    actions.addUserMessage("question");
    actions.appendToken({
      type: "TOKEN",
      seq: 1,
      stream_id: "A",
      target: "stream:A:text:1",
      text: "The ",
    });
    actions.appendToken({
      type: "TOKEN",
      seq: 2,
      stream_id: "B",
      target: "stream:B:text:1",
      text: "Hello ",
    });
    actions.appendToken({
      type: "TOKEN",
      seq: 3,
      stream_id: "A",
      target: "stream:A:text:1",
      text: "answer",
    });
    actions.addToolCall({
      type: "TOOL_CALL",
      seq: 4,
      stream_id: "B",
      call_id: "c1",
      tool_name: "lookup",
      args: { query: "test" },
    });

    const state = useChatStore.getState();

    expect(state.entryOrder).toEqual([
      { kind: "user", id: "user:1" },
      { kind: "agent_stream", stream_id: "A" },
      { kind: "agent_stream", stream_id: "B" },
    ]);
    expect(state.streamsById.A?.parts).toEqual([
      {
        kind: "text",
        id: "stream:A:text:1",
        target: "stream:A:text:1",
        text: "The answer",
        frozen: false,
      },
    ]);
    expect(state.streamsById.B?.parts).toEqual([
      {
        kind: "text",
        id: "stream:B:text:1",
        target: "stream:B:text:1",
        text: "Hello ",
        frozen: true,
      },
      { kind: "tool", call_id: "c1" },
    ]);
    expect(state.toolsByCallId.c1).toMatchObject({
      call_id: "c1",
      stream_id: "B",
      status: "waiting",
    });
  });

  it("patches tool results by call_id and validates stream ownership", () => {
    const actions = useChatStore.getState();

    actions.addToolCall({
      type: "TOOL_CALL",
      seq: 1,
      stream_id: "A",
      call_id: "c1",
      tool_name: "lookup",
      args: {},
    });

    actions.setToolResult({
      type: "TOOL_RESULT",
      seq: 2,
      stream_id: "B",
      call_id: "c1",
      result: { value: "wrong" },
    });

    expect(useChatStore.getState().toolsByCallId.c1?.result).toBeUndefined();

    actions.setToolResult({
      type: "TOOL_RESULT",
      seq: 3,
      stream_id: "A",
      call_id: "c1",
      result: { value: "ok" },
    });

    const state = useChatStore.getState();
    expect(state.toolsByCallId.c1).toMatchObject({
      result: { value: "ok" },
      status: "complete",
    });
    expect(state.streamsById.A).toMatchObject({
      last_seq: 3,
      status: "streaming",
    });
  });

  it("marks only the addressed stream complete", () => {
    const actions = useChatStore.getState();

    actions.appendToken({
      type: "TOKEN",
      seq: 1,
      stream_id: "A",
      target: "stream:A:text:1",
      text: "A",
    });
    actions.appendToken({
      type: "TOKEN",
      seq: 2,
      stream_id: "B",
      target: "stream:B:text:1",
      text: "B",
    });
    actions.endStream({
      type: "STREAM_END",
      seq: 3,
      stream_id: "A",
    });

    const state = useChatStore.getState();
    expect(state.streamsById.A).toMatchObject({
      last_seq: 3,
      status: "complete",
    });
    expect(state.streamsById.B).toMatchObject({
      last_seq: 2,
      status: "streaming",
    });
  });
});
