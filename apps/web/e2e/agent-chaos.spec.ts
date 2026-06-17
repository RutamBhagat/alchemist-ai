import { expect, test, type Page } from "@playwright/test";

type ServerMessage =
  | { type: "TOKEN"; seq: number; stream_id: string; text: string }
  | {
      type: "TOOL_CALL";
      seq: number;
      stream_id: string;
      call_id: string;
      tool_name: string;
      args: Record<string, unknown>;
    }
  | {
      type: "TOOL_RESULT";
      seq: number;
      stream_id: string;
      call_id: string;
      result: Record<string, unknown>;
    }
  | { type: "STREAM_END"; seq: number; stream_id: string }
  | { type: "PING"; seq: number; challenge: string }
  | { type: "ERROR"; seq: number; code: string; message: string };

type SocketCommand =
  | { op: "receive"; message: ServerMessage; socketIndex?: number }
  | { op: "receiveRaw"; data: string; socketIndex?: number }
  | { op: "close"; socketIndex?: number };

type SocketEvent =
  | { kind: "__test_socket_opened"; socketIndex: number; url: string }
  | { kind: "__test_socket_sent"; socketIndex: number; payload: unknown };

declare global {
  interface Window {
    __agentTest?: {
      socketEvents: SocketEvent[];
      postToWorker: (command: SocketCommand) => void;
    };
  }
}

async function installControlledWorkerWebSocket(page: Page) {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    const socketEvents: SocketEvent[] = [];

    window.__agentTest = {
      socketEvents,
      postToWorker(command: SocketCommand) {
        throw new Error(`Worker is not ready for ${command.op}`);
      },
    };

    window.Worker = class ControlledWorker extends NativeWorker {
      constructor(scriptURL: string | URL, options?: WorkerOptions) {
        super(scriptURL, options);
        window.__agentTest!.postToWorker = (command: SocketCommand) => {
          this.postMessage({ __testWebSocket: command });
        };
        this.addEventListener("message", (event) => {
          const data = event.data as SocketEvent | unknown;
          if (
            typeof data === "object" &&
            data !== null &&
            "kind" in data &&
            (data.kind === "__test_socket_opened" || data.kind === "__test_socket_sent")
          ) {
            socketEvents.push(data as SocketEvent);
          }
        });
      }
    };
  });

  await page.route("**/*", async (route) => {
    const response = await route.fetch();
    const contentType = response.headers()["content-type"] ?? "";

    if (!contentType.includes("javascript")) {
      await route.fulfill({ response });
      return;
    }

    const body = await response.text();
    if (!body.includes("ws://localhost:4747/ws")) {
      await route.fulfill({ response, body });
      return;
    }

    await route.fulfill({
      response,
      body: `${controlledWebSocketShim()}\n${body}`,
    });
  });
}

function controlledWebSocketShim() {
  return `
(() => {
  const sockets = [];

  class ControlledWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    constructor(url) {
      this.url = url;
      this.readyState = ControlledWebSocket.CONNECTING;
      this.onclose = null;
      this.onerror = null;
      this.onmessage = null;
      this.onopen = null;
      this.sent = [];
      this.socketIndex = sockets.length;
      sockets.push(this);
      self.postMessage({
        kind: "__test_socket_opened",
        socketIndex: this.socketIndex,
        url,
      });
      queueMicrotask(() => this.__open());
    }

    close() {
      this.readyState = ControlledWebSocket.CLOSED;
    }

    send(payload) {
      const parsed = JSON.parse(payload);
      this.sent.push(parsed);
      self.postMessage({
        kind: "__test_socket_sent",
        socketIndex: this.socketIndex,
        payload: parsed,
      });
    }

    __open() {
      if (this.readyState !== ControlledWebSocket.CONNECTING) return;
      this.readyState = ControlledWebSocket.OPEN;
      this.onopen?.();
    }

    __receive(message) {
      if (this.readyState !== ControlledWebSocket.OPEN) return;
      this.onmessage?.({ data: JSON.stringify(message) });
    }

    __receiveRaw(data) {
      if (this.readyState !== ControlledWebSocket.OPEN) return;
      this.onmessage?.({ data });
    }

    __closeFromServer() {
      if (this.readyState === ControlledWebSocket.CLOSED) return;
      this.readyState = ControlledWebSocket.CLOSED;
      this.onclose?.();
    }
  }

  self.WebSocket = ControlledWebSocket;
  self.addEventListener("message", (event) => {
    const command = event.data?.__testWebSocket;
    if (!command) return;

    const socket = sockets[command.socketIndex ?? sockets.length - 1];
    if (!socket) return;

    if (command.op === "receive") socket.__receive(command.message);
    if (command.op === "receiveRaw") socket.__receiveRaw(command.data);
    if (command.op === "close") socket.__closeFromServer();
  });
})();`;
}

