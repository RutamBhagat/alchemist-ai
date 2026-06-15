import type { ServerMessage } from "../../../agent-server/src/types";

export function createSequenceGate() {
  let turn = 0;
  let expectedSeq: number | null = null;
  let possibleStarts: readonly number[] = [1];
  const pending = new Map<number, ServerMessage>();
  const processed = new Set<string>();

  return {
    startTurn(lastAppliedSeq: number) {
      turn++;
      expectedSeq = null;
      // Protocol docs say server seq is globally monotonic, so a new turn should continue at lastAppliedSeq + 1.
      // The provided mock server contradicts that and resets seq to 1 inside handleUserMessage().
      // We cannot detect reset with `seq < expectedSeq`: chaos duplicates can legitimately send an already-processed lower seq.
      // The only reliable boundary we control is sending USER_MESSAGE, so each new turn waits for whichever valid start appears first: mock-reset seq 1, or documented global next seq.
      possibleStarts = lastAppliedSeq === 0 ? [1] : [1, lastAppliedSeq + 1];
      pending.clear();
    },
    accept(message: ServerMessage) {
      const key = messageKey(turn, message.seq);
      if (processed.has(key) || pending.has(message.seq)) return [];

      pending.set(message.seq, message);

      if (expectedSeq === null) {
        const start = possibleStarts.find((seq) => pending.has(seq));
        if (start === undefined) return [];
        expectedSeq = start;
      }

      const ordered: ServerMessage[] = [];
      let next = pending.get(expectedSeq);
      while (next) {
        pending.delete(expectedSeq);
        processed.add(messageKey(turn, expectedSeq));
        ordered.push(next);
        expectedSeq++;
        next = pending.get(expectedSeq);
      }

      return ordered;
    },
  };
}

function messageKey(turn: number, seq: number) {
  return `${turn}:${seq}`;
}
