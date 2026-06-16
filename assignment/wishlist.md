# Agent Console Feature Requirements Wishlist — Feasibility Markup

## Backend Connectivity

- [x] Connect to the WebSocket endpoint: `ws://localhost:4747/ws`.
- [x] Support running against the server in normal mode.
- [x] Support running against the server in chaos mode.
- [x] Allow the client to interact with the server using user messages.
- [x] Use the server log endpoint, `GET /log`, as the source for protocol-compliance verification.
  - Decision: possible only for client→server protocol compliance such as `USER_MESSAGE`, `PONG`, `RESUME`, and `TOOL_ACK`. Not sufficient for UI render verification.
- [x] Use the health endpoint, `GET /health`, for backend status checks when needed.
- [x] Treat the backend as read-only; do not modify the agent server.

---

## WebSocket Protocol Compliance

- [x] Send `USER_MESSAGE` events with user-provided content.
- [x] Process every server message by its `type`.
- [x] Track server `seq` values as the authoritative event order.
- [x] Track the highest sequence number fully processed by the UI, not merely received by the socket.
- [x] Deduplicate repeated events with the same `seq`.
- [x] Buffer and reorder out-of-order messages before applying them to UI state.
- [x] Handle `ERROR` messages without crashing the app.
  - Decision: frontend can implement this, but the provided server does not appear to emit `ERROR` messages in the supplied scripts.
- [x] Preserve a consistent UI state when protocol events arrive quickly or unexpectedly.

---

## Streaming Chat

- [x] Render agent response tokens incrementally as they arrive.
- [x] Do not wait until `STREAM_END` to render the response.
- [x] Group tokens by `stream_id`.
- [x] Support multiple response streams if the protocol sends them.
  - Decision: frontend can support this generically, but the supplied server creates one `stream_id` per script run, so this is not demonstrable with the current backend.
- [x] Preserve exact token order.
- [x] Avoid duplicate text after replay, reconnection, or duplicate events.
- [x] Show completed streams clearly after `STREAM_END`.
  - Decision: possible when `STREAM_END` is actually sent. If chaos drops mid-stream and the server aborts the script, a final `STREAM_END` may never be produced.
- [x] Keep streamed text readable while events continue arriving.

---

## Tool Call Interruptions

- [x] When a `TOOL_CALL` arrives, freeze the current streamed text exactly where it is.
- [x] Display a tool call card below the frozen text.
- [x] Show the tool name on the tool card.
- [x] Show the tool arguments on the tool card.
- [x] Send `TOOL_ACK` for every rendered tool call.
- [ ] Send `TOOL_ACK` within 2 seconds of receiving/rendering the tool call.
  - Decision: frontend can attempt this, but it is not guaranteed under chaos because the server may buffer/reorder a `TOOL_CALL` before the browser receives it while the server-side ACK timeout is already running. The frontend cannot ACK an unseen call.
- [x] Keep the tool card visible while waiting for the result.
- [x] When `TOOL_RESULT` arrives, update the matching tool card with the result.
- [x] Resume token rendering from the exact paused point after the tool result.
- [x] Avoid flicker, reflow, layout shift, gaps, or duplicated text during pause/resume.
- [x] Support multiple sequential tool calls in one stream.
- [x] Render multiple tool calls as stacked cards, not overwritten cards.
- [x] Correctly link every `TOOL_RESULT` to its original `TOOL_CALL` using `call_id`.
- [x] Keep a tool card in a waiting state if the connection drops after `TOOL_CALL` but before `TOOL_RESULT`.
  - Decision: frontend can preserve the waiting state. It cannot force a missing `TOOL_RESULT` to be generated after reconnect.

---

## Agent Trace Timeline

- [x] Provide a collapsible side panel for the live protocol event timeline.
- [x] Show all relevant protocol events in real time:
  - [x] `TOKEN`
  - [x] `TOOL_CALL`
  - [x] `TOOL_RESULT`
  - [x] `CONTEXT_SNAPSHOT`
  - [x] `PING`
  - [x] `PONG`
  - [x] `ERROR`
    - Decision: implementable but not emitted by the supplied backend scripts.
  - [x] `STREAM_END`
