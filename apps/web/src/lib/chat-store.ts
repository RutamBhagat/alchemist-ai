import type { ContextSnapshotMessage } from "../../../agent-server/src/types";
import { create } from "zustand";

export type ContextSnapshot = Pick<ContextSnapshotMessage, "context_id" | "data">;
export type ContextSlot = {
  snapshots: ContextSnapshot[];
};
