"use client";

import { Input } from "@alchemist-ai/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@alchemist-ai/ui/components/select";
import {
  Sidebar,
  SidebarContent,
  SidebarGroupContent,
  SidebarHeader,
  SidebarRail,
} from "@alchemist-ai/ui/components/sidebar";
import { cn } from "@alchemist-ai/ui/lib/utils";
import type { WorkerEvent } from "@/lib/worker-events";
import { Activity, Check, ChevronsRight, Radio, Wrench } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

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

function rowSearchText(row: TraceRow) {
  const items = row.kind === "token_group" ? row.items : [row];
  return items
    .map((event) =>
      [
        event.type,
        event.label,
        event.text,
        event.call_id,
        event.stream_id,
        event.seq,
      ]
        .filter(Boolean)
        .join(" "),
    )
    .join(" ")
    .toLowerCase();
}

function Row({ row }: { row: TraceRow }) {
  const [open, setOpen] = useState(false);
  const event = row.kind === "token_group" ? row.items[0] : row;
  const Icon = icons[event.type as keyof typeof icons] ?? Activity;
  const chain = event.call_id && event.type !== "TOOL_CALL";
  const fullText =
    row.kind === "token_group"
      ? row.items.map((item) => item.text).join("")
      : "";
  return (
    <div
      className={cn(
        "border-l px-2 py-1.5 text-xs",
        chain && "ml-4",
        event.type === "STREAM_END" &&
          "border-emerald-500 bg-emerald-50 text-emerald-950",
      )}
    >
      <button
        className="flex w-full items-center gap-2 text-left"
        onClick={() => row.kind === "token_group" && setOpen((value) => !value)}
        type="button"
      >
        <Icon className="size-3 shrink-0" />
        <span className="min-w-0 flex-1 truncate font-medium">
          {rowText(row)}
        </span>
        <span className="font-mono text-muted-foreground">
          {time(event.at)}
        </span>
      </button>
      <div className="mt-1 truncate pl-5 font-mono text-muted-foreground">
        {event.seq ? `#${event.seq} ` : ""}
        {event.call_id ? `${event.call_id} ` : ""}
        {event.stream_id ?? event.direction} · {event.type}
      </div>
      {open && (
        <pre className="mt-2 whitespace-pre-wrap pl-5 font-mono">
          {fullText}
        </pre>
      )}
    </div>
  );
}

export function TraceSidebar({ events }: { events: TraceEvent[] }) {
  const list = useRef<HTMLDivElement | null>(null);
  const [type, setType] = useState("all");
  const [query, setQuery] = useState("");
  const eventTypes = useMemo(
    () => Array.from(new Set(events.map((event) => event.type))).sort(),
    [events],
  );
  const visibleRows = rows(events).filter((row) => {
    const items = row.kind === "token_group" ? row.items : [row];
    return (
      (type === "all" || items.some((event) => event.type === type)) &&
      rowSearchText(row).includes(query.trim().toLowerCase())
    );
  });

  useEffect(() => {
    if (!list.current) return;
    list.current.scrollTop = list.current.scrollHeight;
  }, [events]);

  return (
    <Sidebar collapsible="offcanvas" side="left">
      <SidebarHeader className="border-b px-3 py-3">
        <div className="flex items-center justify-end gap-2">
          <Select
            onValueChange={(value) => setType(String(value))}
            value={type}
          >
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {eventTypes.map((eventType) => (
                <SelectItem key={eventType} value={eventType}>
                  {eventType}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Input
          className="mt-2"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search trace"
          value={query}
        />
      </SidebarHeader>
      <SidebarContent ref={list}>
        <SidebarGroupContent className="space-y-1 p-2">
          {visibleRows.map((row) => {
            const id = row.kind === "token_group" ? row.items[0].id : row.id;
            return <Row key={`${row.kind}-${id}`} row={row} />;
          })}
        </SidebarGroupContent>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}
