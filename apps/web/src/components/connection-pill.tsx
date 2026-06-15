import type { ConnectionStatus } from "@/lib/worker-events";

const statusStyles: Record<ConnectionStatus, string> = {
  idle: "border-muted bg-background text-muted-foreground",
  connecting: "border-yellow-300 bg-yellow-50 text-yellow-800",
  connected: "border-green-300 bg-green-50 text-green-800",
  streaming: "border-blue-300 bg-blue-50 text-blue-800",
  waiting: "border-orange-300 bg-orange-50 text-orange-800",
  reconnecting: "border-yellow-300 bg-yellow-50 text-yellow-800",
  disconnected: "border-red-300 bg-red-50 text-red-800",
};

type ConnectionPillProps = {
  status: ConnectionStatus;
};

export function ConnectionPill({ status }: ConnectionPillProps) {
  return (
    <div
      className={`fixed right-4 top-4 z-50 rounded-full border px-3 py-1 text-xs font-medium shadow-sm ${statusStyles[status]}`}
    >
      {status}
    </div>
  );
}
