"use client";

import { Button } from "@alchemist-ai/ui/components/button";
import {
  Card,
  CardContent,
  CardFooter,
} from "@alchemist-ai/ui/components/card";
import { Textarea } from "@alchemist-ai/ui/components/textarea";
import { ChatMessage } from "@/components/chat-message";
import { ConnectionPill } from "@/components/connection-pill";
import { ContextSidebar } from "@/components/context-sidebar";
import { TraceSidebar } from "@/components/trace-sidebar";
import { useChatStore } from "@/lib/chat-store";
import type { ConnectionStatus, WorkerEvent } from "@/lib/worker-events";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@alchemist-ai/ui/components/sidebar";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";

type TraceEvent = Extract<WorkerEvent, { kind: "trace" }>;

export default function Home() {
  const [draft, setDraft] = useState("");
  const [autoScroll] = useState(process.env.NODE_ENV === "development");
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("idle");
  const [traceEvents, setTraceEvents] = useState<TraceEvent[]>([]);
  const [selectedTraceTarget, setSelectedTraceTarget] = useState<string | null>(
    null,
  );
  const [awaitingResponse, setAwaitingResponse] = useState(false);
  const messageList = useRef<HTMLDivElement | null>(null);
  const worker = useRef<Worker | null>(null);
  const messages = useChatStore((state) => state.messages);
  const contexts = useChatStore((state) => state.contexts);
  const selectedContextId = useChatStore((state) => state.selectedContextId);
  const addUserMessage = useChatStore((state) => state.addUserMessage);
  const appendToken = useChatStore((state) => state.appendToken);
  const addToolCall = useChatStore((state) => state.addToolCall);
  const setToolResult = useChatStore((state) => state.setToolResult);
  const setContext = useChatStore((state) => state.setContext);
  const selectContext = useChatStore((state) => state.selectContext);
  const serverResponding =
    awaitingResponse ||
    ["streaming", "waiting", "reconnecting"].includes(connectionStatus);

  useEffect(() => {
    worker.current = new Worker(
      new URL("../lib/agent.worker.ts", import.meta.url),
    );
    worker.current.onmessage = (event: MessageEvent<WorkerEvent>) => {
      switch (event.data.kind) {
        case "trace":
          {
            const traceEvent = event.data;
            setTraceEvents((events) => [...events, traceEvent]);
            if (
              traceEvent.type === "STREAM_END" ||
              traceEvent.type === "ERROR"
            ) {
              setAwaitingResponse(false);
            }
          }
          break;
        case "connection":
          if (event.data.status === "disconnected") {
            setAwaitingResponse(false);
          }
          setConnectionStatus(event.data.status);
          break;
        case "notification":
          toast.error(event.data.message);
          break;
        case "token":
          appendToken(event.data.text, event.data.target);
          break;
        case "context":
          setContext({
            context_id: event.data.context_id,
            data: event.data.data,
          });
          break;
        case "tool_call":
          addToolCall({
            id: event.data.call_id,
            tool_name: event.data.tool_name,
            args: event.data.args,
            result: event.data.result,
          });
          break;
        case "tool_result":
          setToolResult(event.data.call_id, event.data.result);
          break;
      }
    };
    return () => worker.current?.terminate();
  }, [addToolCall, appendToken, setContext, setToolResult]);

  useEffect(() => {
    if (!autoScroll) return;
    const list = messageList.current;
    if (!list) return;
    list.scrollTop = list.scrollHeight;
  }, [autoScroll, messages]);

  useEffect(() => {
    if (!selectedTraceTarget) return;
    scrollToChatTarget(selectedTraceTarget);
  }, [selectedTraceTarget]);

  const selectTraceTarget = (target: string) => {
    setSelectedTraceTarget(target);
    requestAnimationFrame(() => scrollToChatTarget(target));
  };

  const scrollToChatTarget = (target: string) => {
    const element = Array.from(
      messageList.current?.querySelectorAll<HTMLElement>("[data-chat-target]") ??
        [],
    ).find((node) => node.dataset.chatTarget === target);
    element?.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  const submit = () => {
    const content = draft.trim();
    if (!content || serverResponding) return;
    addUserMessage(content);
    setAwaitingResponse(true);
    worker.current?.postMessage({ type: "send", content });
    setDraft("");
  };
  let userIndex = 0;

  return (
    <SidebarProvider
      defaultOpen
      style={{ "--sidebar-width": "30rem" } as CSSProperties}
    >
      <TraceSidebar
        events={traceEvents}
        onSelectTarget={selectTraceTarget}
        selectedTarget={selectedTraceTarget}
      />
      <SidebarInset>
        <main className="grid h-svh grid-cols-2 overflow-hidden">
          <ConnectionPill status={connectionStatus} />
          <SidebarTrigger className="fixed left-2 top-2 z-50" />
          <section className="min-h-0 min-w-0 overflow-hidden">
            <Card className="flex h-full w-full flex-col rounded-none border-0">
              <CardContent
                className="min-h-0 flex-1 space-y-3 overflow-y-auto py-4"
                ref={messageList}
              >
                {messages.map((message, index) => {
                  const userTarget =
                    message.role === "user" ? `user:${++userIndex}` : null;
                  return (
                    <ChatMessage
                      key={index}
                      message={message}
                      onSelectTool={(callId) =>
                        selectTraceTarget(`call:${callId}`)
                      }
                      selectedTarget={selectedTraceTarget}
                      userTarget={userTarget}
                    />
                  );
                })}
              </CardContent>

              <CardFooter className="shrink-0 gap-3">
                <Textarea
                  className="h-12 min-h-12 resize-none"
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      submit();
                    }
                  }}
                  value={draft}
                />
                <Button
                  className="h-12 w-12"
                  disabled={!draft.trim() || serverResponding}
                  onClick={submit}
                  size="icon"
                >
                  {serverResponding ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Send />
                  )}
                </Button>
              </CardFooter>
            </Card>
          </section>
          <ContextSidebar
            contexts={contexts}
            onSelectContext={selectContext}
            selectedContextId={selectedContextId}
          />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
