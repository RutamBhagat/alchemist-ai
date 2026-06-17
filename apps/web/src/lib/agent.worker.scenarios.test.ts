import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServerMessage } from "../../../agent-server/src/types";
import type { WorkerEvent } from "./worker-events";

type UiToWorker = {
  type: "send";
  content: string;
  turnId: string;
  attemptId: string;
};

type WorkerScope = {
  onmessage: ((event: MessageEvent<UiToWorker>) => void) | null;
  postMessage: (event: WorkerEvent) => void;
};

class ScenarioWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: ScenarioWebSocket[] = [];

  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onopen: (() => void) | null = null;
  readyState = ScenarioWebSocket.CONNECTING;
  sent: unknown[] = [];

  constructor(readonly url: string) {
    ScenarioWebSocket.instances.push(this);
  }

  close() {
    this.readyState = ScenarioWebSocket.CLOSED;
  }

  closeFromServer() {
    this.readyState = ScenarioWebSocket.CLOSED;
    this.onclose?.();
  }

  failConnection() {
    this.readyState = ScenarioWebSocket.CLOSED;
    this.onerror?.();
  }

  open() {
    this.readyState = ScenarioWebSocket.OPEN;
    this.onopen?.();
  }

  receive(message: ServerMessage) {
    this.receiveRaw(JSON.stringify(message));
  }

  receiveRaw(data: string) {
    this.onmessage?.({ data } as MessageEvent<string>);
  }

  send(payload: string) {
    this.sent.push(JSON.parse(payload) as unknown);
  }
}

async function bootWorker() {
  vi.useFakeTimers();
  vi.resetModules();
  ScenarioWebSocket.instances = [];

  const posted: WorkerEvent[] = [];
  const scope: WorkerScope = {
    onmessage: null,
    postMessage: (event) => posted.push(event),
  };

  vi.stubGlobal("self", scope);
  vi.stubGlobal("WebSocket", ScenarioWebSocket);

  await import(`./agent.worker?scenario=${Date.now()}-${Math.random()}`);

  return { posted, scope };
}

function sendPrompt(scope: WorkerScope) {
  scope.onmessage?.({
    data: {
      type: "send",
      content: "run scenario",
      turnId: "turn:1",
      attemptId: "turn:1:attempt:1",
    },
  } as MessageEvent<UiToWorker>);
}

function eventsOf<TKind extends WorkerEvent["kind"]>(
  posted: WorkerEvent[],
  kind: TKind,
): Extract<WorkerEvent, { kind: TKind }>[] {
  return posted.filter(
    (event): event is Extract<WorkerEvent, { kind: TKind }> => event.kind === kind,
  );
}

function statuses(posted: WorkerEvent[]) {
  return eventsOf(posted, "connection").map((event) => event.status);
}

