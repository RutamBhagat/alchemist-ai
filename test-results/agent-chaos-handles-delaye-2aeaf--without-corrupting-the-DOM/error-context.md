# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: agent-chaos.spec.ts >> handles delayed response, corrupt frames, and out-of-order replay without corrupting the DOM
- Location: apps/web/e2e/agent-chaos.spec.ts:289:5

# Error details

```
Error: locator.fill: Error: strict mode violation: getByRole('textbox') resolved to 2 elements:
    1) <input value="" data-slot="input" id="base-ui-_R_j6atmlb_" placeholder="Search trace" class="h-8 w-full min-w-0 rounded-none border border-input bg-transparent px-2.5 py-1 text-xs transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-xs file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/…/> aka getByRole('textbox', { name: 'Search trace' })
    2) <textarea data-slot="textarea" class="flex field-sizing-content w-full rounded-none border border-input bg-transparent px-2.5 py-2 text-xs transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive/20 md:text-xs dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:bord…></textarea> aka locator('textarea')

Call log:
  - waiting for getByRole('textbox')

```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e3]:
    - generic [ref=e5]:
      - generic [ref=e6]:
        - generic [ref=e7]:
          - combobox [ref=e8]:
            - generic [ref=e9]: all
            - img: ▼
          - textbox [ref=e10]: all
        - textbox "Search trace" [ref=e11]
      - button "Toggle Sidebar" [ref=e14]
    - main [ref=e15]:
      - generic [ref=e16]:
        - generic [ref=e17]: idle
        - button "Toggle debug mode" [ref=e18]:
          - img
          - generic [ref=e19]: Toggle Sidebar
        - generic [ref=e23]:
          - textbox [ref=e24]
          - button [disabled]:
            - img
    - generic [ref=e26]:
      - heading "Context" [level=2] [ref=e28]
      - paragraph [ref=e31]: Submit a message to see context snapshots.
      - button "Toggle Sidebar" [ref=e32]
  - region "Notifications alt+T"
