# Sandboxed Code Execution (ctx.executor)

Use the executor when an app must run **untrusted or dynamically-authored code**, agent-written scripts, user plugins, knowledge mini-apps, under a default-deny capability model. `ctx.executor.run()` is the primitive (top-level on AppContext; there is no `ctx.sandbox`).

Unconfigured = disabled: without an `executor` key in `questpie.config.ts`, `ctx.executor.run` throws a clear "not configured" error. An app that never runs dynamic code simply does not configure it.

## Two Isolation Modes

| Mode | Runs in | For |
| --- | --- | --- |
| `"sandboxed"` (default) | fresh, hardened **Deno** subprocess per request (scoped net/import, fs/env/run/ffi denied, memory bound) | untrusted code (user/AI mini-apps) |
| `"trusted"` | in-process (Bun) with a soft timeout | code you already own (code-mode agents, scheduled scripts) |

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
		}),
		// TRUSTED internal URL of this app's own broker endpoint, required only
		// for the untrusted app-bindings path. NEVER derive from request Host.
		brokerUrl: process.env.SANDBOX_BROKER_URL,
		// defaultTimeoutMs: 10_000,
	},
});
```

`executor.trusted` defaults to the built-in in-process adapter, override only to customize.

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

## The Capability Model

Every run declares a manifest; anything not granted is denied (default-deny):

| Axis | Grants | Enforced by |
| --- | --- | --- |
| `net` | `fetch()` host allowlist (`host[:port]`) | sandbox engine |
| `import` | remote module-import host allowlist (independent of `net`) | sandbox engine |
| `timeoutMs` / `memoryMb` | hard wall-clock / per-guest memory bounds | sandbox engine |
| `files` | read/write path globs into the file store | bindings broker |
| `data.collections` | per-collection verbs (`read`/`create`/`update`/`delete`) | bindings broker |
| `data.globals` / `data.stores` | per-global and per-`document_store`-namespace verbs | bindings broker |
| `services` / `jobs` / `workflows` | allowed service names / enqueueable jobs / triggerable workflows | bindings broker |

`secrets: Record<string, string>` injects secrets into the guest without embedding them in source.

## App Bindings (the `questpie` Proxy)

A plain `ctx.executor.run` is **compute-only** (plus granted `net`). To let the guest reach app data, the caller passes an `appBindings` target plus `brokerUrl`, the service mints a per-run scoped token, and the guest's `globalThis.questpie` proxy RPCs through a host **broker** that enforces the capability manifest per call and dispatches under a non-privileged principal (never `system`):

```ts
// inside the guest source, only the granted surface resolves
const posts = await questpie.collections.posts.find({ limit: 10 });
const file = await questpie.files.read({ path: "company/data/report.json" });
```

The broker endpoint is a route the host app mounts (product layers like Autopilot's mini-app runner do this); the guest never imports your app. For trusted in-process runs, `bindings` injects host globals directly instead.

## Deployment

The sandbox engine runs as its own service/container reachable at `SANDBOX_URL`; `brokerUrl` must point at the app's own loopback/internal address (the supervisor is trusted), never at anything request-derived:

```bash
deno run --allow-net --allow-read packages/sandbox/src/sandbox-server.ts
```

## Rules

- Do not use the executor for trusted first-party logic, routes, jobs, and services are the right tools.
- Never grant `net`/`import` hosts or data verbs a run does not need; capabilities are per-run, not global.
- Never pass `isolation: "trusted"` for code you did not author, there is no sandbox in that mode.
- Source `brokerUrl` from config/env only; a request-derived broker URL lets a spoofed Host exfiltrate the per-run token.

Full reference: docs page `backend/business-logic/code-execution`.
