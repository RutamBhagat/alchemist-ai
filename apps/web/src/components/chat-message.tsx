import { cn } from "@alchemist-ai/ui/lib/utils";
import type { Message } from "@/lib/chat-store";
import { ToolCallCard } from "./tool-call-card";

type ChatMessageProps = {
  message: Message;
};

export function ChatMessage({ message }: ChatMessageProps) {
  return (
    <div
      className={cn(
        "w-fit max-w-[80%]",
        message.role === "user" ? "ml-auto" : "mr-auto",
      )}
    >
      {message.role === "user" ? (
        <div className="whitespace-pre-wrap border bg-black p-3 text-sm leading-6 text-white">
          {message.text}
        </div>
      ) : (
        <div className="space-y-2">
          {message.parts.length ? (
            message.parts.map((part, index) =>
              part.kind === "text" ? (
                <div
                  className="whitespace-pre-wrap border bg-muted/40 p-3 text-sm leading-6"
                  key={index}
                >
                  {part.text}
                </div>
              ) : (
                <ToolCallCard key={part.tool.id} tool={part.tool} />
              ),
            )
          ) : (
            <div className="border bg-muted/40 p-3 text-sm leading-6">…</div>
          )}
        </div>
      )}
    </div>
  );
}
