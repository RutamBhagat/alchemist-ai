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
  resumeStallTimer?: Timer;
  streamIdleTimer?: Timer;
  reconnectTimer?: Timer;
  reconnectDelayMs: number;
  lastAppliedSeq: number;
  textTarget: string | null;
  textTargetId: number;
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
  textTarget: null,
  textTargetId: 0,
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
    if (state.turnActive) {
      self.postMessage({ kind: "connection", status: "waiting" });
    }
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
  state.socket?.send(
    JSON.stringify({ type: "RESUME", last_seq: state.lastAppliedSeq }),
  );
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

  self.postMessage({
    kind: "notification",
    type: "error",
    message,
  });
  self.postMessage({ kind: "turn_interrupted" });
  markConnected();
}

function scheduleInterruptionCheck() {
  clearTimeout(state.resumeStallTimer);
  state.resumeStallTimer = setTimeout(() => {
    if (!state.turnActive) {
      return;
    }
    interruptTurn(
      "Stream interrupted. The backend did not resume generation after reconnect.",
    );
  }, RESUME_STALL_AFTER_MS);
}

function scheduleStreamIdleCheck() {
  clearTimeout(state.streamIdleTimer);
  state.streamIdleTimer = setTimeout(() => {
    if (!state.turnActive) {
      return;
    }
    interruptTurn(
      "Stream stalled. The backend kept the socket open but did not send STREAM_END.",
    );
  }, STREAM_IDLE_INTERRUPT_AFTER_MS);
}

function textTarget() {
  state.textTarget ??= `text:${++state.textTargetId}`;
  return state.textTarget;
}

function applyToken(text: string) {
  const target = textTarget();
  self.postMessage({ kind: "token", text, target });
  return target;
}

function applyMessage(message: ServerMessage) {
  switch (message.type) {
    case "TOKEN":
      markActive();
      return applyToken(message.text);
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
      state.textTarget = null;
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
      clearResumeStallCheck();
      clearStreamIdleCheck();
      markConnected();
      break;
    case "ERROR":
      self.postMessage({
        kind: "notification",
        type: "error",
        message: message.message,
      });
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
      scheduleInterruptionCheck();
      return;
    }
    const queued = state.queued;
    if (!queued) {
      return;
    }
    sendTurn(queued);
    state.queued = undefined;
  };

  function disconnected() {
    if (state.socket !== currentSocket) {
      return;
    }
    currentSocket.onclose = null;
    currentSocket.onerror = null;
    clearTimeout(state.waitTimer);
    clearResumeStallCheck();
    clearStreamIdleCheck();
    if (state.turnActive) {
      scheduleReconnect();
    } else {
      self.postMessage({ kind: "connection", status: "disconnected" });
    }
    self.postMessage({
      kind: "notification",
      type: "error",
      message:
        "Connection lost. Reconnecting and replaying already-generated events; this mock backend may not continue an interrupted stream.",
    });
  }

  currentSocket.onclose = () => {
    disconnected();
  };
  currentSocket.onerror = () => {
    disconnected();
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

    // Heartbeats are liveness checks, so PING must be answered immediately.
    // If we wait for seq-order processing/replay buffering, an out-of-order PING can sit behind missing messages long enough for the server to drop us.
    if (message.type === "PING" && !state.answeredPingSeqs.has(message.seq)) {
      state.answeredPingSeqs.add(message.seq);
      trace(message, receivedAt);
      currentSocket.send(
        JSON.stringify({ type: "PONG", echo: message.challenge }),
      );
      traceOut("PONG", `echo ${message.challenge || "(empty)"}`);
    }
    if (
      message.type === "TOOL_CALL" &&
      !state.ackedToolCalls.has(message.call_id)
    ) {
      state.ackedToolCalls.add(message.call_id);
      currentSocket.send(
        JSON.stringify({ type: "TOOL_ACK", call_id: message.call_id }),
      );
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
  state.reconnectDelayMs = Math.min(
    state.reconnectDelayMs * 2,
    MAX_RECONNECT_AFTER_MS,
  );
}

function startTurn() {
  clearResumeStallCheck();
  clearStreamIdleCheck();
  state.sequenceGate.startTurn();
  state.ackedToolCalls.clear();
  state.answeredPingSeqs.clear();
  state.reconnectDelayMs = 500;
  state.lastAppliedSeq = 0;
  state.textTarget = null;
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
