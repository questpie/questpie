# Executor spike — Deno HTTP sandbox service (de-risk #1)

Throwaway spike for task `executor-deno-spike`. Proves the **production sandbox model**
from `.private/knowledge-miniapps-mvp.md` §12: a **standalone Deno HTTP service** runs
UNTRUSTED TypeScript in a **per-request Deno Worker with scoped permissions**, callable
over HTTP from a Bun client — confirming the **main app needs NO Deno** (only this
service does).

Environment: Deno 2.7.8 (V8 14.7, TS 5.9.2), Bun 1.3.14, macOS arm64.

## Files

- `sandbox-server.ts` — the Deno service. `Deno.serve`; `POST /run` executes `source`
  in `new Worker(blobURL, { type: "module", deno: { permissions: {...} } })`,
  passes `input` in, collects `{ ok, output, logs, error, timedOut, ms }` out via
  `postMessage`. Hard wall-time timeout via `worker.terminate()`.
- `client.ts` — Bun script (NO Deno). POSTs the verify-gate matrix + measures warm latency.

## Run

```sh
# 1. start the standalone Deno service (its OWN, minimal perms — guests get nothing from these):
deno run --allow-net --allow-env=PORT --unstable-worker-options sandbox-server.ts
#    -> sandbox-server listening on :8787

# 2. in another shell, run the Bun client (no Deno involved):
bun run client.ts
```

`--unstable-worker-options` is **REQUIRED** in Deno 2.7 — without it, passing
`deno.permissions` to a `Worker` throws `Unstable API 'Worker.deno.permissions'`.

## Verify gate results (measured 2026-06-05, all PASS)

```
[PASS] trivial round-trip                         {ok:true, output:{doubled:42}, ms:15}
[PASS] fetch to allowlisted esm.sh SUCCEEDS       {ok:true, output:{status:200,name:"lodash"}, ms:139}
[PASS] esm.sh import SUCCEEDS (scoped import perm) {ok:true, output:{chunked:[[1,2],[3,4],[5]]}, ms:32}
[PASS] fetch to non-allowlisted host BLOCKED      {ok:true, output:{blocked:"NotCapable"}}
[PASS] file read DENIED                            {ok:true, output:{read:"DENIED",err:"NotCapable"}}
[PASS] env read DENIED                             {ok:true, output:{env:"DENIED",err:"NotCapable"}}
[PASS] subprocess run DENIED                       {ok:true, output:{run:"DENIED",err:"NotCapable"}}
[PASS] infinite loop terminated by timeout         {ok:false, timedOut:true, ms:1011}
[PASS] service survives the timeout kill           health after kill: true
[PASS] guest logs captured                         ["log: hello from guest ...","warn: a warning"]

──────── 10 passed, 0 failed ────────
```

- **Allowed fetch + import work; everything else denied.** The allowlist `["esm.sh:443"]`
  grants the guest both runtime `fetch()` and module `import` of `https://esm.sh/...`; a
  fetch to `example.com` and all of `Deno.readTextFile` / `Deno.env.get` / `new Deno.Command`
  fail with `NotCapable`.
- **Infinite loop**: 1000 ms timeout fired, worker terminated (`ms:1011`), service stayed up.
- **Bun client uses NO Deno** — only `sandbox-server.ts` runs under `deno`.

## Warm round-trip latency

Service already running; trivial guest; client-measured wall clock incl. HTTP + per-request
Worker spawn (n=20):

```
min=11.9ms  p50=12.4ms  avg=12.4ms  p95=13.0ms
```

Confirmed warm = **no per-call process spawn**: the service process count stayed at exactly
1 across 10 requests (each request = an in-process Deno Worker / thread, not a new OS process).
Of the ~12 ms, the dominant cost is per-request Worker (V8 isolate) spin-up + the blob-module
indirection, NOT HTTP.

## Findings (feed M2 design)

### 1. Exact Deno Worker permissions API (Deno 2.7.8) — working snippet

```ts
const worker = new Worker(blobUrl, {
  type: "module",
  // @ts-ignore — Deno-specific; requires the --unstable-worker-options run flag
  deno: {
    permissions: {
      net:    ["esm.sh:443"], // runtime fetch() allowlist (host[:port]); false = none
      import: ["esm.sh:443"], // MODULE import allowlist — separate axis from net (see #2)
      read:  false, write: false, env: false, run: false, ffi: false, sys: false,
    },
  },
});
```

- The API is `Worker(url, { deno: { permissions } })`. The permission **values** mirror the
  `--allow-*` CLI shape: `string[]` (scoped allowlist), `true` (all), or `false` (deny).
