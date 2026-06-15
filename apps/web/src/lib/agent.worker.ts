import { serverMessageSchema } from "./protocol";
import { createSequenceGate } from "./sequence-gate";
import type { ServerMessage } from "../../../agent-server/src/types";
import type { ConnectionStatus, WorkerEvent } from "./worker-events";

type UiToWorker = { type: "send"; content: string };

let socket: WebSocket | undefined;
let queued: string | undefined;
let waitTimer: ReturnType<typeof setTimeout> | undefined;
let lastAppliedSeq = 0;
const sequenceGate = createSequenceGate();

const LATENCY_SPIKE_AFTER_MS = 2000;

const post = (message: WorkerEvent) => self.postMessage(message);
const setStatus = (status: ConnectionStatus) =>
  post({ kind: "connection", status });

const markActive = () => {
  setStatus("streaming");
  clearTimeout(waitTimer);
  // Chaos latency spikes pause delivery for at least 2s. This is only a stalled-stream hint; real disconnects come from WebSocket close/error.
  waitTimer = setTimeout(() => setStatus("waiting"), LATENCY_SPIKE_AFTER_MS);
};

const markConnected = () => {
  clearTimeout(waitTimer);
  setStatus("connected");
};

const parseServerMessage = (data: string): ServerMessage | null => {
  try {
    const result = serverMessageSchema.safeParse(JSON.parse(data));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
};

const applyMessage = (message: ServerMessage) => {
  switch (message.type) {
    case "TOKEN":
      markActive();
      post({ kind: "token", text: message.text });
      break;
    case "CONTEXT_SNAPSHOT":
      markActive();
      post({
        kind: "context",
        context_id: message.context_id,
        data: message.data,
      });
      break;
    case "TOOL_CALL":
      markActive();
      socket?.send(
        JSON.stringify({ type: "TOOL_ACK", call_id: message.call_id }),
      );
      post({
        kind: "tool_call",
        call_id: message.call_id,
        tool_name: message.tool_name,
        args: message.args,
      });
      break;
    case "TOOL_RESULT":
      markActive();
      post({
        kind: "tool_result",
        call_id: message.call_id,
        result: message.result,
      });
      break;
    case "PING":
      break;
    case "STREAM_END":
      markConnected();
      break;
    case "ERROR":
      break;
  }
};

const sendUserMessage = (content: string) => {
  sequenceGate.startTurn();
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
    const message = parseServerMessage(event.data);
    if (!message) return;

    // Heartbeats are liveness checks, so PING must be answered immediately.
    // If we wait for seq-order processing/replay buffering, an out-of-order PING can sit behind missing messages long enough for the server to drop us.
    if (message.type === "PING") {
      socket?.send(JSON.stringify({ type: "PONG", echo: message.challenge }));
    }

    for (const orderedMessage of sequenceGate.accept(message)) {
      applyMessage(orderedMessage);
      lastAppliedSeq = orderedMessage.seq;
    }
  };
};

self.onmessage = (event: MessageEvent<UiToWorker>) => {
  if (event.data.type === "send") sendUserMessage(event.data.content);
};