```

# Test source

```ts
  79  |     if (!contentType.includes("javascript")) {
  80  |       await route.fulfill({ response });
  81  |       return;
  82  |     }
  83  | 
  84  |     const body = await response.text();
  85  |     if (!body.includes("ws://localhost:4747/ws")) {
  86  |       await route.fulfill({ response, body });
  87  |       return;
  88  |     }
  89  | 
  90  |     await route.fulfill({
  91  |       response,
  92  |       body: `${controlledWebSocketShim()}\n${body}`,
  93  |     });
  94  |   });
  95  | }
  96  | 
  97  | function controlledWebSocketShim() {
  98  |   return `
  99  | (() => {
  100 |   const sockets = [];
  101 | 
  102 |   class ControlledWebSocket {
  103 |     static CONNECTING = 0;
  104 |     static OPEN = 1;
  105 |     static CLOSING = 2;
  106 |     static CLOSED = 3;
  107 | 
  108 |     constructor(url) {
  109 |       this.url = url;
  110 |       this.readyState = ControlledWebSocket.CONNECTING;
  111 |       this.onclose = null;
  112 |       this.onerror = null;
  113 |       this.onmessage = null;
  114 |       this.onopen = null;
  115 |       this.sent = [];
  116 |       this.socketIndex = sockets.length;
  117 |       sockets.push(this);
  118 |       self.postMessage({
  119 |         kind: "__test_socket_opened",
  120 |         socketIndex: this.socketIndex,
  121 |         url,
  122 |       });
  123 |       queueMicrotask(() => this.__open());
  124 |     }
  125 | 
  126 |     close() {
  127 |       this.readyState = ControlledWebSocket.CLOSED;
  128 |     }
  129 | 
  130 |     send(payload) {
  131 |       const parsed = JSON.parse(payload);
  132 |       this.sent.push(parsed);
  133 |       self.postMessage({
  134 |         kind: "__test_socket_sent",
  135 |         socketIndex: this.socketIndex,
  136 |         payload: parsed,
  137 |       });
  138 |     }
  139 | 
  140 |     __open() {
  141 |       if (this.readyState !== ControlledWebSocket.CONNECTING) return;
  142 |       this.readyState = ControlledWebSocket.OPEN;
  143 |       this.onopen?.();
  144 |     }
  145 | 
  146 |     __receive(message) {
  147 |       if (this.readyState !== ControlledWebSocket.OPEN) return;
  148 |       this.onmessage?.({ data: JSON.stringify(message) });
  149 |     }
  150 | 
  151 |     __receiveRaw(data) {
  152 |       if (this.readyState !== ControlledWebSocket.OPEN) return;
  153 |       this.onmessage?.({ data });
  154 |     }
  155 | 
  156 |     __closeFromServer() {
  157 |       if (this.readyState === ControlledWebSocket.CLOSED) return;
  158 |       this.readyState = ControlledWebSocket.CLOSED;
  159 |       this.onclose?.();
  160 |     }
  161 |   }
  162 | 
  163 |   self.WebSocket = ControlledWebSocket;
  164 |   self.addEventListener("message", (event) => {
  165 |     const command = event.data?.__testWebSocket;
  166 |     if (!command) return;
  167 | 
  168 |     const socket = sockets[command.socketIndex ?? sockets.length - 1];
  169 |     if (!socket) return;
  170 | 
  171 |     if (command.op === "receive") socket.__receive(command.message);
  172 |     if (command.op === "receiveRaw") socket.__receiveRaw(command.data);
  173 |     if (command.op === "close") socket.__closeFromServer();
  174 |   });
  175 | })();`;
  176 | }
  177 | 
  178 | async function sendPrompt(page: Page, content = "run tool") {
> 179 |   await page.getByRole("textbox").fill(content);
      |                                   ^ Error: locator.fill: Error: strict mode violation: getByRole('textbox') resolved to 2 elements:
  180 |   await page.getByRole("textbox").press("Enter");
  181 |   await waitForSent(page, "USER_MESSAGE");
  182 | }
  183 | 
  184 | async function receive(page: Page, message: ServerMessage, socketIndex?: number) {
  185 |   await page.evaluate(
  186 |     ({ message, socketIndex }) => {
  187 |       window.__agentTest!.postToWorker({ op: "receive", message, socketIndex });
  188 |     },
  189 |     { message, socketIndex },
  190 |   );
  191 | }
  192 | 
  193 | async function receiveRaw(page: Page, data: string, socketIndex?: number) {
  194 |   await page.evaluate(
  195 |     ({ data, socketIndex }) => {
  196 |       window.__agentTest!.postToWorker({ op: "receiveRaw", data, socketIndex });
  197 |     },
  198 |     { data, socketIndex },
  199 |   );
  200 | }
  201 | 
  202 | async function closeSocket(page: Page, socketIndex?: number) {
  203 |   await page.evaluate((socketIndex) => {
  204 |     window.__agentTest!.postToWorker({ op: "close", socketIndex });
  205 |   }, socketIndex);
  206 | }
  207 | 
  208 | async function socketEvents(page: Page) {
  209 |   return page.evaluate(() => window.__agentTest?.socketEvents ?? []);
  210 | }
  211 | 
  212 | async function sentMessages(page: Page, type?: string) {
  213 |   const events = await socketEvents(page);
  214 |   return events
  215 |     .filter((event): event is Extract<SocketEvent, { kind: "__test_socket_sent" }> =>
  216 |       event.kind === "__test_socket_sent",
  217 |     )
  218 |     .map((event) => event.payload)
  219 |     .filter((payload) => {
  220 |       if (!type) return true;
  221 |       return (
  222 |         typeof payload === "object" &&
  223 |         payload !== null &&
  224 |         "type" in payload &&
  225 |         payload.type === type
  226 |       );
  227 |     });
  228 | }
  229 | 
  230 | async function waitForSent(page: Page, type: string) {
  231 |   await expect
  232 |     .poll(async () => sentMessages(page, type), { timeout: 5_000 })
  233 |     .toHaveLength(1);
  234 | }
  235 | 
  236 | test.beforeEach(async ({ page }) => {
  237 |   await installControlledWorkerWebSocket(page);
  238 |   await page.goto("http://127.0.0.1:3001/");
  239 | });
  240 | 
  241 | test("recovers when the socket drops after a tool call but before its result", async ({ page }) => {
  242 |   await sendPrompt(page);
  243 | 
  244 |   await receive(page, { type: "TOKEN", seq: 1, stream_id: "s", text: "Checking " });
  245 |   await receive(page, {
  246 |     type: "TOOL_CALL",
  247 |     seq: 2,
  248 |     stream_id: "s",
  249 |     call_id: "c1",
  250 |     tool_name: "lookup",
  251 |     args: { query: "x" },
  252 |   });
  253 | 
  254 |   await expect(page.getByText("Checking")).toBeVisible();
  255 |   await expect(page.getByText("lookup")).toBeVisible();
  256 |   await expect
  257 |     .poll(async () => sentMessages(page, "TOOL_ACK"), { timeout: 2_000 })
  258 |     .toEqual([{ type: "TOOL_ACK", call_id: "c1" }]);
  259 | 
  260 |   await closeSocket(page);
  261 |   await expect
  262 |     .poll(async () => sentMessages(page, "RESUME"), { timeout: 2_000 })
  263 |     .toEqual([{ type: "RESUME", last_seq: 2 }]);
  264 | 
  265 |   await receive(page, {
  266 |     type: "TOOL_CALL",
  267 |     seq: 2,
  268 |     stream_id: "s",
  269 |     call_id: "c1",
  270 |     tool_name: "lookup",
  271 |     args: { query: "replayed" },
  272 |   });
  273 |   await receive(page, {
  274 |     type: "TOOL_RESULT",
  275 |     seq: 3,
  276 |     stream_id: "s",
  277 |     call_id: "c1",
  278 |     result: { ok: true },
  279 |   });
```