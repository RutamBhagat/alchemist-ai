import { Undo2 } from "lucide-react";
import { cn } from "@alchemist-ai/ui/lib/utils";
import type { Message } from "@/lib/chat-store";
import { ToolCallCard } from "./tool-call-card";

type ChatMessageProps = {
  onSelectText: (target: string) => void;
  message: Message;
  onSelectTool: (callId: string) => void;
  onRetry?: () => void;
  retryDisabled?: boolean;
  selectedTarget: string | null;
  userTarget: string | null;
};

export function ChatMessage({
  message,
  onRetry,
  onSelectText,
  onSelectTool,
  retryDisabled = false,
  selectedTarget,
  userTarget,
}: ChatMessageProps) {
  return (
    <div
      className={cn(
        message.role === "user" ? "ml-auto w-fit max-w-[80%]" : "w-full",
      )}
    >
      {message.role === "user" ? (
        <div className="space-y-1">
          <div
            className={cn(
              "cursor-pointer whitespace-pre-wrap border bg-black p-3 text-sm leading-6 text-white",
              selectedTarget === userTarget && "border-blue-500 ring-2 ring-blue-200",
            )}
            data-chat-target={userTarget ?? undefined}
            onClick={() => userTarget && onSelectText(userTarget)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && userTarget) onSelectText(userTarget);
            }}
            role="button"
            tabIndex={0}
          >
            {message.text}
          </div>
          {onRetry ? (
            <button
              aria-label="Resume from this message"
              className="ml-auto flex size-7 items-center justify-center border text-muted-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
              disabled={retryDisabled}
              onClick={onRetry}
              title="Resume from this message"
              type="button"
            >
              <Undo2 className="size-3.5" />
            </button>
          ) : null}
        </div>
      ) : (
        <div className="space-y-2">
          {message.parts.length ? (
            message.parts.map((part, index) => {
              if (part.kind === "text") {
                return (
                  <div
                    className={cn(
                      "cursor-pointer whitespace-pre-wrap border bg-muted/40 p-3 text-sm leading-6",
                      selectedTarget === part.target && "border-blue-500 bg-blue-50",
                    )}
                    data-chat-target={part.target}
                    key={index}
                    onClick={() => onSelectText(part.target)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") onSelectText(part.target);
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    {part.text}
                  </div>
                );
              }
              return (
                <ToolCallCard
                  key={part.tool.id}
                  onSelect={() => onSelectTool(part.tool.id)}
                  selected={selectedTarget === `call:${part.tool.id}`}
                  target={`call:${part.tool.id}`}
                  tool={part.tool}
                />
              );
            })
          ) : (
            <div className="border bg-muted/40 p-3 text-sm leading-6">…</div>
          )}
        </div>
      )}
    </div>
  );
}