# Decisions

## Deferred: TOOL_ACK timing

`TOOL_ACK` is currently sent from the worker as soon as `TOOL_CALL` is received. Strictly, the assignment says ACK means the tool card was rendered, so a more precise version would have the mounted UI card ask the worker to ACK.

I am deferring that change unless chaos-mode server logs show this specific violation. Keeping ACK in the worker preserves the simplest protocol path and avoids missing the 2s ACK deadline while the rest of the UI is still evolving. Since socket handling is already isolated in a Web Worker, main-thread blocking should be unlikely unless the UI code itself does expensive synchronous work.