- [x] Make the timeline scrollable.
- [x] Auto-update the timeline while events arrive.
- [x] Group consecutive token events instead of rendering one row per token.
- [x] Show grouped token summaries such as streamed token count and duration.
- [x] Allow grouped token rows to expand and show full streamed text.
- [x] Visually link related `TOOL_CALL` and `TOOL_RESULT` rows using `call_id`.
- [x] Let users click a timeline row to highlight the corresponding chat element.
- [x] Let users click a chat tool card or text segment to scroll/highlight the corresponding timeline entry.
- [x] Include event-type filters.
- [x] Include content search.
- [x] Keep timeline interactions responsive at high event rates.
- [x] Avoid visible UI jank when events arrive at 30+ per second.

---

## Context Inspector

- [x] Show the current agent context from `CONTEXT_SNAPSHOT` events.
- [x] Display snapshot `data` as a readable JSON/tree view.
- [x] Support syntax highlighting or otherwise clear object formatting.
- [x] Track snapshots by `context_id`.
- [x] When a later snapshot arrives for the same `context_id`, show the diff from the previous snapshot.
- [x] Highlight added keys.
- [x] Highlight removed keys.
- [x] Highlight changed values.
- [x] Keep large context snapshots usable, including 500KB+ payloads.
- [x] Prevent the context panel from freezing the chat UI.
- [x] Include snapshot history for each `context_id`.
- [x] Provide a history scrubber to move backward and forward through snapshots.
- [x] Show the appropriate diff for the selected historical snapshot.

---

## Reconnection and Recovery

- [x] Detect WebSocket connection drops.
- [x] Show a non-blocking reconnection indicator within 500ms of a drop.
- [x] Keep the chat panel usable during reconnection.
- [x] Allow users to scroll, read, and copy existing text while disconnected.
- [x] Retry reconnecting with exponential backoff:
  - [x] 500ms
  - [x] 1s
  - [x] 2s
  - [x] 4s
  - [x] cap at 10s
- [x] On successful reconnect, send `RESUME` as the first message.
- [x] Include `last_seq` in `RESUME`.
- [x] Set `last_seq` to the highest sequence number fully processed by the UI.
- [x] Process replayed events in correct sequence order.
- [x] Deduplicate replayed events that were already processed.
- [x] Stitch replayed events into existing UI state without visible jumps.
- [ ] Recover cleanly from drops during token streaming.
  - Decision: partial only. Frontend can reconnect and replay already-generated events, but the server aborts the active script on reconnect and does not generate the remaining stream.
- [ ] Recover cleanly from drops during a pending tool call.
  - Decision: partial only. Frontend can preserve the pending card, but if the server dropped before producing `TOOL_RESULT`, the result cannot be recovered from frontend code.
- [x] Preserve pending tool-card state across reconnection.
- [x] Render replayed `TOOL_RESULT` events into the existing matching tool card.
  - Decision: possible only if the `TOOL_RESULT` had already been generated and stored in server history before the disconnect.

---

## Heartbeats

- [x] Respond to every valid `PING` with a `PONG`.
- [x] Echo the exact `challenge` string in the `PONG`.
- [x] Send `PONG` within 3 seconds.
- [x] Handle corrupt `PING` messages with an empty `challenge` without crashing.
- [x] Avoid sending malformed heartbeat responses.
- [x] Keep heartbeat behavior visible in the trace timeline.

---

## Chaos Mode Survival

- [ ] Survive connection drops during active token streaming.
  - Decision: partial only. The UI can survive, but the original stream cannot truly continue because the backend aborts script execution on reconnect.
- [ ] Continue the response seamlessly after reconnecting.
  - Decision: impossible with fixed backend. `RESUME` replays only existing history; it does not resume the script.
