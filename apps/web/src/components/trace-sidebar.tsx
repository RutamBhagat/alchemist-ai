"use client";

import { Sidebar, SidebarContent, SidebarGroupContent, SidebarRail } from "@alchemist-ai/ui/components/sidebar";
import type { WorkerEvent } from "@/lib/worker-events";
import { Activity, Check, ChevronsRight, Radio, Wrench } from "lucide-react";

type TraceEvent = Extract<WorkerEvent, { kind: "trace" }>;
type TraceRow = TraceEvent | { kind: "token_group"; items: TraceEvent[] };

const icons = {
  TOKEN: Activity,
  TOOL_CALL: Wrench,
  TOOL_RESULT: Check,
  STREAM_END: ChevronsRight,
  PING: Radio,
  PONG: Radio,
  RESUME: ChevronsRight,
  USER_MESSAGE: Activity,
  TOOL_ACK: Check,
} as const;

const time = (at: number) =>
  new Date(performance.timeOrigin + at).toLocaleTimeString([], {
    hour12: false,
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
  });

function rows(events: TraceEvent[]) {
  const grouped: TraceRow[] = [];
  for (const event of events) {
    const last = grouped.at(-1);
    if (
      event.type === "TOKEN" &&
      last?.kind === "token_group" &&
      last.items.at(-1)?.stream_id === event.stream_id
    ) {
      last.items.push(event);
    } else if (event.type === "TOKEN") {
      grouped.push({ kind: "token_group", items: [event] });
    } else {
      grouped.push(event);
    }
  }
  return grouped;
}

function rowText(row: TraceRow) {
  if (row.kind !== "token_group") return row.label;
  const first = row.items[0];
  const last = row.items.at(-1) ?? first;
  const seconds = ((last.at - first.at) / 1000).toFixed(1);
  return `Streamed ${row.items.length} tokens (${seconds}s)`;
}

function Row({ row }: { row: TraceRow }) {
  const event = row.kind === "token_group" ? row.items[0] : row;
  const Icon = icons[event.type as keyof typeof icons] ?? Activity;
  const chain = event.call_id && event.type !== "TOOL_CALL";
  return (
    <div className={`border-l px-2 py-1.5 text-xs ${chain ? "ml-4" : ""}`}>
      <div className="flex items-center gap-2">
        <Icon className="size-3 shrink-0" />
        <span className="min-w-0 flex-1 truncate font-medium">{rowText(row)}</span>
        <span className="font-mono text-muted-foreground">{time(event.at)}</span>
      </div>
      <div className="mt-1 truncate pl-5 font-mono text-muted-foreground">
        {event.seq ? `#${event.seq} ` : ""}
        {event.call_id ? `${event.call_id} ` : ""}
        {event.stream_id ?? event.direction} · {event.type}
      </div>
    </div>
  );
}

export function TraceSidebar({ events }: { events: TraceEvent[] }) {
  return (
    <Sidebar collapsible="offcanvas" side="left">
      <SidebarContent>
        <SidebarGroupContent className="space-y-1 p-2">
          {rows(events).map((row) => {
            const id = row.kind === "token_group" ? row.items[0].id : row.id;
            return <Row key={`${row.kind}-${id}`} row={row} />;
          })}
        </SidebarGroupContent>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}
