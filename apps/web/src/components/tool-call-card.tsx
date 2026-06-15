import JsonView from "@uiw/react-json-view";
import type { ToolCall } from "@/lib/chat-store";

type ToolCallCardProps = {
  tool: ToolCall;
};

export function ToolCallCard({ tool }: ToolCallCardProps) {
  return (
    <div className="border bg-blue-50 p-3 text-xs">
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