- [x] Correctly reorder out-of-order messages.
- [x] Ignore duplicate messages without duplicating UI output.
- [x] Handle latency spikes without declaring false failure too early.
- [x] Handle burst delivery after latency spikes.
- [ ] Handle rapid tool calls in quick succession.
  - Decision: the frontend can be coded for this, but the provided scripts do not emit rapid back-to-back tool calls. The multi-tool script emits two sequential tool calls separated by tokens and tool result flow.
- [x] Render multiple pending or completed tool cards correctly.
  - Decision: completed sequential cards are demonstrable. Multiple concurrently pending cards are not emitted by this backend.
- [x] Handle oversized 500KB+ context snapshots without freezing.
- [x] Handle corrupt heartbeat events without crashing or disconnecting unnecessarily.
- [x] Keep the DOM consistent under chaos-mode failures.

---

## Required Screen Recording

- [x] Record a 3–5 minute chaos-mode demo.
- [x] Label each required scenario as it happens.
- [x] Show a connection drop mid-stream.
- [ ] Show recovery after the drop.
  - Decision: can show reconnect and replay recovery, but cannot show true continuation of the aborted stream.
- [x] Show out-of-order messages handled correctly.
- [ ] Show rapid tool calls handled correctly.
  - Decision: not truly supported by the fixed backend scripts. You can show two sequential tool calls, not rapid/concurrent tool calls.
- [x] Show an oversized context snapshot handled without UI freeze.
- [x] Show a corrupt heartbeat handled safely.
- [x] Include the recording link or `.mp4` in the final submission.
- [x] Treat the recording as mandatory for completion.

---

## App Framework and Technical Constraints

- [x] Build the frontend with Next.js 14 or newer.
- [x] Use the App Router.
- [x] Do not use the Pages Router.
- [x] Use TypeScript.
- [x] Enable strict TypeScript mode.
- [x] Avoid `any` except in one clearly documented escape-hatch file.
- [x] Do not use `@ts-ignore`.
- [x] Do not use AI chat component libraries.
- [x] Do not use AI SDK streaming helpers.
- [x] Do not use `vercel/ai`.
- [x] Do not use LangChain frontend packages.
- [x] Build the streaming renderer from scratch.
- [x] Choose any styling approach, but keep the app usable.
- [x] Prioritize correctness and clarity over visual polish.
- [x] Choose a state-management approach and document the rationale.

---

## Quality and Reliability Requirements

- [x] Keep protocol-handling logic separate from rendering logic.
- [x] Use a clear state-machine model for connection and stream state.
- [x] Avoid fragile one-off `useEffect` chains for core protocol behavior.
- [x] Add tests for non-trivial logic.
- [x] Test the sequence reorder buffer.
- [x] Test duplicate-event handling.
- [x] Test reversed-sequence delivery.
- [x] Test empty-buffer behavior.
- [x] Test JSON diff logic.
- [x] Ensure the final rendered text matches the server-sent stream.
  - Decision: possible for events actually sent or replayed. Not possible for unsent script continuation after a chaos drop.
- [x] Ensure the app builds successfully on a fresh install.
- [x] Ensure no manual environment setup is required beyond documented commands.

---

## README Requirements

- [x] Include a 2–3 sentence architecture summary.
- [x] Include a WebSocket connection state-machine diagram.
- [x] Show states such as connected, streaming, tool-call pending, reconnecting, and resuming.
- [x] Provide instructions for running the app against the agent server.
- [x] Include normal-mode screenshots showing:
  - [x] A streamed response with a tool call.
  - [x] The trace timeline.
  - [x] The context inspector showing a diff.

---

## DECISIONS.md Requirements

- [x] Explain the approach to `seq`-based ordering.
- [x] Explain the approach to deduplication.
- [x] Identify the data structure used for ordering/deduplication.
- [x] Explain how layout shift is prevented during tool-call interruptions.
- [x] Explain reconnection and state recovery.
- [x] Explain how the app tracks UI-consumed events versus socket-received events.
- [x] Describe what would change for 50 concurrent agent streams.
- [x] Describe what would change for responses 100x longer.
- [x] Document known limitations or incomplete work if the submission is partial.
- [x] Identify relevant protocol risks or race conditions where applicable.

