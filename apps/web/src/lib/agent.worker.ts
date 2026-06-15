import { serverMessageSchema } from "./protocol";
import type { ConnectionStatus, WorkerEvent } from "./worker-events";

type UiToWorker = { type: "send"; content: string };

let socket: WebSocket | undefined;
let queued: string | undefined;
let waitTimer: ReturnType<typeof setTimeout> | undefined;

const LATENCY_SPIKE_AFTER_MS = 2000;

const post = (message: WorkerEvent) => self.postMessage(message);
const setStatus = (status: ConnectionStatus) => post({ kind: "connection", status });

const markActive = () => {
  setStatus("streaming");
  clearTimeout(waitTimer);
  // Chaos latency spikes pause delivery for at least 2s. This is only a
  // stalled-stream hint; real disconnects come from WebSocket close/error.
  waitTimer = setTimeout(() => setStatus("waiting"), LATENCY_SPIKE_AFTER_MS);
};

const markConnected = () => {
  clearTimeout(waitTimer);
  setStatus("connected");
};

const sendUserMessage = (content: string) => {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "USER_MESSAGE", content }));
    return;
  }

  queued = content;
  setStatus("connecting");
  socket = new WebSocket("ws://localhost:4747/ws");
  socket.onopen = () => {
    markConnected();
    if (!queued) return;
    socket?.send(JSON.stringify({ type: "USER_MESSAGE", content: queued }));
    queued = undefined;
  };
  socket.onclose = () => {
    clearTimeout(waitTimer);
    setStatus("disconnected");
  };
  socket.onerror = () => {
    clearTimeout(waitTimer);
    setStatus("disconnected");
  };
  socket.onmessage = (event: MessageEvent<string>) => {
    const result = serverMessageSchema.safeParse(JSON.parse(event.data));
    if (!result.success) return;

    // Heartbeats are liveness checks, so PING must be answered immediately.
    // If we wait for seq-order processing/replay buffering, an out-of-order
    // PING can sit behind missing messages long enough for the server to drop us.
    if (result.data.type === "PING") {
      socket?.send(JSON.stringify({ type: "PONG", echo: result.data.challenge }));
    }

    switch (result.data.type) {
      case "TOKEN":
        markActive();
        post({ kind: "token", text: result.data.text });
        break;
      case "CONTEXT_SNAPSHOT":
        markActive();
        post({
          kind: "context",
          context_id: result.data.context_id,
          data: result.data.data,
        });
        break;
      case "TOOL_CALL":
        markActive();
        socket?.send(JSON.stringify({ type: "TOOL_ACK", call_id: result.data.call_id }));
        post({
          kind: "tool_call",
          call_id: result.data.call_id,
          tool_name: result.data.tool_name,
          args: result.data.args,
        });
        break;
      case "TOOL_RESULT":
        markActive();
        post({
          kind: "tool_result",
          call_id: result.data.call_id,
          result: result.data.result,
        });
        break;
      case "STREAM_END":
        markConnected();
        break;
    }
  };
};

self.onmessage = (event: MessageEvent<UiToWorker>) => {
  if (event.data.type === "send") sendUserMessage(event.data.content);
};
