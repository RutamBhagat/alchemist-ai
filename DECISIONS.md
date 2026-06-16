# Decisions

## Architecture split

The WebSocket protocol loop lives in `apps/web/src/lib/agent.worker.ts`, not in React components. The worker owns the socket, heartbeat responses, `TOOL_ACK`, `RESUME`, sequence ordering, reconnect backoff, and per-turn protocol state. React receives typed worker events and updates the Zustand store.

This split is deliberate. Protocol messages such as `PONG` and `TOOL_ACK` should not depend on React scheduling, rendering, virtualization, or expensive JSON diff rendering. The UI can be busy without slowing down the server-visible protocol path.

The main app shell is split between `apps/web/src/app/page.tsx` and `apps/web/src/app/home-client.tsx`. It is responsible for rendering state, trace batching, context selection, user-triggered sends, and automatic interrupted-turn recovery. It does not parse raw WebSocket messages.

## State data model

The primary chat state is intentionally small:

- `entryOrder`: ordered user entries and agent-stream entries.
- `userMessagesById`: user messages keyed by stable user target id.
- `streamsById`: agent response streams keyed by protocol `stream_id`.
- `toolsByCallId`: tool calls keyed by protocol `call_id`.
- `contexts`: a map from `context_id` to context snapshot history.
- `selectedContextId`: the currently inspected context.

A user send appends only a user entry. The first token, tool call, or stream end for a protocol `stream_id` creates that stream entry on demand. Incoming tokens append to the stream identified by `stream_id`, not to whichever agent response happens to be last in the rendered list.

Each stream contains ordered parts. Consecutive tokens for the same text target are merged into one stable text part instead of creating one React row per token. A tool call freezes the current text part for that stream and appends a tool part keyed by `call_id`; the next token for the same stream creates a new text part after the tool card. Tool results patch `toolsByCallId[call_id]` after validating that the result belongs to the same `stream_id`.

This model avoids cross-stream corruption when tokens, tool calls, and tool results from different streams are interleaved. It also avoids expensive full-message rewrites while keeping enough structure for target selection, trace linking, tool cards, and context inspection.

The worker preserves the server's `stream_id` and `seq` in all UI-facing token/tool/result/end events. It keeps text targets per stream and tracks active streams independently, so one `STREAM_END` only completes the addressed stream.

## Sequence ordering and deduplication

Incoming server events are not applied directly. The worker passes sequenced events through `SequenceGate` first.

`SequenceGate` keeps:

- `expectedSeq`: the next sequence number allowed to apply.
- `pending`: buffered future events that arrived out of order.
- `processed`: sequence numbers that were already emitted.

Messages with a sequence lower than `expectedSeq`, or already present in `processed`/`pending`, are ignored. Messages above `expectedSeq` are buffered until the gap is filled. Once the expected sequence arrives, the gate drains all contiguous buffered events in order.

`PING` is handled before this ordering gate. A heartbeat should be answered immediately with an exact `PONG` echo even if the surrounding stream is reordered or delayed.

## TOOL_ACK timing

`TOOL_ACK` is sent from the worker as soon as a valid `TOOL_CALL` is received. The assignment's observable protocol requirement is that ACK arrives within 2 seconds, and keeping this in the worker makes that deadline independent of React scheduling.

The app intentionally does not add a worker -> main thread -> React render -> main thread -> worker confirmation loop before ACKing. The socket and protocol state already live in the worker, and the main thread only receives a simple state update for the tool card. Adding a render-confirmation round trip would make the protocol path more complex without improving the server-observed behavior, while increasing the chance of missing the ACK deadline during UI work.

Each distinct `call_id` is ACKed once per turn. Duplicate `TOOL_CALL` deliveries are ignored for ACK purposes after the first ACK.

