export type StreamStatus =
  | "streaming"
  | "tool_pending"
  | "complete"
  | "errored"
  | "interrupted";

export type TextPart = {
  kind: "text";
  id: string;
  target: string;
  text: string;
  frozen: boolean;
};

export type ToolPart = {
  kind: "tool";
  call_id: string;
};

export type StreamPart = TextPart | ToolPart;

export type ToolCall = {
  call_id: string;
  server_call_id: string;
  stream_id: string;
  tool_name: string;
  args: Record<string, unknown>;
  result?: Record<string, unknown>;
  status: "waiting" | "complete";
};

export type AgentStream = {
  stream_id: string;
  status: StreamStatus;
  parts: StreamPart[];
  last_seq?: number;
};

export type ChatStreamState = {
  streamOrder: string[];
  streamsById: Record<string, AgentStream>;
  toolsByCallId: Record<string, ToolCall>;
};

export const emptyChatStreamState = (): ChatStreamState => ({
  streamOrder: [],
  streamsById: {},
  toolsByCallId: {},
});

export function ensureStream(
  state: ChatStreamState,
  stream_id: string,
): AgentStream {
  return (
    state.streamsById[stream_id] ?? {
      stream_id,
      status: "streaming",
      parts: [],
    }
  );
}

function withStream(
  state: ChatStreamState,
  stream: AgentStream,
): ChatStreamState {
  const exists = Boolean(state.streamsById[stream.stream_id]);

  return {
    ...state,
    streamOrder: exists
      ? state.streamOrder
      : [...state.streamOrder, stream.stream_id],
    streamsById: {
      ...state.streamsById,
      [stream.stream_id]: stream,
    },
  };
}

export function appendTokenToStream(
  state: ChatStreamState,
  event: {
    stream_id: string;
    seq: number;
    text: string;
    target: string;
  },
): ChatStreamState {
  const stream = ensureStream(state, event.stream_id);
  const parts = [...stream.parts];
  const last = parts.at(-1);

  if (last?.kind === "text" && !last.frozen && last.target === event.target) {
    parts[parts.length - 1] = {
      ...last,
      text: last.text + event.text,
    };
  } else {
    parts.push({
      kind: "text",
      id: event.target,
      target: event.target,
      text: event.text,
      frozen: false,
    });
  }

  return withStream(state, {
    ...stream,
    parts,
    status: "streaming",
    last_seq: event.seq,
  });
}

export function addToolCallToStream(
  state: ChatStreamState,
  event: {
    stream_id: string;
    seq: number;
    call_id: string;
    server_call_id?: string;
    tool_name: string;
    args: Record<string, unknown>;
  },
): ChatStreamState {
  if (state.toolsByCallId[event.call_id]) {
    return state;
  }

  const stream = ensureStream(state, event.stream_id);
  const parts = stream.parts.map((part, index) => {
    const isLast = index === stream.parts.length - 1;

    if (isLast && part.kind === "text") {
      return { ...part, frozen: true };
    }

    return part;
  });

  parts.push({ kind: "tool", call_id: event.call_id });

  return {
    ...withStream(state, {
      ...stream,
      parts,
      status: "tool_pending",
      last_seq: event.seq,
    }),
    toolsByCallId: {
      ...state.toolsByCallId,
      [event.call_id]: {
        call_id: event.call_id,
        server_call_id: event.server_call_id ?? event.call_id,
        stream_id: event.stream_id,
        tool_name: event.tool_name,
        args: event.args,
        status: "waiting",
      },
    },
  };
}

export function setToolResultForCall(
  state: ChatStreamState,
  event: {
    stream_id: string;
    seq: number;
    call_id: string;
    result: Record<string, unknown>;
  },
): ChatStreamState {
  const tool = state.toolsByCallId[event.call_id];

  if (!tool || tool.stream_id !== event.stream_id) {
    return state;
  }

  const stream = ensureStream(state, event.stream_id);

  return {
    ...withStream(state, {
      ...stream,
      status: "streaming",
      last_seq: event.seq,
    }),
    toolsByCallId: {
      ...state.toolsByCallId,
      [event.call_id]: {
        ...tool,
        result: event.result,
        status: "complete",
      },
    },
  };
}

export function endStreamById(
  state: ChatStreamState,
  event: {
    stream_id: string;
    seq: number;
  },
): ChatStreamState {
  const stream = ensureStream(state, event.stream_id);

  return withStream(state, {
    ...stream,
    status: "complete",
    last_seq: event.seq,
  });
}
