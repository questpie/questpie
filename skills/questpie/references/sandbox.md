# Sandboxed Code Execution (ctx.executor)

Use the executor when an app must run **untrusted or dynamically-authored code**, agent-written scripts, user plugins, knowledge mini-apps, under a default-deny capability model. `ctx.executor.run()` is the primitive (top-level on AppContext; there is no `ctx.sandbox`).

Unconfigured = disabled: without an `executor` key in `questpie.config.ts`, `ctx.executor.run` throws a clear "not configured" error. An app that never runs dynamic code simply does not configure it.

## Two Isolation Modes

| Mode                    | Runs in                                                                                                  | For                                                        |
| ----------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `"sandboxed"` (default) | fresh, hardened **Deno** subprocess per request (scoped net/import, fs/env/run/ffi denied, memory bound) | untrusted code (user/AI mini-apps)                         |
| `"trusted"`             | in-process (Bun) with a soft timeout                                                                     | code you already own (code-mode agents, scheduled scripts) |

Untrusted-by-default: omitting `isolation` means `"sandboxed"`; trusted callers opt in explicitly.

## Install And Configure

The sandboxed adapter comes from the opt-in `@questpie/sandbox` package; the engine is a standalone Deno service your app reaches over HTTP (the app ships no Deno):

```bash
bun add @questpie/sandbox
```

```ts
// questpie.config.ts
import { httpSandboxAdapter } from "@questpie/sandbox/adapter";
import { runtimeConfig } from "questpie/app";

export default runtimeConfig({
	executor: {
		sandboxed: httpSandboxAdapter({
			url: process.env.SANDBOX_URL ?? "http://127.0.0.1:8787",
			hostAdmissionSecret: process.env.SANDBOX_HOST_ADMISSION_SECRET,
		}),
		// TRUSTED internal URL of this app's own broker endpoint, required only
		// for the untrusted app-bindings path. NEVER derive from request Host.
		brokerUrl: process.env.SANDBOX_BROKER_URL,
		// defaultTimeoutMs: 10_000,
	},
});
```

`executor.trusted` defaults to the built-in in-process adapter, override only to customize.
The adapter and supervisor must share a random
`SANDBOX_HOST_ADMISSION_SECRET` of at least 32 bytes. Missing admission
credentials fail closed.

If a sandbox policy can receive QUESTPIE bindings, register the generated
broker route statically:

```ts
// modules.ts
import { sandboxModule } from "@questpie/sandbox/modules/sandbox";

export default [sandboxModule] as const;
```

## Running Code

The guest source must `export default` a function of `input`:

```ts
const result = await ctx.executor.run({
	source: `export default async function (input) {
		const res = await fetch("https://api.example.com/data?since=" + input.since);
		const data = await res.json();
		return { count: data.length };
	}`,
	capabilities: {
		net: ["api.example.com"], // fetch() egress allowlist
		timeoutMs: 5_000,
		memoryMb: 128,
	},
	input: { since: "2026-01-01" },
});
// → { ok: true, output: { count: 42 }, logs: [...], ms: 312 }
```

Result shape: `{ ok, output?, logs, error?, timedOut?, ms? }`.

## Remote Workload Admission

Consumer-owned remote workloads call `adapter.runWorkload({ envelope })`.
Configure a `workload` authorizer on `httpSandboxAdapter()`; it receives only
the opaque envelope, phase, and signal and must return the complete bounded
policy. QUESTPIE invokes it before preparation and again immediately before
dispatch, and both normalized policies must match exactly.

Do not pass source, input, capabilities, secrets, or bindings beside the
envelope. Missing or malformed authorization, authorization drift, expired
policy, audit failure, replay, wrong supervisor instance, or request-body
mismatch fails closed with `SandboxWorkloadDeniedError`.

## Explicit Custom MCP Tools

Sandbox guests can call only custom `mcpTool(...)` definitions that declare an
explicit workload policy. Built-in collection CRUD, files, and stores remain on
the native sandbox broker; they are never widened into an MCP surface.

Register both static modules:

