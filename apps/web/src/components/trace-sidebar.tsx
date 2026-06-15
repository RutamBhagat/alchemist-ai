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
type TraceRow =
  | TraceEvent
  | { kind: "token_group"; items: TraceEvent[] }
  | { kind: "tool_group"; call: TraceEvent; ack?: TraceEvent; result?: TraceEvent };

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
  const acks = new Map<string, TraceEvent>();
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
    } else if (event.type === "TOOL_ACK" && event.call_id) {
      acks.set(event.call_id, event);
    } else if (event.type === "TOOL_CALL" && event.call_id) {
      grouped.push({
        kind: "tool_group",
        call: event,
        ack: acks.get(event.call_id),
      });
      acks.delete(event.call_id);
    } else if (event.type === "TOOL_RESULT") {
      const tool = grouped.findLast(
        (row) => row.kind === "tool_group" && row.call.call_id === event.call_id,
      );
      if (tool?.kind === "tool_group" && !tool.result) {
        tool.result = event;
      } else {
        grouped.push(event);
      }
    } else {
      grouped.push(event);
    }
  }
  grouped.push(...acks.values());
  return grouped;
}

function rowText(row: TraceRow) {
  if (row.kind === "tool_group") return row.call.label;
  if (row.kind !== "token_group") return row.label;
  const first = row.items[0];
  const last = row.items.at(-1) ?? first;
  const seconds = ((last.at - first.at) / 1000).toFixed(1);
  return `Streamed ${row.items.length} tokens (${seconds}s)`;
}

function rowSearchText(row: TraceRow) {
  const items =
    row.kind === "token_group"
      ? row.items
      : row.kind === "tool_group"
        ? [row.call, row.ack, row.result].filter((event) => !!event)
        : [row];
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

function rowEvent(row: TraceRow) {
  return row.kind === "token_group"
    ? row.items[0]
    : row.kind === "tool_group"
      ? row.call
      : row;
}

function rowCallId(row: TraceRow) {
  return row.kind === "tool_group" ? row.call.call_id : rowEvent(row).call_id;
}

function Row({
  row,
  selected,
  setRef,
}: {
  row: TraceRow;
  selected: boolean;
  setRef: (node: HTMLDivElement | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const event = rowEvent(row);
  const Icon = icons[event.type as keyof typeof icons] ?? Activity;
  const fullText =
    row.kind === "token_group"
      ? row.items.map((item) => item.text).join("")
      : "";
  return (
    <div
      ref={setRef}
      className={cn(
        "border-l px-2 py-1.5 text-xs",
        row.kind === "tool_group" && "border-blue-200 bg-blue-50/60",
        selected && "border-blue-500 bg-blue-50",
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
      {row.kind === "tool_group" && (
        <div className="mt-2 ml-1 border-l border-blue-300 pl-4">
          {row.ack && (
            <div className="mb-2">
              <div className="flex items-center gap-2 font-medium">
                <Check className="size-3 shrink-0" />
                <span className="min-w-0 flex-1 truncate">TOOL_ACK</span>
                <span className="font-mono text-muted-foreground">
                  {time(row.ack.at)}
                </span>
              </div>
              <div className="mt-1 truncate pl-5 font-mono text-muted-foreground">
                {row.ack.call_id} · out
              </div>
            </div>
          )}
          {row.result ? (
            <>
              <div className="flex items-center gap-2 font-medium">
                <Check className="size-3 shrink-0" />
                <span className="min-w-0 flex-1 truncate">TOOL_RESULT</span>
                <span className="font-mono text-muted-foreground">
                  {time(row.result.at)}
                </span>
              </div>
              <div className="mt-1 truncate pl-5 font-mono text-muted-foreground">
                #{row.result.seq} {row.result.call_id} · {row.result.stream_id}
              </div>
            </>
          ) : (
            <div className="font-mono text-muted-foreground">waiting…</div>
          )}
        </div>
      )}
      {open && (
        <pre className="mt-2 whitespace-pre-wrap pl-5 font-mono">
          {fullText}
        </pre>
      )}
    </div>
  );
}

export function TraceSidebar({
  events,
  selectedCallId,
}: {
  events: TraceEvent[];
  selectedCallId: string | null;
}) {
  const list = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [type, setType] = useState("all");
  const [query, setQuery] = useState("");
  const eventTypes = useMemo(
    () => Array.from(new Set(events.map((event) => event.type))).sort(),
    [events],
  );
  const visibleRows = rows(events).filter((row) => {
    const items =
      row.kind === "token_group"
        ? row.items
        : row.kind === "tool_group"
          ? [row.call, row.ack, row.result].filter((event) => !!event)
          : [row];
    return (
      (type === "all" || items.some((event) => event.type === type)) &&
      rowSearchText(row).includes(query.trim().toLowerCase())
    );
  });

  useEffect(() => {
    if (!list.current) return;
    list.current.scrollTop = list.current.scrollHeight;
  }, [events]);

  useEffect(() => {
    if (!selectedCallId) return;
    rowRefs.current[selectedCallId]?.scrollIntoView({
      block: "center",
      behavior: "smooth",
    });
  }, [selectedCallId]);

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
            const id =
              row.kind === "token_group"
                ? row.items[0].id
                : row.kind === "tool_group"
                  ? row.call.id
                  : row.id;
            const callId = rowCallId(row);
            return (
              <Row
                key={`${row.kind}-${id}`}
                row={row}
                selected={callId === selectedCallId}
                setRef={(node) => {
                  if (callId) rowRefs.current[callId] = node;
                }}
              />
            );
          })}
        </SidebarGroupContent>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}
