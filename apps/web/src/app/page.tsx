"use client";

import { Button } from "@alchemist-ai/ui/components/button";
import {
  Card,
  CardContent,
  CardFooter,
} from "@alchemist-ai/ui/components/card";
import { Textarea } from "@alchemist-ai/ui/components/textarea";
import { cn } from "@alchemist-ai/ui/lib/utils";
import { useChatStore } from "@/lib/chat-store";
import { Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type WorkerEvent = { kind: "token"; text: string };

export default function Home() {
  const [draft, setDraft] = useState("");
  const worker = useRef<Worker | null>(null);
  const messages = useChatStore((state) => state.messages);
  const addUserMessage = useChatStore((state) => state.addUserMessage);
  const appendToken = useChatStore((state) => state.appendToken);

  useEffect(() => {
    worker.current = new Worker(
      new URL("../lib/agent.worker.ts", import.meta.url),
    );
    worker.current.onmessage = (event: MessageEvent<WorkerEvent>) => {
      if (event.data.kind === "token") appendToken(event.data.text);
    };
    return () => worker.current?.terminate();
  }, [appendToken]);

  const submit = () => {
    const content = draft.trim();
    if (!content) return;
    addUserMessage(content);
    worker.current?.postMessage({ type: "send", content });
    setDraft("");
  };

  return (
    <main className="grid h-svh place-items-center">
      <Card className="h-full w-full max-w-3xl">
        <CardContent className="flex-1 space-y-3 overflow-y-auto py-4">
          {messages.map((message, index) => (
            <div
              className={cn(
                "w-fit max-w-[80%]",
                message.role === "user" ? "ml-auto" : "mr-auto",
              )}
              key={index}
            >
              <div
                className={cn(
                  "whitespace-pre-wrap border p-3 text-sm leading-6",
                  message.role === "user"
                    ? "bg-black text-white"
                    : "bg-muted/40",
                )}
              >
                {message.text || "…"}
              </div>
            </div>
          ))}
        </CardContent>

        <CardFooter>
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
    </main>
  );
}
