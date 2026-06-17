import { trace, traceOut } from "./agent-trace";
import { serverMessageSchema } from "./protocol";
import { createSequenceGate } from "./sequence-gate";
import type { ServerMessage, TokenMessage } from "../../../agent-server/src/types";
import type { AttemptId, TurnId } from "./worker-events";

type UiToWorker =
  | {
      type: "send";
      content: string;
      turnId: TurnId;
      attemptId: AttemptId;
    }
  | {
      type: "tool_rendered";
      client_call_id: string;
    };
type QueuedTurn = { content: string; turnId: TurnId; attemptId: AttemptId };
type Timer = ReturnType<typeof setTimeout>;
type WorkerState = {
  socket?: WebSocket;
  queued?: QueuedTurn;
  waitTimer?: Timer;
  resumeStallTimer?: Timer;
  streamIdleTimer?: Timer;
  reconnectTimer?: Timer;
  reconnectDelayMs: number;
  lastAppliedSeq: number;
  activeStreamIds: Set<string>;
  textTargetsByStreamId: Map<string, string>;
  textTargetIdsByStreamId: Map<string, number>;
  turnId: TurnId | null;
  attemptId: AttemptId | null;
  userTarget: string | null;
  turnActive: boolean;
  ackedToolCalls: Set<string>;
  renderedToolCallsAwaitingAck: Map<string, string>;
  answeredPingSeqs: Set<number>;
  sequenceGate: ReturnType<typeof createSequenceGate>;
};

const state: WorkerState = {
  reconnectDelayMs: 500,
  lastAppliedSeq: 0,
  activeStreamIds: new Set(),
  textTargetsByStreamId: new Map(),
  textTargetIdsByStreamId: new Map(),
  turnId: null,
  attemptId: null,
  userTarget: null,
  turnActive: false,
  ackedToolCalls: new Set(),
  renderedToolCallsAwaitingAck: new Map(),
  answeredPingSeqs: new Set(),
  sequenceGate: createSequenceGate(),
};

const LATENCY_SPIKE_AFTER_MS = 2000;
const RESUME_STALL_AFTER_MS = 4000;
const STREAM_IDLE_INTERRUPT_AFTER_MS = 12000;
const MAX_RECONNECT_AFTER_MS = 10000;

function activeIdentity(extra: Record<string, string | undefined> = {}) {
  return {
    turnId: state.turnId ?? undefined,
    attemptId: state.attemptId ?? undefined,
    ...extra,
  };
}

function attemptScopedId(kind: "stream" | "call", id: string) {
  return state.attemptId ? `${state.attemptId}:${kind}:${id}` : id;
}

function clientStreamId(streamId: string) {
  return attemptScopedId("stream", streamId);
}

function clientCallId(callId: string) {
  return attemptScopedId("call", callId);
}

function serverCallIdFromClientCallId(callId: string) {
  const marker = ":call:";
  const markerIndex = callId.lastIndexOf(marker);
  return markerIndex === -1 ? callId : callId.slice(markerIndex + marker.length);
}

function traceIdentity(message: ServerMessage, target?: string) {
  return activeIdentity({
    stream_id: "stream_id" in message ? clientStreamId(message.stream_id) : undefined,
    call_id: "call_id" in message ? clientCallId(message.call_id) : undefined,
    target,
  });
}

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
  traceOut("USER_MESSAGE", content, activeIdentity({ target: state.userTarget ?? undefined }));
  scheduleStreamIdleCheck();
}

function resumeTurn() {
  state.socket?.send(JSON.stringify({ type: "RESUME", last_seq: state.lastAppliedSeq }));
  traceOut("RESUME", `last_seq ${state.lastAppliedSeq}`, activeIdentity());
}

function sendToolAck(serverCallId: string, renderedClientCallId: string) {
  if (state.ackedToolCalls.has(serverCallId)) return;

  if (state.socket?.readyState !== WebSocket.OPEN) {
    state.renderedToolCallsAwaitingAck.set(serverCallId, renderedClientCallId);
    return;
  }

  state.socket.send(JSON.stringify({ type: "TOOL_ACK", call_id: serverCallId }));
  state.ackedToolCalls.add(serverCallId);
  state.renderedToolCallsAwaitingAck.delete(serverCallId);
  traceOut("TOOL_ACK", serverCallId, activeIdentity({ call_id: renderedClientCallId }));
}

function acknowledgeRenderedToolCall(renderedClientCallId: string) {
  const serverCallId = serverCallIdFromClientCallId(renderedClientCallId);
  sendToolAck(serverCallId, renderedClientCallId);
}

