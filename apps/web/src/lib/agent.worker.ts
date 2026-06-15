import { trace, traceOut } from "./agent-trace";
import { serverMessageSchema } from "./protocol";
import { createSequenceGate } from "./sequence-gate";
import type { ServerMessage } from "../../../agent-server/src/types";

type UiToWorker = { type: "send"; content: string };
type Timer = ReturnType<typeof setTimeout>;
type WorkerState = {
  socket?: WebSocket;
  queued?: string;
  waitTimer?: Timer;
  idleTimer?: Timer;
  resumeTimer?: Timer;
  reconnectTimer?: Timer;
  reconnectDelayMs: number;
  lastAppliedSeq: number;
  streamEndSeq: number | null;
  turnActive: boolean;
  ackedToolCalls: Set<string>;
  answeredPingSeqs: Set<number>;
  sequenceGate: ReturnType<typeof createSequenceGate>;
};

const state: WorkerState = {
  reconnectDelayMs: 500,
  lastAppliedSeq: 0,
  streamEndSeq: null,
  turnActive: false,
  ackedToolCalls: new Set(),
  answeredPingSeqs: new Set(),
  sequenceGate: createSequenceGate(),
};

const LATENCY_SPIKE_AFTER_MS = 2000;
const MAX_RECONNECT_AFTER_MS = 10000;
const RESUME_WHEN_STALLED_MS = 1500;
const MISSING_STREAM_END_AFTER_MS = 8000;

function markActive() {
  self.postMessage({ kind: "connection", status: "streaming" });
  clearTimeout(state.waitTimer);
  clearTimeout(state.idleTimer);
  // Chaos latency spikes pause delivery for at least 2s. This is only a stalled-stream hint; real disconnects come from WebSocket close/error.
  state.waitTimer = setTimeout(
    () => self.postMessage({ kind: "connection", status: "waiting" }),
    LATENCY_SPIKE_AFTER_MS,
  );
  state.idleTimer = setTimeout(markConnected, MISSING_STREAM_END_AFTER_MS);
}

function scheduleResume() {
  if (!state.turnActive || state.streamEndSeq !== null) {
    return;
  }
  clearTimeout(state.resumeTimer);
  state.resumeTimer = setTimeout(() => {
    if (!state.turnActive || state.streamEndSeq !== null) {
      return;
    }
    if (state.socket?.readyState !== WebSocket.OPEN) {
      return;
    }
    state.socket.send(
      JSON.stringify({ type: "RESUME", last_seq: state.lastAppliedSeq }),
    );
    scheduleResume();
  }, RESUME_WHEN_STALLED_MS);
}

function markConnected() {
  clearTimeout(state.waitTimer);
  clearTimeout(state.idleTimer);
  clearTimeout(state.resumeTimer);
  clearTimeout(state.reconnectTimer);
  state.reconnectDelayMs = 500;
  self.postMessage({ kind: "connection", status: "connected" });
}

