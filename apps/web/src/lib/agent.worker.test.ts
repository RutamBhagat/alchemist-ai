import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServerMessage } from "../../../agent-server/src/types";
import type { WorkerEvent } from "./worker-events";

type UiToWorker = {
  type: "send";
  content: string;
  turnId: string;
  attemptId: string;
};

type FakeWorkerGlobal = {
  onmessage: ((event: MessageEvent<UiToWorker>) => void) | null;
  postMessage: (event: WorkerEvent) => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function workerEvents<TKind extends WorkerEvent["kind"]>(
  events: WorkerEvent[],
  kind: TKind,
): Extract<WorkerEvent, { kind: TKind }>[] {
  return events.filter(
    (event): event is Extract<WorkerEvent, { kind: TKind }> => event.kind === kind,
  );
}

function sentOfType(socket: FakeWebSocket, type: string) {
  return socket.sent.filter(
    (payload) => isRecord(payload) && payload.type === type,
  );
}

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readonly url: string;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onopen: (() => void) | null = null;
  readyState = FakeWebSocket.CONNECTING;
  sent: unknown[] = [];

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
  }

  closeFromServer() {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
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

async function loadWorker() {
  vi.useFakeTimers();
  vi.resetModules();
  FakeWebSocket.instances = [];

  const posted: WorkerEvent[] = [];
  const scope: FakeWorkerGlobal = {
    onmessage: null,
    postMessage: (event) => posted.push(event),
  };

  vi.stubGlobal("self", scope);
  vi.stubGlobal("WebSocket", FakeWebSocket);

  await import(`./agent.worker?test=${Date.now()}-${Math.random()}`);

  return { posted, scope };
}

function sendUserMessage(scope: FakeWorkerGlobal) {
  scope.onmessage?.({
    data: {
      type: "send",
      content: "hello",
      turnId: "turn:1",
      attemptId: "turn:1:attempt:1",
    },
  } as MessageEvent<UiToWorker>);
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("agent worker protocol behavior", () => {
  it("answers PING immediately even while earlier sequenced messages are buffered", async () => {
    const { posted, scope } = await loadWorker();

    sendUserMessage(scope);
    const socket = FakeWebSocket.instances[0];
    expect(socket).toBeDefined();
    socket?.open();

    socket?.receive({ type: "TOKEN", seq: 2, stream_id: "s", text: "later" });
    expect(workerEvents(posted, "token")).toHaveLength(0);

    socket?.receive({ type: "PING", seq: 99, challenge: "" });

    expect(sentOfType(socket as FakeWebSocket, "PONG")).toEqual([
      { type: "PONG", echo: "" },
    ]);
    expect(workerEvents(posted, "trace").some((event) => event.type === "PONG")).toBe(
      true,
    );

    socket?.receive({ type: "TOKEN", seq: 1, stream_id: "s", text: "first " });
    expect(workerEvents(posted, "token").map((event) => event.seq)).toEqual([1, 2]);
  });

  it("ACKs TOOL_CALL before ordered UI application and dedupes ACKs by call_id", async () => {
    const { posted, scope } = await loadWorker();

    sendUserMessage(scope);
    const socket = FakeWebSocket.instances[0];
    expect(socket).toBeDefined();
    socket?.open();

    socket?.receive({
      type: "TOOL_CALL",
      seq: 3,
      stream_id: "s",
      call_id: "c1",
      tool_name: "lookup",
      args: { query: "late" },
    });
    socket?.receive({
      type: "TOOL_CALL",
      seq: 3,
      stream_id: "s",
      call_id: "c1",
      tool_name: "lookup",
      args: { query: "duplicate" },
    });

    expect(sentOfType(socket as FakeWebSocket, "TOOL_ACK")).toEqual([
      { type: "TOOL_ACK", call_id: "c1" },
    ]);
    expect(workerEvents(posted, "tool_call")).toHaveLength(0);

    socket?.receive({ type: "TOKEN", seq: 1, stream_id: "s", text: "a" });
    socket?.receive({ type: "TOKEN", seq: 2, stream_id: "s", text: "b" });

    expect(workerEvents(posted, "tool_call").map((event) => event.call_id)).toEqual([
      "turn:1:attempt:1:call:c1",
    ]);
  });

  it("reconnects with RESUME(last_seq) and ignores replayed processed messages", async () => {
    const { posted, scope } = await loadWorker();

    sendUserMessage(scope);
    const firstSocket = FakeWebSocket.instances[0];
    expect(firstSocket).toBeDefined();
    firstSocket?.open();
    firstSocket?.receive({ type: "TOKEN", seq: 1, stream_id: "s", text: "hello" });

    firstSocket?.closeFromServer();
    expect(workerEvents(posted, "connection").map((event) => event.status)).toContain(
      "reconnecting",
    );

    await vi.advanceTimersByTimeAsync(500);
    const secondSocket = FakeWebSocket.instances[1];
    expect(secondSocket).toBeDefined();
    secondSocket?.open();

    expect(secondSocket?.sent[0]).toEqual({ type: "RESUME", last_seq: 1 });

    secondSocket?.receive({ type: "TOKEN", seq: 1, stream_id: "s", text: "hello" });
    secondSocket?.receive({ type: "TOKEN", seq: 2, stream_id: "s", text: " again" });

    expect(workerEvents(posted, "token").map((event) => event.seq)).toEqual([1, 2]);
  });

  it("does not send malformed PONGs for invalid or corrupt heartbeats", async () => {
    const { scope } = await loadWorker();

    sendUserMessage(scope);
    const socket = FakeWebSocket.instances[0];
    expect(socket).toBeDefined();
    socket?.open();

    socket?.receiveRaw("{");
    socket?.receiveRaw(JSON.stringify({ type: "PING", seq: 1 }));
    socket?.receiveRaw(JSON.stringify({ type: "PING", seq: 2, challenge: 42 }));

    expect(sentOfType(socket as FakeWebSocket, "PONG")).toEqual([]);

    socket?.receive({ type: "PING", seq: 3, challenge: "" });

    expect(sentOfType(socket as FakeWebSocket, "PONG")).toEqual([
      { type: "PONG", echo: "" },
    ]);
  });

  it("keeps active streams independent until each stream ends", async () => {
    const { posted, scope } = await loadWorker();

    sendUserMessage(scope);
    const socket = FakeWebSocket.instances[0];
    expect(socket).toBeDefined();
    socket?.open();

    socket?.receive({ type: "TOKEN", seq: 1, stream_id: "A", text: "a" });
    socket?.receive({ type: "TOKEN", seq: 2, stream_id: "B", text: "b" });
    socket?.receive({ type: "STREAM_END", seq: 3, stream_id: "A" });

    const statusesAfterAEnds = workerEvents(posted, "connection").map(
      (event) => event.status,
    );
    expect(statusesAfterAEnds.at(-1)).toBe("streaming");

    socket?.receive({ type: "TOKEN", seq: 4, stream_id: "B", text: "b2" });
    socket?.receive({ type: "STREAM_END", seq: 5, stream_id: "B" });

    expect(workerEvents(posted, "stream_end").map((event) => event.stream_id)).toEqual([
      "turn:1:attempt:1:stream:A",
      "turn:1:attempt:1:stream:B",
    ]);
    expect(workerEvents(posted, "connection").map((event) => event.status).at(-1)).toBe(
      "connected",
    );
  });

  it("emits an interrupted turn when an active stream stalls without STREAM_END", async () => {
    const { posted, scope } = await loadWorker();

    sendUserMessage(scope);
    const socket = FakeWebSocket.instances[0];
    expect(socket).toBeDefined();
    socket?.open();
    socket?.receive({ type: "TOKEN", seq: 1, stream_id: "s", text: "partial" });

    await vi.advanceTimersByTimeAsync(12_000);

    expect(workerEvents(posted, "turn_interrupted")).toHaveLength(1);
    expect(workerEvents(posted, "notification").at(-1)?.message).toBe(
      "Stream stalled without STREAM_END.",
    );
    expect(workerEvents(posted, "connection").map((event) => event.status).at(-1)).toBe(
      "connected",
    );
  });
});
