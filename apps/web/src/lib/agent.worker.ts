import { serverMessageSchema } from "./protocol";
import { createSequenceGate } from "./sequence-gate";
import type { ServerMessage } from "../../../agent-server/src/types";
import type { ConnectionStatus, WorkerEvent } from "./worker-events";

type UiToWorker = { type: "send"; content: string };

let socket: WebSocket | undefined;
let queued: string | undefined;
let waitTimer: ReturnType<typeof setTimeout> | undefined;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let resumeTimer: ReturnType<typeof setTimeout> | undefined;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let reconnectDelayMs = 500;
let lastAppliedSeq = 0;
let streamEndSeq: number | null = null;
let turnActive = false;
let traceId = 0;
const ackedToolCalls = new Set<string>();
const answeredPingSeqs = new Set<number>();
const sequenceGate = createSequenceGate();

const LATENCY_SPIKE_AFTER_MS = 2000;
const MAX_RECONNECT_AFTER_MS = 10000;
const RESUME_WHEN_STALLED_MS = 1500;
const MISSING_STREAM_END_AFTER_MS = 8000;

const post = (message: WorkerEvent) => self.postMessage(message);
const trace = (
  message: ServerMessage,
  at: number,
  label = "text" in message ? message.text : message.type,
) =>
  post({
    kind: "trace",
    id: ++traceId,
    at,
    direction: "in",
    type: message.type,
    seq: message.seq,
    stream_id: "stream_id" in message ? message.stream_id : undefined,
    call_id: "call_id" in message ? message.call_id : undefined,
    text: "text" in message ? message.text : undefined,
    label,
  });
const traceOut = (
  type: "PONG" | "TOOL_ACK" | "USER_MESSAGE" | "RESUME",
  label: string,
  call_id?: string,
) =>
  post({
    kind: "trace",
    id: ++traceId,
    at: performance.now(),
    direction: "out",
    type,
    call_id,
    label,
  });
const setStatus = (status: ConnectionStatus) => {
  post({ kind: "connection", status });
};

const markActive = () => {
  setStatus("streaming");
  clearTimeout(waitTimer);
  clearTimeout(idleTimer);
  // Chaos latency spikes pause delivery for at least 2s. This is only a stalled-stream hint; real disconnects come from WebSocket close/error.
  waitTimer = setTimeout(() => setStatus("waiting"), LATENCY_SPIKE_AFTER_MS);
  idleTimer = setTimeout(markConnected, MISSING_STREAM_END_AFTER_MS);
};

const clearResumeTimer = () => clearTimeout(resumeTimer);
const clearReconnectTimer = () => clearTimeout(reconnectTimer);

const scheduleResume = () => {
  if (!turnActive || streamEndSeq !== null) return;
  clearResumeTimer();
  resumeTimer = setTimeout(() => {
    if (!turnActive || streamEndSeq !== null) return;
    if (socket?.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type: "RESUME", last_seq: lastAppliedSeq }));
    scheduleResume();
  }, RESUME_WHEN_STALLED_MS);
};

const markConnected = () => {
  clearTimeout(waitTimer);
  clearTimeout(idleTimer);
  clearResumeTimer();
  clearReconnectTimer();
  reconnectDelayMs = 500;
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

const sendTurn = (content: string) => {
  socket?.send(JSON.stringify({ type: "USER_MESSAGE", content }));
  traceOut("USER_MESSAGE", content);
  scheduleResume();
};

const resumeTurn = () => {
  socket?.send(JSON.stringify({ type: "RESUME", last_seq: lastAppliedSeq }));
  traceOut("RESUME", `last_seq ${lastAppliedSeq}`);
  scheduleResume();
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
      turnActive = false;
      markConnected();
      break;
    case "ERROR":
      break;
  }
};

