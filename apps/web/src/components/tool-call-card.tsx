import { useEffect } from "react";
import JsonView from "@uiw/react-json-view";
import { cn } from "@alchemist-ai/ui/lib/utils";
import type { ToolCall } from "@/lib/chat-stream-model";

type ToolRenderedPayload = Pick<ToolCall, "call_id">;

type ToolCallCardProps = {
  onRendered: (tool: ToolRenderedPayload) => void;
  onSelect: () => void;
  selected: boolean;
  target: string;
  tool: ToolCall;
};

export function ToolCallCard({
  onRendered,
  onSelect,
  selected,
  target,
  tool,
}: ToolCallCardProps) {
  const { call_id } = tool;

  useEffect(() => {
    onRendered({ call_id });
  }, [call_id, onRendered]);

  return (
    <div
      className={cn(
        "cursor-pointer border bg-blue-50 p-3 text-xs",
        selected && "border-blue-500 ring-2 ring-blue-200",
      )}
      onClick={onSelect}
      data-chat-target={target}
      onKeyDown={(event) => {
        if (event.key === "Enter") onSelect();
      }}
      role="button"
      tabIndex={0}
    >
      <div className="mb-2 font-semibold">{tool.tool_name}</div>
      <div className="rounded border bg-background p-2">
        <JsonView
          collapsed={2}
          displayDataTypes={false}
          enableClipboard
          value={{ args: tool.args }}
        />
      </div>
      <div className="mt-2 rounded border bg-background p-2">
        {tool.result ? (
          <JsonView
            collapsed={2}
            displayDataTypes={false}
            enableClipboard
            value={{ result: tool.result }}
          />
        ) : (
          "Waiting for result…"
        )}
      </div>
    </div>
  );
}
