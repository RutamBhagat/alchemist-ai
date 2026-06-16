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
  const pendingTraceEvents = useRef<TraceEvent[]>([]);
  const traceFlush = useRef<number | null>(null);
  const worker = useRef<Worker | null>(null);
  const entryOrder = useChatStore((state) => state.entryOrder);
  const userMessagesById = useChatStore((state) => state.userMessagesById);
  const streamsById = useChatStore((state) => state.streamsById);
  const toolsByCallId = useChatStore((state) => state.toolsByCallId);
  const contexts = useChatStore((state) => state.contexts);
  const selectedContextId = useChatStore((state) => state.selectedContextId);
  const addUserMessage = useChatStore((state) => state.addUserMessage);
  const retryFromUserMessage = useChatStore(
    (state) => state.retryFromUserMessage,
  );
  const appendToken = useChatStore((state) => state.appendToken);
  const addToolCall = useChatStore((state) => state.addToolCall);
  const setToolResult = useChatStore((state) => state.setToolResult);
  const endStream = useChatStore((state) => state.endStream);
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
            pendingTraceEvents.current.push(traceEvent);
            if (traceFlush.current === null) {
              traceFlush.current = requestAnimationFrame(() => {
                traceFlush.current = null;
                const batch = pendingTraceEvents.current;
                pendingTraceEvents.current = [];
                setTraceEvents((events) => [...events, ...batch]);
              });
            }
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
        case "turn_interrupted":
          setAwaitingResponse(false);
          autoResumeLastUserMessage();
          break;
        case "token":
          appendToken({
            stream_id: event.data.stream_id,
            seq: event.data.seq,
            text: event.data.text,
            target: event.data.target,
          });
          break;
        case "context":
          setContext({
            context_id: event.data.context_id,
            data: event.data.data,
          });
          break;
        case "tool_call":
          addToolCall({
            stream_id: event.data.stream_id,
            seq: event.data.seq,
            call_id: event.data.call_id,
            tool_name: event.data.tool_name,
            args: event.data.args,
          });
          break;
        case "tool_result":
          setToolResult({
            stream_id: event.data.stream_id,
            seq: event.data.seq,
            call_id: event.data.call_id,
            result: event.data.result,
          });
          break;
        case "stream_end":
          endStream({
            stream_id: event.data.stream_id,
            seq: event.data.seq,
          });
          setAwaitingResponse(false);
          break;
      }
    };
    return () => {
      if (traceFlush.current !== null) cancelAnimationFrame(traceFlush.current);
      worker.current?.terminate();
    };
  }, [addToolCall, appendToken, endStream, setContext, setToolResult]);

  useEffect(() => {
    if (!autoScroll) return;
    const list = messageList.current;
    if (!list) return;
    list.scrollTop = list.scrollHeight;
  }, [autoScroll, entryOrder, streamsById, toolsByCallId]);

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
      messageList.current?.querySelectorAll<HTMLElement>(
        "[data-chat-target]",
      ) ?? [],
    ).find((node) => node.dataset.chatTarget === target);
    element?.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  function sendToWorker(content: string) {
    setAwaitingResponse(true);
    worker.current?.postMessage({ type: "send", content });
  }

  function clearTrace() {
    if (traceFlush.current !== null) {
      cancelAnimationFrame(traceFlush.current);
      traceFlush.current = null;
    }
    pendingTraceEvents.current = [];
    setTraceEvents([]);
    setSelectedTraceTarget(null);
  }

  function autoResumeLastUserMessage() {
    const state = useChatStore.getState();

    for (let index = state.entryOrder.length - 1; index >= 0; index--) {
      const entry = state.entryOrder[index];
      if (entry?.kind !== "user") continue;

      const content = state.userMessagesById[entry.id]?.text.trim();
      if (!content) return;

      clearTrace();
      state.retryFromUserMessage(index);
      sendToWorker(content);
      toast.info("Retrying the last message after stalled recovery.");
      return;
    }
  }

  const submit = () => {
    const content = draft.trim();
    if (!content || serverResponding) return;
    addUserMessage(content);
    sendToWorker(content);
    setDraft("");
  };

  const resumeFromMessage = (messageIndex: number, content: string) => {
    const message = content.trim();
    if (!message || serverResponding) return;
    clearTrace();
    retryFromUserMessage(messageIndex);
    sendToWorker(message);
  };

  return (
    <SidebarProvider
      defaultOpen={false}
      style={{ "--sidebar-width": "30rem" } as CSSProperties}
    >
      <TraceSidebar
        events={traceEvents}
        onSelectTarget={selectTraceTarget}
        selectedTarget={selectedTraceTarget}
      />
      <SidebarInset>
        <div className="h-svh min-w-0 overflow-hidden">
          <ConnectionPill status={connectionStatus} />
          <SidebarTrigger
            aria-label="Toggle debug mode"
            className="fixed left-2 top-2 z-50"
            title="Toggle debug mode"
          />
          <section className="h-full min-h-0 min-w-0 overflow-hidden">
            <Card className="flex h-full w-full flex-col rounded-none border-0">
              <CardContent
                className="min-h-0 flex-1 space-y-3 overflow-y-auto py-4"
                ref={messageList}
              >
                {entryOrder.map((entry, index) => {
                  if (entry.kind === "user") {
                    const userMessage = userMessagesById[entry.id];
                    if (!userMessage) return null;

                    return (
                      <ChatMessage
                        key={entry.id}
                        entry={entry}
                        onRetry={() => resumeFromMessage(index, userMessage.text)}
                        onSelectText={selectTraceTarget}
                        onSelectTool={(callId) =>
                          selectTraceTarget(`call:${callId}`)
                        }
                        retryDisabled={serverResponding}
                        selectedTarget={selectedTraceTarget}
                        userMessage={userMessage}
                      />
                    );
                  }

                  const stream = streamsById[entry.stream_id];
                  if (!stream) return null;

                  return (
                    <ChatMessage
                      key={entry.stream_id}
                      entry={entry}
                      onSelectText={selectTraceTarget}
                      onSelectTool={(callId) =>
                        selectTraceTarget(`call:${callId}`)
                      }
                      retryDisabled={serverResponding}
                      selectedTarget={selectedTraceTarget}
                      stream={stream}
                      toolsByCallId={toolsByCallId}
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
        </div>
      </SidebarInset>
      <ContextSidebar
        contexts={contexts}
        onSelectContext={selectContext}
        selectedContextId={selectedContextId}
      />
    </SidebarProvider>
  );
}
