# Decisions

## TOOL_ACK timing

`TOOL_ACK` is sent from the worker as soon as a valid `TOOL_CALL` is received. The assignment's observable protocol requirement is that ACK arrives within 2 seconds, and keeping this in the worker makes that deadline independent of React scheduling.

I am intentionally not adding a worker -> main thread -> React render -> main thread -> worker confirmation loop. The socket and protocol state already live in the worker, and the main thread only receives a simple state update for the tool card. Adding a render-confirmation round trip would make the protocol path more complex without improving the server-observed behavior, while increasing the chance of missing the ACK deadline during UI work.
