"use client";

import { Button } from "@alchemist-ai/ui/components/button";
import {
  Card,
  CardContent,
  CardFooter,
} from "@alchemist-ai/ui/components/card";
import { Textarea } from "@alchemist-ai/ui/components/textarea";
import { ChatMessage } from "@/components/chat-message";
import { ContextSidebar } from "@/components/context-sidebar";
import { useChatStore } from "@/lib/chat-store";
import type { WorkerEvent } from "@/lib/worker-events";
import { Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export default function Home() {
  const [draft, setDraft] = useState("");
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

  useEffect(() => {
    worker.current = new Worker(
      new URL("../lib/agent.worker.ts", import.meta.url),
    );
    worker.current.onmessage = (event: MessageEvent<WorkerEvent>) => {
      switch (event.data.kind) {
        case "token":
          appendToken(event.data.text);
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

  const submit = () => {
    const content = draft.trim();
    if (!content) return;
    addUserMessage(content);
    worker.current?.postMessage({ type: "send", content });
    setDraft("");
  };

  return (
    <main className="grid h-svh grid-cols-3 overflow-hidden">
      <section></section>
      <section className="min-h-0 min-w-0 overflow-hidden">
        <Card className="flex h-full w-full flex-col rounded-none border-0">
          <CardContent className="min-h-0 flex-1 space-y-3 overflow-y-auto py-4">
            {messages.map((message, index) => (
              <ChatMessage key={index} message={message} />
            ))}
          </CardContent>

          <CardFooter className="shrink-0">
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
              disabled={!draft.trim()}
              onClick={submit}
              size="icon"
            >
              <Send />
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
  );
}
