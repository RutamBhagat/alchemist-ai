import { cn } from "@alchemist-ai/ui/lib/utils";
import type { AgentStream, ToolCall } from "@/lib/chat-stream-model";
import type { ChatEntry, UserMessage } from "@/lib/chat-store";
import { ToolCallCard } from "./tool-call-card";

type BaseChatMessageProps = {
  onSelectText: (target: string) => void;
  onSelectTool: (callId: string) => void;
  selectedTarget: string | null;
};

type ChatMessageProps =
  | (BaseChatMessageProps & {
      entry: Extract<ChatEntry, { kind: "user" }>;
      userMessage: UserMessage;
    })
  | (BaseChatMessageProps & {
      entry: Extract<ChatEntry, { kind: "agent_stream" }>;
      stream: AgentStream;
      toolsByCallId: Record<string, ToolCall>;
    });

export function ChatMessage(props: ChatMessageProps) {
  const { entry, onSelectText, onSelectTool, selectedTarget } = props;

  return (
    <div
      className={cn(
        entry.kind === "user" ? "ml-auto w-fit max-w-[80%]" : "w-full",
      )}
    >
      {"userMessage" in props ? (
        <div
          className={cn(
            "cursor-pointer whitespace-pre-wrap border bg-black p-3 text-sm leading-6 text-white",
            selectedTarget === props.entry.id &&
              "border-blue-500 ring-2 ring-blue-200",
          )}
          data-chat-target={props.entry.id}
          onClick={() => onSelectText(props.entry.id)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onSelectText(props.entry.id);
          }}
          role="button"
          tabIndex={0}
        >
          {props.userMessage.text}
        </div>
      ) : (
        <div className="space-y-2">
          {props.stream.parts.length ? (
            props.stream.parts.map((part) => {
              if (part.kind === "text") {
                return (
                  <div
                    className={cn(
                      "cursor-pointer whitespace-pre-wrap border bg-muted/40 p-3 text-sm leading-6",
                      selectedTarget === part.target && "border-blue-500 bg-blue-50",
                    )}
                    data-chat-target={part.target}
                    key={part.id}
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

              const tool = props.toolsByCallId[part.call_id];
              if (!tool) {
                return null;
              }

              return (
                <ToolCallCard
                  key={part.call_id}
                  onSelect={() => onSelectTool(part.call_id)}
                  selected={selectedTarget === `call:${part.call_id}`}
                  target={`call:${part.call_id}`}
                  tool={tool}
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