```ts
// modules.ts
import { mcpModule } from "@questpie/mcp/modules/mcp";
import { sandboxModule } from "@questpie/sandbox/modules/sandbox";

export default [mcpModule, sandboxModule] as const;
```

Configure the host-only authorization and context-binding seams with the public
`sandboxCustomTools(...)` helper:

```ts
// questpie.config.ts
import { sandboxCustomTools } from "@questpie/sandbox";
import { httpSandboxAdapter } from "@questpie/sandbox/adapter";
import { runtimeConfig } from "questpie/app";

export default runtimeConfig({
	executor: {
		sandboxed: httpSandboxAdapter({
			url: process.env.SANDBOX_URL,
		}),
	},
	sandboxCustomTools: sandboxCustomTools({
		authorizer: consumerToolAuthority,
		contextBinder: consumerQuestpieContextBinder,
		evidence: async (event) => evidenceSink.write(event),
	}),
});
```

The caller supplies an opaque, host-only envelope and the trusted canonical
broker endpoint. Neither is exposed to guest code:

```ts
const result = await ctx.executor.run({
	isolation: "sandboxed",
	source: `export default async () => {
		const { tools } = await globalThis.questpie.tools.list();
		return globalThis.questpie.tools.call("reports.generate", {
			period: "week",
		});
	}`,
	brokerUrl: process.env.SANDBOX_BROKER_URL,
	sandboxTools: { envelope: consumerEnvelope },
	capabilities: {
		net: [],
		import: [],
		timeoutMs: 5_000,
		memoryMb: 128,
	},
});
```

The host pins the released tool catalog and broker endpoint for the run, then
reauthorizes discovery and every call against a freshly bound user-mode
QUESTPIE context. Tool count, discovery bytes, argument bytes, result bytes,
operation count, time, concurrency, evidence time, and active sessions are
bounded. Tokens are revoked when transport settles; expired sessions are
reclaimed. Evidence is product-neutral and receives no envelope, arguments,
result body, bearer credential, app/database handle, or request context.

## The Capability Model

Every run declares a manifest; anything not granted is denied (default-deny):

| Axis                              | Grants                                                           | Enforced by                                          |
| --------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------- |
| `net`                             | outbound HTTP host allowlist (`host[:port]`)                     | engine for compute-only; trusted broker for bindings |
| `import`                          | remote module-import host allowlist (independent of `net`)       | sandbox engine (`--allow-import`)                    |
| `timeoutMs` / `memoryMb`          | hard wall-clock / real V8 heap cap (`--max-old-space-size`)      | sandbox engine                                       |
| `files`                           | read/write path globs into the file store                        | bindings broker                                      |
| `data.collections`                | per-collection verbs (`read`/`create`/`update`/`delete`)         | bindings broker                                      |
| `data.globals` / `data.stores`    | per-global and per-`document_store`-namespace verbs              | bindings broker                                      |
| `services` / `jobs` / `workflows` | allowed service names / enqueueable jobs / triggerable workflows | bindings broker                                      |

`import`/`timeoutMs`/`memoryMb` are enforced by the **engine**. `net` is
engine-enforced only for the backwards-compatible compute-only path. As soon as
app bindings or custom tools are present, the guest receives `--allow-net=[]`
and the same `net` grant is enforced exclusively by the trusted, address-pinning
HTTP broker. Everything below the line is enforced by the broker at call time;
the engine never sees your collections.

`import` **fails open**: omitting `--allow-import` does NOT deny, Deno silently grants ~7 default hosts (`esm.sh`, `jsr.io`, `deno.land`, …), so an empty `import` allowlist is compiled to an explicit `--deny-import=<those hosts>`. Never alias `net` and `import`.

`secrets: Record<string, string>` injects secrets into the guest without embedding them in source.

## App Bindings (the `questpie` Proxy)

A plain `ctx.executor.run` is **compute-only** (plus granted `net`). To let the guest reach app data, the caller passes an `appBindings` target plus `brokerUrl`, the service mints a per-run scoped token, and the guest's `globalThis.questpie` proxy RPCs through a host **broker** that enforces the capability manifest per call and dispatches under a non-privileged principal (never `system`):

