# Decisions

## TOOL_ACK timing

`TOOL_ACK` is sent from the worker as soon as a valid `TOOL_CALL` is received. The assignment's observable protocol requirement is that ACK arrives within 2 seconds, and keeping this in the worker makes that deadline independent of React scheduling.

I am intentionally not adding a worker -> main thread -> React render -> main thread -> worker confirmation loop. The socket and protocol state already live in the worker, and the main thread only receives a simple state update for the tool card. Adding a render-confirmation round trip would make the protocol path more complex without improving the server-observed behavior, while increasing the chance of missing the ACK deadline during UI work.

The assignment notes that the provided server must not be modified and hints that `TOOL_ACK` timeout behavior contains a protocol race. The observed failure mode is consistent with that server-side race: a `TOOL_CALL` can be recorded in replay history before the server registers the pending ACK wait. If the client sends `RESUME` during a chaos latency spike, the replay can deliver that `TOOL_CALL`; the worker immediately ACKs it; the server has no pending ACK yet and logs the ACK as `unexpected`. When the original send path later registers the pending ACK, the worker correctly does not ACK the same `call_id` a second time, so the server eventually logs `TOOL_ACK_TIMEOUT`.

This is not fixable purely in the frontend without weakening another protocol requirement. Delaying ACKs would make the 2 second ACK deadline less reliable and still would not prove the server has registered its pending ACK. Sending repeated ACKs for the same `call_id` would turn deduplication into noisy protocol traffic and can create additional `unexpected` log entries after a normal ACK has already been accepted. ACKing only after React confirms paint would also be slower and still race with replayed messages. Given those constraints, the most reasonable client behavior is to ACK each distinct `TOOL_CALL` immediately in the worker, dedupe by `call_id`, and document that any `unexpected` plus later timeout for the same `call_id` can be caused by the server replay/ACK-registration race rather than a missed client ACK.

## Mid-stream reconnect limitation

The client sends `RESUME(last_seq)` immediately after reconnect and replays any server-generated events after the last fully applied sequence number. This recovers events already stored in server history.

The mock backend does not resume aborted script execution after a WebSocket reconnect. Therefore, if the backend drops before generating the rest of a stream or a pending `TOOL_RESULT`, the frontend cannot reconstruct those missing future events without violating the protocol. The UI preserves already-rendered text/tool cards and marks the response as interrupted rather than resending the user message or fabricating continuation.
