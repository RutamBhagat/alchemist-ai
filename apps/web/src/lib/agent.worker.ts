import { serverMessageSchema } from "./protocol";

type UiToWorker = { type: "send"; content: string };
type WorkerToUi = { kind: "token"; text: string };

let socket: WebSocket | undefined;
let queued: string | undefined;

const post = (message: WorkerToUi) => self.postMessage(message);

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
      case "PING":
        socket?.send(JSON.stringify({ type: "PONG", echo: result.data.challenge }));
        break;
    }
  };
};

self.onmessage = (event: MessageEvent<UiToWorker>) => {
  if (event.data.type === "send") sendUserMessage(event.data.content);
};