```ts
// inside the guest source, only the granted surface resolves
const posts = await questpie.collections.posts.find({ limit: 10 });
const file = await questpie.files.read({ path: "company/data/report.json" });
```

The broker endpoint is a route the host application or workload runner mounts;
the guest never imports your app. For trusted in-process runs, `bindings`
injects host globals directly instead.

## Deployment

The sandbox engine runs as its own service/container reachable at `SANDBOX_URL`; `brokerUrl` must point at the app's own loopback/internal address (the supervisor is trusted), never at anything request-derived. The supervisor is Deno-only and ships as source under `node_modules` (the app image stays Deno-free):

```bash
deno run \
  --allow-net --allow-env --allow-run \
  --allow-read --allow-write=$TMPDIR \
  node_modules/@questpie/sandbox/src/sandbox-server.ts
```

Supervisor env: `PORT` (default 8787), `DENO_BIN`, `SANDBOX_BROKER_URL`, `SANDBOX_DISABLE_NETNS_FIREWALL`.

## Security Internals

- **Process-per-request**, not a warm Worker: a Worker can't enforce `memoryMb` and can't reap grandchild Workers, so each run is a fresh subprocess with a real heap cap and SIGTERM→SIGKILL teardown. Before guest code runs, `globalThis.Worker` is nulled and `SharedArrayBuffer`/`Atomics` are deleted.
- **SSRF egress validation** at manifest time, in BOTH adapter and server: any `net`/`import` host that is (or DNS-resolves to) private/loopback/link-local/CGNAT or `169.254.169.254` is rejected; DNS fails closed. Direct-network compute runs do not pin the socket IP across redirects (`TODO(security)`). Bindings guests do not have that surface: they run `--allow-net=[]`, and brokered `http.fetch` resolves, validates, pins, and revalidates redirects host-side.
- **Brokered `fetch` on the app-bindings path**: the guest has no sockets (`--allow-net=[]`); its native `fetch` is replaced by a shim that RPCs `http.fetch` over stdio to the supervisor, which relays to `brokerUrl` carrying a supervisor-only per-run token (`x-questpie-sandbox-token`).
- **Linux kernel egress firewall (belt-and-suspenders)**: on Linux with `unshare`/`nft`/`ip` + caps, each run also gets a per-run netns + nftables ruleset (default-DROP). **Gracefully absent** off Linux or when tools/caps are missing (logs a notice, runs without it). Disable with `SANDBOX_DISABLE_NETNS_FIREWALL=1`. The subprocess permission flags are the primary boundary; this is a second layer.

### Broker result and wire budgets

The decoded HTTP upload and response budget is
`HTTP_FETCH_BODY_CAP_BYTES` (5 MiB). Base64 and JSON envelopes are derived from
that decoded cap; native binding results use
`BROKER_NATIVE_RESULT_CAP_BYTES`, while brokered HTTP results use
`BROKER_HTTP_RESULT_CAP_BYTES`. The supervisor applies method-aware request,
response, frame, and cumulative-output limits, so an exact-cap HTTP body fits
but max+1 never reaches or escapes the broker.

Adapters that expose the generic broker route must call
`snapshotBoundedBrokerValue` before `Response.json`/`JSON.stringify`. It creates
an inert, bounded JSON snapshot without invoking getters, proxy traps, or
consumer `toJSON` methods. Invalid results and target failures return stable
redacted messages plus a correlation ID; raw errors may go only to the trusted
`SandboxBrokerOptions.onDiagnostic` callback.

## Rules

- Do not use the executor for trusted first-party logic, routes, jobs, and services are the right tools.
- Never grant `net`/`import` hosts or data verbs a run does not need; capabilities are per-run, not global.
- Never pass `isolation: "trusted"` for code you did not author, there is no sandbox in that mode.
- Source `brokerUrl` from config/env only; a request-derived broker URL lets a spoofed Host exfiltrate the per-run token.

Full reference: docs page `adapters/sandbox`.