The provided server must not be modified and has a replay/ACK-registration race. A `TOOL_CALL` can be recorded in replay history before the server registers the pending ACK wait. If the client sends `RESUME` during a chaos latency spike, replay can deliver that `TOOL_CALL`; the worker immediately ACKs it; the server has no pending ACK yet and logs the ACK as `unexpected`. When the original send path later registers the pending ACK, the worker correctly does not ACK the same `call_id` a second time, so the server can later log `TOOL_ACK_TIMEOUT`.

This is not fixable purely in the frontend without weakening another protocol requirement. Delaying ACKs would make the 2 second ACK deadline less reliable and still would not prove the server has registered its pending ACK. Sending repeated ACKs for the same `call_id` would turn deduplication into noisy protocol traffic and can create additional `unexpected` log entries after a normal ACK has already been accepted. ACKing only after React confirms paint would also be slower and still race with replayed messages. Given those constraints, the most reasonable client behavior is to ACK each distinct `TOOL_CALL` immediately in the worker, dedupe by `call_id`, and document that any `unexpected` plus later timeout for the same `call_id` can be caused by the server replay/ACK-registration race rather than a missed client ACK.

## UI-consumed sequence tracking approximation

The worker treats an event as applied once it has passed schema validation, sequence ordering/deduplication, and has been posted to the main thread for the corresponding UI state update. In the strictest interpretation, `last_seq` would advance only after React has committed the rendered DOM update. The app intentionally does not add that main-thread acknowledgement loop.

This is a practical approximation. The protocol state, ordering buffer, reconnection logic, heartbeat handling, and ACK path all live in the Web Worker, while the main thread receives small typed events that synchronously update the Zustand store. The rendering path is kept lightweight: streamed text is appended to stable message parts, tool calls/results patch existing state by target id or `call_id`, the trace list is batched and virtualized, and large context rendering is isolated in the context panel. Under these constraints, the gap between worker `postMessage` and visible UI application is not a useful recovery boundary for this assignment.

The tradeoff is that a browser crash, tab termination, or catastrophic React runtime failure between `postMessage` and commit could make `last_seq` slightly ahead of what was visibly painted. The app accepts that risk because adding per-event DOM commit acknowledgements would add latency, scheduling coupling, and backpressure to the protocol loop, making `PONG`, `TOOL_ACK`, and chaos-mode recovery less reliable in the common case.

## Reconnect and recovery

On disconnect, the worker reconnects with exponential backoff. On open, it sends `RESUME(last_seq)` before treating the socket as ready for new work. This recovers events that the server already generated and stored in history.

The mock backend aborts active script execution when a WebSocket reconnect/new connection replaces the current socket. It does not resume the aborted script after `RESUME`. Therefore, `RESUME(last_seq)` can replay existing history but cannot force the backend to generate missing future tokens or a missing `TOOL_RESULT`.

The UI handles this in two layers:

1. First, use protocol resume/replay. Already-generated events after `last_seq` are applied in order by the worker.
2. If the worker determines the active turn cannot continue and emits `turn_interrupted`, the page automatically finds the latest user message and sends the same text as a new attempt through the normal worker send path.

This automatic retry is intentionally not called a true stream continuation. It is a user-message replay fallback for a backend that cannot continue an aborted script. The fallback does not truncate chat state, clear trace rows, clear context snapshots, remove streams/tools, or expose a manual undo-arrow retry button. The interrupted attempt remains visible for debugging, and the regenerated attempt is appended as new stream/tool/context events under a fresh attempt id.

The automatic path bypasses the normal `serverResponding` guard because it runs only after the worker has declared the prior turn interrupted.

## Trace UI

Trace events are appended separately from chat state. The worker emits trace rows for inbound and outbound protocol messages, including `USER_MESSAGE`, `RESUME`, `PONG`, `TOOL_ACK`, tokens, tool calls/results, errors, and stream end.

The page batches trace updates with `requestAnimationFrame` so streaming tokens do not force one React state update per protocol event. The trace sidebar groups related rows, including consecutive tokens and tool-call/ACK/result flows, and virtualizes the list so long streams remain usable.

When the retry fallback runs, existing trace rows are kept. A local `RETRY_STARTED` system trace is appended so the recovery attempt is visible without hiding the interrupted attempt that led to it.