function sentMessages(socket: ScenarioWebSocket, type: string) {
  return socket.sent.filter(
    (payload): payload is Record<string, unknown> =>
      typeof payload === "object" &&
      payload !== null &&
      "type" in payload &&
      payload.type === type,
  );
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("agent worker chaos scenarios", () => {
  it("marks an active stream waiting during a delayed response and returns to streaming on the next token", async () => {
    const { posted, scope } = await bootWorker();

    sendPrompt(scope);
    const socket = ScenarioWebSocket.instances[0];
    expect(socket).toBeDefined();
    socket?.open();

    socket?.receive({ type: "TOKEN", seq: 1, stream_id: "s", text: "start" });
    expect(statuses(posted).at(-1)).toBe("streaming");

    await vi.advanceTimersByTimeAsync(1_999);
    expect(statuses(posted).at(-1)).toBe("streaming");

    await vi.advanceTimersByTimeAsync(1);
    expect(statuses(posted).at(-1)).toBe("waiting");

    socket?.receive({ type: "TOKEN", seq: 2, stream_id: "s", text: " again" });
    expect(statuses(posted).at(-1)).toBe("streaming");
    expect(eventsOf(posted, "token").map((event) => event.text).join("")).toBe(
      "start again",
    );
  });

  it("uses 500ms, 1s, then 2s reconnect backoff while a stream is active", async () => {
    const { posted, scope } = await bootWorker();

    sendPrompt(scope);
    const first = ScenarioWebSocket.instances[0];
    expect(first).toBeDefined();
    first?.open();
    first?.receive({ type: "TOKEN", seq: 1, stream_id: "s", text: "partial" });

    first?.closeFromServer();
    expect(statuses(posted).at(-1)).toBe("reconnecting");

    await vi.advanceTimersByTimeAsync(499);
    expect(ScenarioWebSocket.instances).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(ScenarioWebSocket.instances).toHaveLength(2);

    const second = ScenarioWebSocket.instances[1];
    second?.failConnection();
    await vi.advanceTimersByTimeAsync(999);
    expect(ScenarioWebSocket.instances).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(1);
    expect(ScenarioWebSocket.instances).toHaveLength(3);

    const third = ScenarioWebSocket.instances[2];
    third?.failConnection();
    await vi.advanceTimersByTimeAsync(1_999);
    expect(ScenarioWebSocket.instances).toHaveLength(3);

    await vi.advanceTimersByTimeAsync(1);
    expect(ScenarioWebSocket.instances).toHaveLength(4);
  });

  it("recovers when the socket drops after a tool call but before its result", async () => {
    const { posted, scope } = await bootWorker();

    sendPrompt(scope);
    const first = ScenarioWebSocket.instances[0];
    expect(first).toBeDefined();
    first?.open();
    first?.receive({ type: "TOKEN", seq: 1, stream_id: "s", text: "before" });
    first?.receive({
      type: "TOOL_CALL",
      seq: 2,
      stream_id: "s",
      call_id: "c1",
      tool_name: "lookup",
      args: { query: "x" },
    });

    expect(sentMessages(first as ScenarioWebSocket, "TOOL_ACK")).toEqual([
      { type: "TOOL_ACK", call_id: "c1" },
    ]);
    expect(eventsOf(posted, "tool_call")).toHaveLength(1);

    first?.closeFromServer();
    await vi.advanceTimersByTimeAsync(500);

    const second = ScenarioWebSocket.instances[1];
    expect(second).toBeDefined();
    second?.open();
    expect(second?.sent[0]).toEqual({ type: "RESUME", last_seq: 2 });

    second?.receive({
      type: "TOOL_CALL",
      seq: 2,
      stream_id: "s",
      call_id: "c1",
      tool_name: "lookup",
      args: { query: "replayed" },
    });
    second?.receive({
      type: "TOOL_RESULT",
      seq: 3,
      stream_id: "s",
      call_id: "c1",
      result: { ok: true },
    });

    expect(sentMessages(second as ScenarioWebSocket, "TOOL_ACK")).toEqual([]);
    expect(eventsOf(posted, "tool_call")).toHaveLength(1);
    expect(eventsOf(posted, "tool_result")).toMatchObject([
      {
        call_id: "turn:1:attempt:1:call:c1",
        result: { ok: true },
        seq: 3,
        stream_id: "turn:1:attempt:1:stream:s",
      },
    ]);
  });

  it("keeps malformed frames from corrupting an out-of-order stream buffer", async () => {
    const { posted, scope } = await bootWorker();

    sendPrompt(scope);
    const socket = ScenarioWebSocket.instances[0];
    expect(socket).toBeDefined();
    socket?.open();

    socket?.receive({ type: "TOKEN", seq: 3, stream_id: "s", text: "third" });
    socket?.receiveRaw("not-json");
    socket?.receiveRaw(JSON.stringify({ type: "TOKEN", seq: 2, text: "missing stream" }));
    socket?.receive({ type: "TOKEN", seq: 1, stream_id: "s", text: "first" });
    expect(eventsOf(posted, "token").map((event) => event.seq)).toEqual([1]);

    socket?.receive({ type: "TOKEN", seq: 2, stream_id: "s", text: "second" });
    expect(eventsOf(posted, "token").map((event) => event.seq)).toEqual([1, 2, 3]);
    expect(eventsOf(posted, "token").map((event) => event.text)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });
});
