import JsonView from "@uiw/react-json-view";
import type { ToolCall } from "@/lib/chat-store";

type ToolCallCardProps = {
  onSelect: () => void;
  tool: ToolCall;
};

export function ToolCallCard({ onSelect, tool }: ToolCallCardProps) {
  return (
    <div
      className="cursor-pointer border bg-blue-50 p-3 text-xs"
      onClick={onSelect}
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
