# Decisions

## Architecture split

The WebSocket protocol loop lives in `apps/web/src/lib/agent.worker.ts`, not in React components. The worker owns the socket, heartbeat responses, `RESUME`, sequence ordering, reconnect backoff, and per-turn protocol state. React receives typed worker events and updates the Zustand store.

`TOOL_ACK` is intentionally a split path. The worker receives and orders `TOOL_CALL`, posts a typed event to the UI, and waits for the page to send a `tool_rendered` confirmation before the worker sends `TOOL_ACK` over the socket. This keeps the socket write in the worker while making the ACK depend on the tool card becoming part of the rendered UI state.

This split is deliberate. `PONG` should never depend on React scheduling because it is a heartbeat response with no UI requirement. `TOOL_ACK`, however, is tied to whether the tool call is visible to the user, so the implementation accepts the additional main-thread round trip to satisfy the stricter render-confirmation interpretation.

The main app shell is split between `apps/web/src/app/page.tsx` and `apps/web/src/app/home-client.tsx`. It is responsible for rendering state, trace batching, context selection, user-triggered sends, render-confirming tool cards, and automatic interrupted-turn recovery. It does not parse raw WebSocket messages.

## State data model

The primary chat state is intentionally small:

- `entryOrder`: ordered user entries and agent-stream entries.
- `userMessagesById`: user messages keyed by stable user target id.
- `streamsById`: agent response streams keyed by protocol `stream_id`.
- `toolsByCallId`: tool calls keyed by the UI-visible, attempt-scoped `call_id`.
- `contexts`: a map from `context_id` to context snapshot history.
- `selectedContextId`: the currently inspected context.

A user send appends only a user entry. The first token, tool call, or stream end for a protocol `stream_id` creates that stream entry on demand. Incoming tokens append to the stream identified by `stream_id`, not to whichever agent response happens to be last in the rendered list.

Each stream contains ordered parts. Consecutive tokens for the same text target are merged into one stable text part instead of creating one React row per token. A tool call freezes the current text part for that stream and appends a tool part keyed by `call_id`; the next token for the same stream creates a new text part after the tool card. Tool results patch `toolsByCallId[call_id]` after validating that the result belongs to the same `stream_id`.

This model avoids cross-stream corruption when tokens, tool calls, and tool results from different streams are interleaved. It also avoids expensive full-message rewrites while keeping enough structure for target selection, trace linking, tool cards, and context inspection.

The worker preserves the server's `stream_id` and `seq` in all UI-facing token/tool/result/end events. It attempt-scopes UI ids so interrupted/retried attempts do not collide with replayed server ids. For ACK, the UI returns the attempt-scoped call id and the worker maps it back to the original server `call_id` before sending `TOOL_ACK`.

## Sequence ordering and deduplication

Incoming server events are not applied directly. The worker passes sequenced events through `SequenceGate` first.

`SequenceGate` keeps:

- `expectedSeq`: the next sequence number allowed to apply.
- `pending`: buffered future events that arrived out of order.
- `processed`: sequence numbers that were already emitted.

Messages with a sequence lower than `expectedSeq`, or already present in `processed`/`pending`, are ignored. Messages above `expectedSeq` are buffered until the gap is filled. Once the expected sequence arrives, the gate drains all contiguous buffered events in order.

`PING` is handled before this ordering gate. A heartbeat should be answered immediately with an exact `PONG` echo even if the surrounding stream is reordered or delayed.

## TOOL_ACK timing

`TOOL_ACK` is not sent on raw socket receipt. The worker waits until the `TOOL_CALL` has passed schema validation, sequence ordering, and UI dispatch. The page then observes the resulting `toolsByCallId` state in a React effect and posts `{ type: "tool_rendered", client_call_id }` back to the worker. Effects run after React has committed the render, so this is used as the practical signal that the tool card is now represented in UI state.

After that confirmation, the worker sends exactly one `TOOL_ACK` for the original server `call_id`. Duplicate `TOOL_CALL` deliveries are ignored for ACK purposes after the first confirmed ACK.

This is intentionally slower than ACKing directly in the worker. The tradeoff is that the server-visible ACK now corresponds to a tool card reaching the rendered UI path, which is the stricter interpretation of the assignment requirement. The risk is that severe React main-thread work, a sequence gap before the `TOOL_CALL`, or a disconnected socket can delay the ACK and trigger a server timeout. The implementation accepts that risk because ACKing before render would make `/log` look better while failing to prove the tool card actually appeared.

