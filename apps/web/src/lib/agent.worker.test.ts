import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServerMessage } from "../../../agent-server/src/types";
import type { WorkerEvent } from "./worker-events";

type UiToWorker =
  | { type: "send"; content: string; turnId: string; attemptId: string }
  | { type: "tool_rendered"; client_call_id: string };

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

  await import("./agent.worker");

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

function confirmToolRendered(scope: FakeWorkerGlobal, clientCallId: string) {
  scope.onmessage?.({
    data: { type: "tool_rendered", client_call_id: clientCallId },
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

  it("ACKs TOOL_CALL after ordered UI render confirmation and dedupes by call_id", async () => {
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

    expect(sentOfType(socket as FakeWebSocket, "TOOL_ACK")).toEqual([]);
    expect(workerEvents(posted, "tool_call")).toHaveLength(0);

    socket?.receive({ type: "TOKEN", seq: 1, stream_id: "s", text: "a" });
    socket?.receive({ type: "TOKEN", seq: 2, stream_id: "s", text: "b" });

    const clientCallId = "turn:1:attempt:1:call:c1";
    expect(workerEvents(posted, "tool_call").map((event) => event.call_id)).toEqual([
      clientCallId,
    ]);

    confirmToolRendered(scope, clientCallId);
    confirmToolRendered(scope, clientCallId);

    expect(sentOfType(socket as FakeWebSocket, "TOOL_ACK")).toEqual([
      { type: "TOOL_ACK", call_id: "c1" },
    ]);
  });
});