async function sendPrompt(page: Page, content = "run tool") {
  await page.getByRole("textbox").fill(content);
  await page.getByRole("textbox").press("Enter");
  await waitForSent(page, "USER_MESSAGE");
}

async function receive(page: Page, message: ServerMessage, socketIndex?: number) {
  await page.evaluate(
    ({ message, socketIndex }) => {
      window.__agentTest!.postToWorker({ op: "receive", message, socketIndex });
    },
    { message, socketIndex },
  );
}

async function receiveRaw(page: Page, data: string, socketIndex?: number) {
  await page.evaluate(
    ({ data, socketIndex }) => {
      window.__agentTest!.postToWorker({ op: "receiveRaw", data, socketIndex });
    },
    { data, socketIndex },
  );
}

async function closeSocket(page: Page, socketIndex?: number) {
  await page.evaluate((socketIndex) => {
    window.__agentTest!.postToWorker({ op: "close", socketIndex });
  }, socketIndex);
}

async function socketEvents(page: Page) {
  return page.evaluate(() => window.__agentTest?.socketEvents ?? []);
}

async function sentMessages(page: Page, type?: string) {
  const events = await socketEvents(page);
  return events
    .filter((event): event is Extract<SocketEvent, { kind: "__test_socket_sent" }> =>
      event.kind === "__test_socket_sent",
    )
    .map((event) => event.payload)
    .filter((payload) => {
      if (!type) return true;
      return (
        typeof payload === "object" &&
        payload !== null &&
        "type" in payload &&
        payload.type === type
      );
    });
}

async function waitForSent(page: Page, type: string) {
  await expect
    .poll(async () => sentMessages(page, type), { timeout: 5_000 })
    .toHaveLength(1);
}

test.beforeEach(async ({ page }) => {
  await installControlledWorkerWebSocket(page);
  await page.goto("http://127.0.0.1:3001/");
});

test("recovers when the socket drops after a tool call but before its result", async ({ page }) => {
  await sendPrompt(page);

  await receive(page, { type: "TOKEN", seq: 1, stream_id: "s", text: "Checking " });
  await receive(page, {
    type: "TOOL_CALL",
    seq: 2,
    stream_id: "s",
    call_id: "c1",
    tool_name: "lookup",
    args: { query: "x" },
  });

  await expect(page.getByText("Checking")).toBeVisible();
  await expect(page.getByText("lookup")).toBeVisible();
  await expect
    .poll(async () => sentMessages(page, "TOOL_ACK"), { timeout: 2_000 })
    .toEqual([{ type: "TOOL_ACK", call_id: "c1" }]);

  await closeSocket(page);
  await expect
    .poll(async () => sentMessages(page, "RESUME"), { timeout: 2_000 })
    .toEqual([{ type: "RESUME", last_seq: 2 }]);

  await receive(page, {
    type: "TOOL_CALL",
    seq: 2,
    stream_id: "s",
    call_id: "c1",
    tool_name: "lookup",
    args: { query: "replayed" },
  });
  await receive(page, {
    type: "TOOL_RESULT",
    seq: 3,
    stream_id: "s",
    call_id: "c1",
    result: { ok: true },
  });
  await receive(page, { type: "STREAM_END", seq: 4, stream_id: "s" });

  await expect(page.getByText(/ok/i)).toBeVisible();
  await expect(page.getByText("lookup")).toHaveCount(1);
  expect(await sentMessages(page, "TOOL_ACK")).toEqual([
    { type: "TOOL_ACK", call_id: "c1" },
  ]);
});

test("handles delayed response, corrupt frames, and out-of-order replay without corrupting the DOM", async ({ page }) => {
  await sendPrompt(page, "slow response");

  await receive(page, { type: "TOKEN", seq: 3, stream_id: "s", text: "third" });
  await receiveRaw(page, "not-json");
  await receiveRaw(page, JSON.stringify({ type: "TOKEN", seq: 2, text: "missing stream" }));
  await receive(page, { type: "TOKEN", seq: 1, stream_id: "s", text: "first" });

  await expect(page.getByText("first")).toBeVisible();
  await expect(page.getByText("third")).not.toBeVisible();

  await receive(page, { type: "TOKEN", seq: 2, stream_id: "s", text: "second" });
  await expect(page.getByText("firstsecondthird")).toBeVisible();

  await receive(page, { type: "PING", seq: 99, challenge: "" });
  await expect
    .poll(async () => sentMessages(page, "PONG"), { timeout: 1_000 })
    .toEqual([{ type: "PONG", echo: "" }]);
});
