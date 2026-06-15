"use client";

import { useEffect, useRef, useState } from "react";
import JsonView from "@uiw/react-json-view";
import { VirtualDiffViewer } from "virtual-react-json-diff";
import type { ContextSlot } from "@/lib/chat-store";

type ContextSidebarProps = {
  contexts: Record<string, ContextSlot>;
  selectedContextId: string | null;
  onSelectContext: (contextId: string) => void;
};

export function ContextSidebar({
  contexts,
  selectedContextId,
  onSelectContext,
}: ContextSidebarProps) {
  const [height, setHeight] = useState(0);
  const [snapshotIndex, setSnapshotIndex] = useState(0);
  const viewerRef = useRef<HTMLDivElement>(null);
  const contextIds = Object.keys(contexts);
  const slot = selectedContextId ? contexts[selectedContextId] : undefined;
  const snapshots = slot?.snapshots ?? [];
  const current = snapshots[snapshotIndex];
  const previous = snapshots[snapshotIndex - 1] ?? null;

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const observer = new ResizeObserver(([entry]) =>
      setHeight(entry.contentRect.height),
    );
    observer.observe(viewer);
    return () => observer.disconnect();
  }, [contextIds.length]);

  useEffect(() => {
    setSnapshotIndex(Math.max(0, snapshots.length - 1));
  }, [selectedContextId, snapshots.length]);

  return (
    <aside className="h-full min-w-0 overflow-hidden border-l p-4">
      <h2 className="font-semibold">Context</h2>
      {contextIds.length ? (
        <div className="mt-3 flex h-[calc(100%-1.75rem)] min-w-0 flex-col gap-3 overflow-hidden">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {contextIds.map((contextId) => (
              <button
                className={
                  contextId === selectedContextId
                    ? "border bg-black px-2 py-1 text-xs text-white"
                    : "border px-2 py-1 text-xs"
                }
                key={contextId}
                onClick={() => onSelectContext(contextId)}
              >
                {contextId}
              </button>
            ))}
          </div>
          {snapshots.length > 1 ? (
            <div className="flex items-center justify-between gap-2 text-xs">
              <button
                className="border px-2 py-1 disabled:opacity-50"
                disabled={snapshotIndex === 0}
                onClick={() => setSnapshotIndex((index) => index - 1)}
              >
                Previous
              </button>
              <span>
                {snapshotIndex + 1} / {snapshots.length}
              </span>
              <button
                className="border px-2 py-1 disabled:opacity-50"
                disabled={snapshotIndex === snapshots.length - 1}
                onClick={() => setSnapshotIndex((index) => index + 1)}
              >
                Next
              </button>
            </div>
          ) : null}
          <div className="min-h-0 flex-1 overflow-hidden" ref={viewerRef}>
            {current && !previous ? (
              <div className="h-full overflow-auto rounded border bg-background p-2 text-xs">
                <JsonView
                  collapsed={2}
                  displayDataTypes={false}
                  enableClipboard={false}
                  shortenTextAfterLength={80}
                  value={current.data}
                />
              </div>
            ) : current && height > 0 ? (
              <VirtualDiffViewer
                className="min-w-0 text-xs"
                height={height}
                leftTitle="Previous"
                newValue={current.data}
                oldValue={previous?.data ?? {}}
                rightTitle="Current"
              />
            ) : null}
          </div>
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">
          Submit a message to see context snapshots.
        </p>
      )}
    </aside>
  );
}