function parseServerMessage(data: string): ServerMessage | null {
  try {
    const result = serverMessageSchema.safeParse(JSON.parse(data));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

function sendTurn(content: string) {
  state.socket?.send(JSON.stringify({ type: "USER_MESSAGE", content }));
  traceOut("USER_MESSAGE", content);
  scheduleResume();
}

function resumeTurn() {
  state.socket?.send(
    JSON.stringify({ type: "RESUME", last_seq: state.lastAppliedSeq }),
  );
  traceOut("RESUME", `last_seq ${state.lastAppliedSeq}`);
  scheduleResume();
}

function applyMessage(message: ServerMessage) {
  switch (message.type) {
    case "TOKEN":
      markActive();
      self.postMessage({ kind: "token", text: message.text });
      break;
    case "CONTEXT_SNAPSHOT":
      markActive();
      self.postMessage({
        kind: "context",
        context_id: message.context_id,
        data: message.data,
      });
      break;
    case "TOOL_CALL":
      markActive();
      self.postMessage({
        kind: "tool_call",
        call_id: message.call_id,
        tool_name: message.tool_name,
        args: message.args,
      });
      break;
    case "TOOL_RESULT":
      markActive();
      self.postMessage({
        kind: "tool_result",
        call_id: message.call_id,
        result: message.result,
      });
      break;
    case "PING":
      break;
    case "STREAM_END":
      state.turnActive = false;
      markConnected();
      break;
    case "ERROR":
      break;
  }
}

function connect(resume: boolean) {
  const previousSocket = state.socket;
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

  self.postMessage({ kind: "connection", status: "connecting" });
  const currentSocket = new WebSocket("ws://localhost:4747/ws");
  state.socket = currentSocket;
  currentSocket.onopen = () => {
    if (state.socket !== currentSocket) {
      return;
    }
    markConnected();
    if (resume) {
      resumeTurn();
      return;
    }
    const queued = state.queued;
    if (!queued) {
      return;
    }
    sendTurn(queued);
    state.queued = undefined;
  };
  currentSocket.onclose = () => {
    if (state.socket !== currentSocket) {
      return;
    }
    clearTimeout(state.waitTimer);
    clearTimeout(state.idleTimer);
    clearTimeout(state.resumeTimer);
    if (state.turnActive) {
      scheduleReconnect();
    }
    self.postMessage({ kind: "connection", status: "disconnected" });
  };
  currentSocket.onerror = () => {
    if (state.socket !== currentSocket) {
      return;
    }
    clearTimeout(state.waitTimer);
    clearTimeout(state.idleTimer);
    clearTimeout(state.resumeTimer);
    if (state.turnActive) {
      scheduleReconnect();
    }
    self.postMessage({ kind: "connection", status: "disconnected" });
  };
  currentSocket.onmessage = (event: MessageEvent<string>) => {
    if (state.socket !== currentSocket) {
      return;
    }
    const receivedAt = performance.now();
    const message = parseServerMessage(event.data);
    if (!message) {
      return;
    }

    if (message.type === "STREAM_END") {
      state.streamEndSeq = message.seq;
      clearTimeout(state.resumeTimer);
      if (message.seq > state.lastAppliedSeq + 1) {
        resumeTurn();
      }
    }

    // Heartbeats are liveness checks, so PING must be answered immediately.
    // If we wait for seq-order processing/replay buffering, an out-of-order PING can sit behind missing messages long enough for the server to drop us.
    if (message.type === "PING" && !state.answeredPingSeqs.has(message.seq)) {
      state.answeredPingSeqs.add(message.seq);
      trace(message, receivedAt);
      currentSocket.send(JSON.stringify({ type: "PONG", echo: message.challenge }));
      traceOut("PONG", `echo ${message.challenge || "(empty)"}`);
    }
    if (message.type === "TOOL_CALL" && !state.ackedToolCalls.has(message.call_id)) {
      state.ackedToolCalls.add(message.call_id);
      currentSocket.send(
        JSON.stringify({ type: "TOOL_ACK", call_id: message.call_id }),
      );
      traceOut("TOOL_ACK", message.call_id, message.call_id);
    }

    for (const orderedMessage of state.sequenceGate.accept(message)) {
      if (orderedMessage.type !== "PING") {
        trace(orderedMessage, receivedAt);
      }
      applyMessage(orderedMessage);
      if (orderedMessage.type !== "PING") {
        state.lastAppliedSeq = orderedMessage.seq;
      }
      if (orderedMessage.type !== "PING" && orderedMessage.type !== "STREAM_END") {
        scheduleResume();
      }
    }
  };
}

function scheduleReconnect() {
  clearTimeout(state.reconnectTimer);
  self.postMessage({ kind: "connection", status: "reconnecting" });
  state.reconnectTimer = setTimeout(
    () => connect(state.queued === undefined),
    state.reconnectDelayMs,
  );
  state.reconnectDelayMs = Math.min(
    state.reconnectDelayMs * 2,
    MAX_RECONNECT_AFTER_MS,
  );
}

function startTurn() {
  state.sequenceGate.startTurn();
  state.ackedToolCalls.clear();
  state.answeredPingSeqs.clear();
  state.reconnectDelayMs = 500;
  state.lastAppliedSeq = 0;
  state.streamEndSeq = null;
  state.turnActive = true;
}

function sendUserMessage(content: string) {
  clearTimeout(state.reconnectTimer);
  startTurn();
  if (state.socket?.readyState === WebSocket.OPEN) {
    sendTurn(content);
    return;
  }

  state.queued = content;
  if (state.socket?.readyState === WebSocket.CONNECTING) {
    return;
  }
  connect(false);
}

self.onmessage = (event: MessageEvent<UiToWorker>) => {
  if (event.data.type === "send") {
    sendUserMessage(event.data.content);
  }
};