const connect = (resume: boolean) => {
  const previousSocket = socket;
  if (
    previousSocket &&
    previousSocket.readyState !== WebSocket.CLOSING &&
    previousSocket.readyState !== WebSocket.CLOSED
  ) {
    previousSocket.onopen = null;
    previousSocket.onclose = null;
    previousSocket.onerror = null;
    previousSocket.onmessage = null;
    previousSocket.close();
  }

  setStatus("connecting");
  const currentSocket = new WebSocket("ws://localhost:4747/ws");
  socket = currentSocket;
  currentSocket.onopen = () => {
    if (socket !== currentSocket) return;
    markConnected();
    if (resume) {
      resumeTurn();
      return;
    }
    if (!queued) return;
    sendTurn(queued);
    queued = undefined;
  };
  currentSocket.onclose = () => {
    if (socket !== currentSocket) return;
    clearTimeout(waitTimer);
    clearTimeout(idleTimer);
    clearResumeTimer();
    if (turnActive) scheduleReconnect();
    setStatus("disconnected");
  };
  currentSocket.onerror = () => {
    if (socket !== currentSocket) return;
    clearTimeout(waitTimer);
    clearTimeout(idleTimer);
    clearResumeTimer();
    if (turnActive) scheduleReconnect();
    setStatus("disconnected");
  };
  currentSocket.onmessage = (event: MessageEvent<string>) => {
    if (socket !== currentSocket) return;
    const receivedAt = performance.now();
    const message = parseServerMessage(event.data);
    if (!message) return;

    if (message.type === "STREAM_END") {
      streamEndSeq = message.seq;
      clearResumeTimer();
      if (message.seq > lastAppliedSeq + 1) resumeTurn();
    }

    // Heartbeats are liveness checks, so PING must be answered immediately.
    // If we wait for seq-order processing/replay buffering, an out-of-order PING can sit behind missing messages long enough for the server to drop us.
    if (message.type === "PING" && !answeredPingSeqs.has(message.seq)) {
      answeredPingSeqs.add(message.seq);
      trace(message, receivedAt);
      currentSocket.send(JSON.stringify({ type: "PONG", echo: message.challenge }));
      traceOut("PONG", `echo ${message.challenge || "(empty)"}`);
    }
    if (message.type === "TOOL_CALL" && !ackedToolCalls.has(message.call_id)) {
      ackedToolCalls.add(message.call_id);
      currentSocket.send(
        JSON.stringify({ type: "TOOL_ACK", call_id: message.call_id }),
      );
      traceOut("TOOL_ACK", message.call_id, message.call_id);
    }

    for (const orderedMessage of sequenceGate.accept(message)) {
      if (orderedMessage.type !== "PING") trace(orderedMessage, receivedAt);
      applyMessage(orderedMessage);
      if (orderedMessage.type !== "PING") {
        lastAppliedSeq = orderedMessage.seq;
      }
      if (orderedMessage.type !== "PING" && orderedMessage.type !== "STREAM_END") {
        scheduleResume();
      }
    }
  };
};

const scheduleReconnect = () => {
  clearReconnectTimer();
  setStatus("reconnecting");
  reconnectTimer = setTimeout(() => connect(queued === undefined), reconnectDelayMs);
  reconnectDelayMs = Math.min(reconnectDelayMs * 2, MAX_RECONNECT_AFTER_MS);
};

const sendUserMessage = (content: string) => {
  clearReconnectTimer();
  sequenceGate.startTurn();
  ackedToolCalls.clear();
  answeredPingSeqs.clear();
  reconnectDelayMs = 500;
  lastAppliedSeq = 0;
  streamEndSeq = null;
  turnActive = true;
  if (socket?.readyState === WebSocket.OPEN) {
    sendTurn(content);
    return;
  }

  queued = content;
  if (socket?.readyState === WebSocket.CONNECTING) return;
  connect(false);
};

self.onmessage = (event: MessageEvent<UiToWorker>) => {
  if (event.data.type === "send") sendUserMessage(event.data.content);
};
