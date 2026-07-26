# `@questpie/crdt-yjs`

Yjs text engines for QUESTPIE collaborative aggregates.

Install the package beside `questpie`, configure the server engine in
`runtimeConfig()`, and configure the browser engine in `createClient()`:

```ts
import { yjsServerEngine } from "@questpie/crdt-yjs/server";
import { runtimeConfig } from "questpie/app";

export default runtimeConfig({
	db: { url: process.env.DATABASE_URL! },
	crdt: {
		namespace: "my-app",
		engines: { text: yjsServerEngine() },
	},
});
```

```ts
import { yjsClientEngine } from "@questpie/crdt-yjs/client";
import { createClient } from "questpie/client";
import type { AppConfig } from "#questpie";

export const client = createClient<AppConfig>({
	baseURL: window.location.origin,
	crdt: { engines: { text: yjsClientEngine() } },
});
```

The public model is QUESTPIE's typed collaborative aggregate, not a Yjs
document. Yjs remains the replaceable text engine behind the generated API.
QUESTPIE carries bytes over its normal Fetch handler and reuses the client's
existing SSE or Pusher realtime connection for opaque dirty hints. No
adapter-specific WebSocket host is required.

Text fields also expose `fields.<name>.anchors.create()` and `.resolve()`.
QUESTPIE wraps Yjs relative positions in a bounded, lifecycle-bound opaque
token shared by the browser and server engines. Normal edits and compaction
preserve it; field or owner recreation detaches it. Applications must store the
token opaquely and enforce their own annotation/comment policy.

The server engine uses a bounded, in-process worker-thread pool to isolate
untrusted CRDT decoding and merge CPU work. The same server export selects
Node.js `worker_threads` on Node 18+ and the Web Worker-compatible runtime on
Bun. It does not start another service or operating-system process.

See the
[QUESTPIE collaborative documents guide](https://questpie.com/docs/concepts/collaborative-documents)
for schema constraints, security, operations, and a complete recipe.