The provided server must not be modified and has a replay/ACK-registration race. A `TOOL_CALL` can be recorded in replay history before the server registers the pending ACK wait. If the client sends `RESUME` during a chaos latency spike, replay can deliver that `TOOL_CALL`; the UI can render it and confirm it; the worker can ACK it; and the server can still log the ACK as `unexpected` if no pending ACK is registered yet.

This is not fully fixable purely in the frontend. Delaying ACK until render improves UI correctness but cannot prove the server has registered its pending ACK. Sending repeated ACKs for the same `call_id` would turn deduplication into noisy protocol traffic and can create additional `unexpected` log entries after a normal ACK has already been accepted. The client therefore ACKs each distinct rendered tool call once, maps the UI id back to the server `call_id`, and documents that replay can still create misleading `unexpected`/timeout patterns.

## UI-consumed sequence tracking approximation

The worker treats an event as applied once it has passed schema validation, sequence ordering/deduplication, and has been posted to the main thread for the corresponding UI state update. In the strictest interpretation, `last_seq` would advance only after React has committed the rendered DOM update.

This is still a practical approximation for general stream recovery. The protocol state, ordering buffer, reconnection logic, and heartbeat handling all live in the Web Worker, while the main thread receives small typed events that synchronously update the Zustand store. The rendering path is kept lightweight: streamed text is appended to stable message parts, tool calls/results patch existing state by target id or `call_id`, the trace list is batched and virtualized, and large context rendering is isolated in the context panel.

`TOOL_ACK` is the exception to this approximation. For tool calls, the page sends an explicit post-render `tool_rendered` confirmation back to the worker before ACK. The app does not add the same confirmation loop for every token/context/end event because doing so would add high-frequency backpressure to the protocol loop.

The tradeoff is that a browser crash, tab termination, or catastrophic React runtime failure between worker `postMessage` and commit could make `last_seq` slightly ahead of what was visibly painted for non-tool events. The app accepts that risk because per-event DOM commit acknowledgements would add latency, scheduling coupling, and backpressure to streaming.

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

The frontend cannot guarantee `TOOL_ACK` within 2 seconds if the server itself delays, buffers, or replays a `TOOL_CALL` after the server-side timeout has already expired. With render-confirmed ACKs, the frontend also depends on the `TOOL_CALL` reaching the ordered UI path and React running the confirmation effect promptly.

The frontend cannot continue backend script execution after the supplied server aborts it on reconnect. The automatic latest-user-message retry is a pragmatic fallback, not protocol-level continuation.

Automatic retry can regenerate a response that differs from the interrupted response if the backend script is nondeterministic or time-sensitive. For the mock assignment backend this is acceptable; for a real agent this would require idempotency keys, server-side durable runs, or explicit user confirmation before replaying side-effecting tool calls.

Automatic interrupted-turn retry intentionally does not clear later chat state, trace rows, tools, or context snapshots. This preserves diagnostic state, but it can leave an interrupted partial attempt visible alongside the regenerated attempt.

All state is in memory. A full tab reload loses chat, trace, and context state. Persistent session recovery is outside the frontend-only constraints of this assignment.

## Chaos-mode TOOL_ACK log interpretation

In chaos mode, the server can delay, buffer, or reorder a `TOOL_CALL` before the browser receives it. The server-side ACK timeout may continue running during that delay. If the timeout expires before the `TOOL_CALL` is delivered to the client, ordered, rendered, and confirmed, the server logs `TOOL_ACK_TIMEOUT`.

When the delayed `TOOL_CALL` eventually reaches the client, the worker waits for the UI render-confirmation effect and then sends `TOOL_ACK`. At that point, however, the server may have already removed the pending ACK entry, so the later ACK can be logged as `unexpected`.

The observed chaos-mode pattern can therefore be:

```json
{ "type": "TOOL_ACK_TIMEOUT", "verdict": "violation" }
{ "type": "TOOL_ACK", "verdict": "unexpected" }
```

This does not necessarily mean the frontend ignored the tool call. It can mean the frontend received/rendered the tool call only after the server had already timed out or after replay delivered it before ACK registration completed.