- `Deno.permissions.query(...)` **inside** the worker reports `"prompt"` even for granted
  hosts (a descriptor-matching quirk in workers) — **do not trust `query` state; trust
  actual enforcement.** Real ops correctly succeed/throw `NotCapable`.

### 2. esm.sh imports inside the permissioned Worker — YES, but `import` is a SEPARATE permission

This is the most important M2 gotcha:

- Runtime **`fetch("https://esm.sh/...")`** is gated by the **`net`** permission. ✅ works with `net: ["esm.sh:443"]`.
- Module **`import("https://esm.sh/...")`** (static or dynamic) is gated by a distinct
  **`import`** permission. With `net` alone it fails:
  `Requires import access to "esm.sh:443", run again with the --allow-import flag`.
- **The Worker does NOT inherit the parent process's `--allow-import`.** Verified: parent with
  `--allow-import=esm.sh:443` + worker without an `import` field → import still FAILS.
- **The only way to grant scoped import to a guest is the `import` field in the Worker's
  `permissions` object.** Verified: `permissions.import: ["esm.sh:443"]` makes
  `import("https://esm.sh/lodash@…")` succeed **even when the service has no `--allow-import` at all**.
- **M2 rule:** the executor must set `permissions.import = permissions.net = manifest.capabilities.net`
  (same allowlist drives both fetch and npm/esm imports). The standalone service runs with **no**
  broad import access; each request's grant is per-Worker. The blob-module bootstrap→guest
  indirection (used here so the guest's own top-level imports are governed by the worker grant)
  works because **blob URLs are not remote hosts** and need no import permission.

### 3. Warm latency / spawn cost

- **Warm round-trip p50 ≈ 12 ms** (HTTP + Worker spawn + blob indirection), p95 ≈ 13 ms.
- Worker (isolate) spawn is the dominant term, not HTTP. Good enough for endpoint/cron use;
  if sub-ms matters later, a warm-Worker pool would amortize it — but per §11 the warm
  *service* already removes the per-call *process* cold-start, so a Worker pool is a
  premature optimization for MVP.

### 4. ⚠️ BLOCKER / hard limitation — per-Worker MEMORY cap is NOT enforceable in-process

- Deno Workers have **no per-Worker memory cap** in the `permissions`/`deno` options. The V8
  heap limit is **process-wide**.
- **Verified failure mode:** a guest that allocates aggressively (`while(true) a.push(new Array(1e6))`)
  hits the heap limit and **`FatalProcessOutOfMemory` kills the ENTIRE service process**
  (exit 133 / `Empty reply from server` / service goes DOWN). `worker.terminate()` is never
  reached, and **the wall-time timeout does NOT save you** — OOM aborts the process
  synchronously before the timer callback runs. This is the exact weakness §4 flagged for
  `isolated-vm` ("OOM zhodí host proces"), and it applies equally to in-process Deno Workers.
- **`memoryMb` in the capability manifest is therefore ADVISORY only** with this model. The
  service implements `net`/`import`/fs/env/run isolation and **wall-time**, but **cannot
  honor `memoryMb` by killing just the offending guest.**
- **Mitigations for M2 (all OS/process-level, none in-process):**
  1. Run the service in a **container with a memory limit + auto-restart** (the bomb kills the
     container, orchestrator restarts it). Acceptable for self-host MVP, but one bad guest = a
     brief service-wide outage / collateral damage to concurrent requests.
  2. **One OS process per request** (`deno run --v8-flags=--max-old-space-size=<memoryMb>` per
     call) for true per-guest memory bounding — trades the warm-Worker latency win for a
     process cold-start, and only the bad request dies. A hybrid (warm Workers for trusted/light,
     fresh process for untrusted/heavy) is possible.
  3. **Deno Deploy / Subhosting** enforces per-isolate cgroups/memory — the natural cloud tier;
     same `sandbox-server.ts`, no collateral damage. (§12.)
- **Recommendation:** ship MVP self-host as the warm Worker service **inside a
  memory-limited container** (mitigation 1), document `memoryMb` as advisory, and treat true
  per-guest memory isolation as the cloud-tier (Subhosting) or per-process upgrade. Surface
  this in the M2 `executor` adapter contract so consumers don't assume `memoryMb` is hard.

## Cleanup

Throwaway spike under `scratch/`. No QUESTPIE wiring, no new package, no QuickJS, no microVM
(per task Non-Goals). Delete `scratch/executor-spike/` once M2 lands.
