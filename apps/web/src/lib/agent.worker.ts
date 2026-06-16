import { trace, traceOut } from "./agent-trace";
import { serverMessageSchema } from "./protocol";
import { createSequenceGate } from "./sequence-gate";
import type { ServerMessage, TokenMessage } from "../../../agent-server/src/types";

type UiToWorker = { type: "send"; content: string };
type Timer = ReturnType<typeof setTimeout>;
type WorkerState = {
  socket?: WebSocket;
  queued?: string;
  waitTimer?: Timer;
  resumeStallTimer?: Timer;
  streamIdleTimer?: Timer;
  reconnectTimer?: Timer;
  reconnectDelayMs: number;
  lastAppliedSeq: number;
  textTargetsByStreamId: Map<string, string>;
  textTargetIdsByStreamId: Map<string, number>;
  userTarget: string | null;
  userTargetId: number;
  turnActive: boolean;
  ackedToolCalls: Set<string>;
  answeredPingSeqs: Set<number>;
  sequenceGate: ReturnType<typeof createSequenceGate>;
};

const state: WorkerState = {
  reconnectDelayMs: 500,
  lastAppliedSeq: 0,
  textTargetsByStreamId: new Map(),
  textTargetIdsByStreamId: new Map(),
  userTarget: null,
  userTargetId: 0,
  turnActive: false,
  ackedToolCalls: new Set(),
  answeredPingSeqs: new Set(),
  sequenceGate: createSequenceGate(),
};

const LATENCY_SPIKE_AFTER_MS = 2000;
const RESUME_STALL_AFTER_MS = 4000;
const STREAM_IDLE_INTERRUPT_AFTER_MS = 12000;
const MAX_RECONNECT_AFTER_MS = 10000;

function markActive() {
  self.postMessage({ kind: "connection", status: "streaming" });
  clearTimeout(state.waitTimer);
  scheduleStreamIdleCheck();
  state.waitTimer = setTimeout(() => {
    if (state.turnActive) self.postMessage({ kind: "connection", status: "waiting" });
  }, LATENCY_SPIKE_AFTER_MS);
}

function markConnected() {
  clearTimeout(state.waitTimer);
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
  traceOut("USER_MESSAGE", content, undefined, state.userTarget ?? undefined);
  scheduleStreamIdleCheck();
}

function resumeTurn() {
  state.socket?.send(JSON.stringify({ type: "RESUME", last_seq: state.lastAppliedSeq }));
  traceOut("RESUME", `last_seq ${state.lastAppliedSeq}`);
}

function clearResumeStallCheck() {
  clearTimeout(state.resumeStallTimer);
  state.resumeStallTimer = undefined;
}

function clearStreamIdleCheck() {
  clearTimeout(state.streamIdleTimer);
  state.streamIdleTimer = undefined;
}

function interruptTurn(message: string) {
  state.turnActive = false;
  clearResumeStallCheck();
  clearStreamIdleCheck();
  self.postMessage({ kind: "notification", type: "error", message });
  self.postMessage({ kind: "turn_interrupted" });
  markConnected();
}

function scheduleInterruptionCheck() {
  clearTimeout(state.resumeStallTimer);
  state.resumeStallTimer = setTimeout(() => {
    if (state.turnActive) interruptTurn("Stream interrupted during recovery.");
  }, RESUME_STALL_AFTER_MS);
}

function scheduleStreamIdleCheck() {
  clearTimeout(state.streamIdleTimer);
  state.streamIdleTimer = setTimeout(() => {
    if (state.turnActive) interruptTurn("Stream stalled without STREAM_END.");
  }, STREAM_IDLE_INTERRUPT_AFTER_MS);
}

function textTarget(streamId: string) {
  const existing = state.textTargetsByStreamId.get(streamId);
  if (existing) return existing;

  const nextId = (state.textTargetIdsByStreamId.get(streamId) ?? 0) + 1;
  state.textTargetIdsByStreamId.set(streamId, nextId);

  const target = `stream:${streamId}:text:${nextId}`;
  state.textTargetsByStreamId.set(streamId, target);
  return target;
}

function clearTextTarget(streamId: string) {
  state.textTargetsByStreamId.delete(streamId);
}

function applyToken(message: TokenMessage) {
  const target = textTarget(message.stream_id);
  self.postMessage({
    kind: "token",
    seq: message.seq,
    stream_id: message.stream_id,
    text: message.text,
    target,
  });
  return target;
}