function flushRenderedToolAcks() {
  for (const [serverCallId, renderedClientCallId] of state.renderedToolCallsAwaitingAck) {
    sendToolAck(serverCallId, renderedClientCallId);
  }
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
  state.activeStreamIds.clear();
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

function markStreamActive(streamId: string) {
  state.activeStreamIds.add(streamId);
  markActive();
}

function applyToken(message: TokenMessage) {
  const streamId = clientStreamId(message.stream_id);
  const target = textTarget(streamId);
  self.postMessage({
    kind: "token",
    turnId: state.turnId,
    attemptId: state.attemptId,
    seq: message.seq,
    stream_id: streamId,
    text: message.text,
    target,
  });
  return target;
}

function applyMessage(message: ServerMessage) {
  switch (message.type) {
    case "TOKEN":
      markStreamActive(message.stream_id);
      return applyToken(message);
    case "CONTEXT_SNAPSHOT":
      markActive();
      self.postMessage({
        kind: "context",
        turnId: state.turnId,
        attemptId: state.attemptId,
        context_id: message.context_id,
        data: message.data,
      });
      break;
    case "TOOL_CALL":
      markStreamActive(message.stream_id);
      self.postMessage({
        kind: "tool_call",
        turnId: state.turnId,
        attemptId: state.attemptId,
        seq: message.seq,
        stream_id: clientStreamId(message.stream_id),
        call_id: clientCallId(message.call_id),
        tool_name: message.tool_name,
        args: message.args,
      });
      clearTextTarget(clientStreamId(message.stream_id));
      break;
    case "TOOL_RESULT":
      markStreamActive(message.stream_id);
      self.postMessage({
        kind: "tool_result",
        turnId: state.turnId,
        attemptId: state.attemptId,
        seq: message.seq,
        stream_id: clientStreamId(message.stream_id),
        call_id: clientCallId(message.call_id),
        result: message.result,
      });
      break;
    case "PING":
      break;
    case "STREAM_END":
      self.postMessage({
        kind: "stream_end",
        turnId: state.turnId,
        attemptId: state.attemptId,
        seq: message.seq,
        stream_id: clientStreamId(message.stream_id),
      });
      clearTextTarget(clientStreamId(message.stream_id));
      state.activeStreamIds.delete(message.stream_id);
      if (state.activeStreamIds.size === 0) {
        state.turnActive = false;
        clearResumeStallCheck();
        clearStreamIdleCheck();
        markConnected();
      }
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
      flushRenderedToolAcks();
      scheduleInterruptionCheck();
      return;
    }
    const queued = state.queued;
    if (!queued) return;
    state.turnId = queued.turnId;
    state.attemptId = queued.attemptId;
    state.userTarget = queued.turnId;
    sendTurn(queued.content);
    state.queued = undefined;
  };

  function disconnected() {
    if (state.socket !== currentSocket) return;
    currentSocket.onclose = null;
    currentSocket.onerror = null;
    clearTimeout(state.waitTimer);
    clearResumeStallCheck();
    clearStreamIdleCheck();
    if (state.turnActive || state.activeStreamIds.size > 0) scheduleReconnect();
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
      trace(message, receivedAt, undefined, traceIdentity(message));
      currentSocket.send(JSON.stringify({ type: "PONG", echo: message.challenge }));
      traceOut("PONG", `echo ${message.challenge || "(empty)"}`, activeIdentity());
    }

    for (const orderedMessage of state.sequenceGate.accept(message)) {
      if (orderedMessage.type !== "PING" && orderedMessage.type !== "TOKEN") {
        trace(orderedMessage, receivedAt, undefined, traceIdentity(orderedMessage));
      }
      const target = applyMessage(orderedMessage);
      if (orderedMessage.type === "TOKEN" && target) {
        trace(
          orderedMessage,
          receivedAt,
          orderedMessage.text,
          traceIdentity(orderedMessage, target),
        );
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

function startTurn(turnId: TurnId, attemptId: AttemptId) {
  clearResumeStallCheck();
  clearStreamIdleCheck();
  state.sequenceGate.startTurn();
  state.ackedToolCalls.clear();
  state.renderedToolCallsAwaitingAck.clear();
  state.answeredPingSeqs.clear();
  state.reconnectDelayMs = 500;
  state.lastAppliedSeq = 0;
  state.activeStreamIds.clear();
  state.textTargetsByStreamId.clear();
  state.textTargetIdsByStreamId.clear();
  state.turnId = turnId;
  state.attemptId = attemptId;
  state.userTarget = turnId;
  state.turnActive = true;
}

function sendUserMessage(content: string, turnId: TurnId, attemptId: AttemptId) {
  clearTimeout(state.reconnectTimer);
  startTurn(turnId, attemptId);
  if (state.socket?.readyState === WebSocket.OPEN) {
    sendTurn(content);
    return;
  }

  state.queued = { content, turnId, attemptId };
  if (state.socket?.readyState === WebSocket.CONNECTING) return;
  connect(false);
}

self.onmessage = (event: MessageEvent<UiToWorker>) => {
  if (event.data.type === "send") {
    sendUserMessage(event.data.content, event.data.turnId, event.data.attemptId);
  }

  if (event.data.type === "tool_rendered") {
    acknowledgeRenderedToolCall(event.data.client_call_id);
  }
};
