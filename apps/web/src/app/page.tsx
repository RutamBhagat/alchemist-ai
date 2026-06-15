"use client";

import { Button } from "@alchemist-ai/ui/components/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@alchemist-ai/ui/components/card";
import { Textarea } from "@alchemist-ai/ui/components/textarea";
import { cn } from "@alchemist-ai/ui/lib/utils";
import { Send } from "lucide-react";
import { useState } from "react";

const messages = [
  { role: "user", text: "Find recent context and summarize it." },
  {
    role: "agent",
    text: "I found the relevant context. I’ll stream results here and keep tool calls inline when they happen.",
  },
];

export default function Home() {
  const [draft, setDraft] = useState("");

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
                  "border p-3 text-sm leading-6",
                  message.role === "user"
                    ? "bg-black text-white"
                    : "bg-muted/40",
                )}
              >
                {message.text}
              </div>
            </div>
          ))}
        </CardContent>

        <CardFooter className="">
          <Textarea
            className="h-12 min-h-12 resize-none"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey)
                event.preventDefault();
            }}
            placeholder="Message the agent..."
            value={draft}
          />
          <Button className="h-12 w-12" disabled={!draft.trim()} size="icon">
            <Send />
          </Button>
        </CardFooter>
      </Card>
    </main>
  );
}
