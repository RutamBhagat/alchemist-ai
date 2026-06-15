import type { ServerMessage } from "../../../agent-server/src/types";

export function createSequenceGate() {
  let expectedSeq: number | null = null;
  const pending = new Map<number, ServerMessage>();
  const processed = new Set<number>();

  return {
    startTurn() {
      expectedSeq = 1;
      pending.clear();
      processed.clear();
    },
    accept(message: ServerMessage) {
      if (message.seq === 0) {
        expectedSeq = 1;
        pending.clear();
        processed.clear();
        return [];
      }

      if (processed.has(message.seq) || pending.has(message.seq)) return [];

      pending.set(message.seq, message);

      if (expectedSeq === null) {
        expectedSeq = 1;
      }

      const ordered: ServerMessage[] = [];
      let next = pending.get(expectedSeq);
      while (next) {
        pending.delete(expectedSeq);
        processed.add(expectedSeq);
        ordered.push(next);
        expectedSeq++;
        next = pending.get(expectedSeq);
      }

      return ordered;
    },
  };
}