Required limitation to document:
- The backend does not actually resume aborted scripts after reconnect.
- A chaos-buffered `TOOL_CALL` can make timely `TOOL_ACK` impossible from the frontend.
- `/log` cannot verify frontend render correctness.
- Multiple concurrent streams and multiple concurrent pending tool calls are not emitted by the supplied backend.

---

## Submission Package

- [x] Submit a public Git repository or tarball.
- [x] Include the complete Next.js application.
- [x] Ensure the app works with:
  - [x] `npm install`
  - [x] `npm run build`
  - [x] `npm run start`
- [x] Include `README.md`.
- [x] Include `DECISIONS.md`.
- [x] Include or link the chaos-mode screen recording.
- [x] Email the submission to `anuran@getalchemystai.com`.
- [x] CC `vedanta@getalchemystai.com`.
- [x] CC `khushi@getalchemystai.com`.
- [x] Use the required email subject format: `Full Stack AI Engineer Assignment  <Your Name>`.

---

## Evaluation Focus

- [x] Protocol compliance.
- [x] Timely `PONG` responses.
- [ ] Timely `TOOL_ACK` messages.
  - Decision: frontend can send ACK quickly after receipt, but cannot guarantee server-side timeliness under chaos buffering.
- [ ] Correct `RESUME` behavior after drops.
  - Decision: frontend can send correct `RESUME`; backend cannot fully resume generation after active-stream drops.
- [x] Correct deduplication behavior.
- [ ] Chaos-mode stability.
  - Decision: UI stability is possible; full stream continuity is not.
- [x] No crashes under stress.
- [ ] No lost messages.
  - Decision: no lost already-generated/replayed messages is possible. No lost unsent future messages is impossible after backend aborts the script.
- [x] No inconsistent DOM state.
- [x] No UI freeze during large payloads.
- [x] Smooth incremental streaming.
- [x] Correct tool-call pause/resume behavior.
  - Decision: possible when the tool result is actually delivered.
- [x] Strong TypeScript quality.
- [x] Clear state-machine architecture.
- [x] Meaningful tests for difficult logic.
- [x] Clear architectural reasoning in `DECISIONS.md`.

---

## Rejection Risks to Avoid

- [x] Missing chaos-mode screen recording.
- [x] App only works in normal mode.
- [x] App crashes in chaos mode.
- [x] Missed or late `PONG` responses.
- [ ] Missed or late `TOOL_ACK` messages.
  - Decision: avoidable in normal mode and most delivered-call cases, but not fully avoidable when chaos delays delivery of the `TOOL_CALL`.
- [ ] Incorrect `RESUME` messages.
  - Decision: frontend can send correct `RESUME`, but backend behavior still cannot provide true continuation.
- [x] Duplicate streamed text.
- [ ] Lost streamed text.
  - Decision: avoidable for received/replayed text; impossible for stream segments never generated after backend abort.
- [x] Tool cards overwritten instead of stacked.
- [x] UI layout shift during tool calls.
- [x] Scattered `any` usage.
- [x] Use of prohibited AI chat libraries.
- [x] Code that builds but cannot be explained.
- [x] Missing README requirements.
- [x] Missing DECISIONS.md reasoning.

---

## Stretch Goals / Impress Signals

- [ ] Make reconnection smooth enough that drops are only obvious from logs.
  - Decision: impossible for mid-stream generation drops because the backend does not continue the stream after reconnect.
- [x] Make the trace timeline genuinely useful for debugging.
- [x] Document protocol-level failure modes.
- [x] Call out the `TOOL_ACK` timeout race condition.
- [x] Add thorough unit tests for the sequence reorder buffer.
- [x] Add thorough unit tests for JSON diffing.
- [x] Handle edge cases beyond the assignment's minimum list.