## Context rendering and diffing

Context snapshots are stored by `context_id`. Every new snapshot is appended to that context's history, and the selected context defaults to the most recent snapshot.

The context sidebar supports direct tree viewing and diff viewing between snapshots. The implementation delegates large JSON rendering and virtualized diff rendering to UI libraries instead of maintaining a custom JSON diff algorithm in application state. This keeps the protocol/client logic focused on snapshot collection, selection, and stable rendering.

Testing note: because JSON diff rendering is delegated to `virtual-react-json-diff`, this codebase does not maintain a custom JSON diff function to unit-test. The meaningful local test surface is snapshot collection/history, context selection, and the component wiring to the delegated diff viewer; the third-party diff algorithm itself is intentionally not re-tested here.

## Layout and rendering stability

The UI avoids layout churn during streaming by appending tokens into the last compatible text part instead of creating a new component for every token. Tool calls are rendered as stable cards keyed by `call_id`, and results patch those existing cards instead of inserting unrelated rows.

The chat column, trace sidebar, and context sidebar are independently scrollable. Large trace/context panels do not push chat messages around. Trace and context views use virtualization or delegated virtualized components where large data can appear.

## Scaling assumptions

The design is intended to tolerate many streams and long responses by keeping protocol work in the worker, batching trace rows, merging consecutive token chunks, and avoiding raw per-token DOM nodes.

For 50 active or historical streams, the main constraint would be UI memory and trace volume rather than WebSocket parsing. The current implementation keeps ordered entry ids plus stream/tool maps and uses stable part merging, but it does not yet implement persistent storage or pruning.

For responses 100x longer than the normal demo cases, the current approach remains structurally safe because tokens are merged into text parts and traces are virtualized. The main risk is memory growth from retaining all trace events and all context snapshots in memory for the session. A production version should add trace pruning/export, context snapshot limits, and persisted resumable session state.

## Known limitations and risks

The frontend cannot guarantee `TOOL_ACK` within 2 seconds if the server itself delays, buffers, or replays a `TOOL_CALL` after the server-side timeout has already expired. The worker ACKs immediately after receipt, but it cannot ACK a message it has not yet received.

The frontend cannot continue backend script execution after the supplied server aborts it on reconnect. The automatic latest-user-message retry is a pragmatic fallback, not protocol-level continuation.

Automatic retry can regenerate a response that differs from the interrupted response if the backend script is nondeterministic or time-sensitive. For the mock assignment backend this is acceptable; for a real agent this would require idempotency keys, server-side durable runs, or explicit user confirmation before replaying side-effecting tool calls.

Automatic interrupted-turn retry intentionally does not clear later chat state, trace rows, tools, or context snapshots. This preserves diagnostic state, but it can leave an interrupted partial attempt visible alongside the regenerated attempt.

All state is in memory. A full tab reload loses chat, trace, and context state. Persistent session recovery is outside the frontend-only constraints of this assignment.

## Chaos-mode TOOL_ACK log interpretation

In chaos mode, the server can delay, buffer, or reorder a `TOOL_CALL` before the browser receives it. The server-side ACK timeout may continue running during that delay. If the timeout expires before the `TOOL_CALL` is delivered to the client, the server logs `TOOL_ACK_TIMEOUT`.

When the delayed `TOOL_CALL` eventually reaches the client, the worker still sends `TOOL_ACK` immediately, because that is the only protocol-correct action available after receiving a valid tool call. At that point, however, the server may have already removed the pending ACK entry, so the later ACK is logged as `unexpected`.

The observed chaos-mode pattern can therefore be:

```json
{ "type": "TOOL_ACK_TIMEOUT", "verdict": "violation" }
{ "type": "TOOL_ACK", "verdict": "unexpected" }
```

This does not necessarily mean the frontend waited too long after receiving the tool call. It can mean the frontend received the tool call only after the server had already timed out or after replay delivered it before ACK registration completed.
