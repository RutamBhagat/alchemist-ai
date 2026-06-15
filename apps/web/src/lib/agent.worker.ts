import { serverMessageSchema } from "./protocol";
import type { WorkerEvent } from "./worker-events";

type UiToWorker = { type: "send"; content: string };

let socket: WebSocket | undefined;
let queued: string | undefined;

const post = (message: WorkerEvent) => self.postMessage(message);

const sendUserMessage = (content: string) => {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "USER_MESSAGE", content }));
    return;
  }

  queued = content;
  socket = new WebSocket("ws://localhost:4747/ws");
  socket.onopen = () => {
    if (!queued) return;
    socket?.send(JSON.stringify({ type: "USER_MESSAGE", content: queued }));
    queued = undefined;
  };
  socket.onmessage = (event: MessageEvent<string>) => {
    const result = serverMessageSchema.safeParse(JSON.parse(event.data));
    if (!result.success) return;

    switch (result.data.type) {
      case "TOKEN":
        post({ kind: "token", text: result.data.text });
        break;
      case "CONTEXT_SNAPSHOT":
        post({
          kind: "context",
          context_id: result.data.context_id,
          data: result.data.data,
        });
        break;
      case "TOOL_CALL":
        socket?.send(JSON.stringify({ type: "TOOL_ACK", call_id: result.data.call_id }));
        post({
          kind: "tool_call",
          call_id: result.data.call_id,
          tool_name: result.data.tool_name,
          args: result.data.args,
        });
        break;
      case "TOOL_RESULT":
        post({
          kind: "tool_result",
          call_id: result.data.call_id,
          result: result.data.result,
        });
        break;
      case "PING":
        socket?.send(JSON.stringify({ type: "PONG", echo: result.data.challenge }));
        break;
    }
  };
};

self.onmessage = (event: MessageEvent<UiToWorker>) => {
  if (event.data.type === "send") sendUserMessage(event.data.content);
};