function applyMessage(message: ServerMessage) {
  switch (message.type) {
    case "TOKEN":
      markActive();
      return applyToken(message);
    case "CONTEXT_SNAPSHOT":
      markActive();
      self.postMessage({ kind: "context", context_id: message.context_id, data: message.data });
      break;
    case "TOOL_CALL":
      markActive();
      self.postMessage({
        kind: "tool_call",
        seq: message.seq,
        stream_id: message.stream_id,
        call_id: message.call_id,
        tool_name: message.tool_name,
        args: message.args,
      });
      clearTextTarget(message.stream_id);
      break;
    case "TOOL_RESULT":
      markActive();
      self.postMessage({
        kind: "tool_result",
        seq: message.seq,
        stream_id: message.stream_id,
        call_id: message.call_id,
        result: message.result,
      });
      break;
    case "PING":
      break;
    case "STREAM_END":
      self.postMessage({ kind: "stream_end", seq: message.seq, stream_id: message.stream_id });
      clearTextTarget(message.stream_id);
      state.turnActive = false;
      clearResumeStallCheck();
      clearStreamIdleCheck();
      markConnected();
      break;
    case "ERROR":
      self.postMessage({ kind: "notification", type: "error", message: message.message });
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
    if (state.socket !== currentSocket) return;
    markConnected();
    if (resume) {
      resumeTurn();
      scheduleInterruptionCheck();
      return;
    }
    const queued = state.queued;
    if (!queued) return;
    sendTurn(queued);
    state.queued = undefined;
  };

  function disconnected() {
    if (state.socket !== currentSocket) return;
    currentSocket.onclose = null;
    currentSocket.onerror = null;
    clearTimeout(state.waitTimer);
    clearResumeStallCheck();
    clearStreamIdleCheck();
    if (state.turnActive) scheduleReconnect();
    else self.postMessage({ kind: "connection", status: "disconnected" });
    self.postMessage({ kind: "notification", type: "error", message: "Connection lost." });
  }

  currentSocket.onclose = disconnected;
  currentSocket.onerror = disconnected;
  currentSocket.onmessage = (event: MessageEvent<string>) => {
    if (state.socket !== currentSocket) return;
    const receivedAt = performance.now();
    const message = parseServerMessage(event.data);
    if (!message) return;

    if (message.type === "PING" && !state.answeredPingSeqs.has(message.seq)) {
      state.answeredPingSeqs.add(message.seq);
      trace(message, receivedAt);
      currentSocket.send(JSON.stringify({ type: "PONG", echo: message.challenge }));
      traceOut("PONG", `echo ${message.challenge || "(empty)"}`);
    }

    if (message.type === "TOOL_CALL" && !state.ackedToolCalls.has(message.call_id)) {
      state.ackedToolCalls.add(message.call_id);
      currentSocket.send(JSON.stringify({ type: "TOOL_ACK", call_id: message.call_id }));
      traceOut("TOOL_ACK", message.call_id, message.call_id);
    }

    for (const orderedMessage of state.sequenceGate.accept(message)) {
      if (orderedMessage.type !== "PING" && orderedMessage.type !== "TOKEN") {
        trace(orderedMessage, receivedAt);
      }
      const target = applyMessage(orderedMessage);
      if (orderedMessage.type === "TOKEN" && target) {
        trace(orderedMessage, receivedAt, orderedMessage.text, target);
      }
      if (orderedMessage.type !== "PING") {
        state.lastAppliedSeq = orderedMessage.seq;
        if (orderedMessage.type !== "STREAM_END" && state.resumeStallTimer) {
          scheduleInterruptionCheck();
        }
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
  state.reconnectDelayMs = Math.min(state.reconnectDelayMs * 2, MAX_RECONNECT_AFTER_MS);
}

function startTurn() {
  clearResumeStallCheck();
  clearStreamIdleCheck();
  state.sequenceGate.startTurn();
  state.ackedToolCalls.clear();
  state.answeredPingSeqs.clear();
  state.reconnectDelayMs = 500;
  state.lastAppliedSeq = 0;
  state.textTargetsByStreamId.clear();
  state.textTargetIdsByStreamId.clear();
  state.userTarget = `user:${++state.userTargetId}`;
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
  if (state.socket?.readyState === WebSocket.CONNECTING) return;
  connect(false);
}

self.onmessage = (event: MessageEvent<UiToWorker>) => {
  if (event.data.type === "send") sendUserMessage(event.data.content);
};
