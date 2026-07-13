# AI Agent Runs (@questpie/ai)

Run-orchestration layer for executing **Claude Code** agents against durable run records. It owns the reliability primitives, worker leases, exactly-once finalization, and a resumable stream, not a chat SDK. **Headless-first**: server/worker code drives everything; an admin UI can sit on top.

Opt-in package: `bun add @questpie/ai`. Peer deps `questpie`, `@questpie/admin`, `react ^19`, `zod ^4`, `@tanstack/react-query`.

## What Ships vs What You Own

Register `aiModule` in `modules.ts`, then `bun questpie generate`. The module contributes:
- Collection `ai_workers` (admin-hidden), the worker registry. (`ai_worker_leases` also exists but is **vestigial**; leases now live on `run_links.producerLease`.)
- Service `workerManager`, `registerWorker`, `deregister`, `heartbeat`, `claimRun`, `authenticate`.
- Routes `enrollmentTokens`/`enrollmentEnroll`/`workerRegister`/`workerPoll`/`workerHeartbeat`/`workerDeregister`.
- Cron job `ai-worker-timeout` (`*/5 * * * *`), reaps expired leases, marks dead workers offline.

**You own the `run_links` collection**, the single execution record. The package does NOT ship it; worker/finalize/reap code operates on the injected `collections.run_links`. Fields to model: `kind`, `runtime`, `status` (`pending|claimed|running|completed|failed|cancelled`), `instructions`, `activeStreamId`, `producerLease` (json), `harnessResumeState`, `uiMessages`, `finalizedAt`, `retryPolicy` (`auto`|…).

## Exports

| Import | Contents |
| --- | --- |
| `@questpie/ai/modules/ai` | `aiModule` |
| `@questpie/ai/worker` | `startAIWorker(ctx, config) → { stop, workerId }`, `EmbeddedWorkerConfig`, `HarnessRuntime` (=`"claude-code"`) |
| `@questpie/ai/harness-core` | `createHarnessAgent`, `resumeOrCreateSession`, `streamTurn`, `toUIMessages`, `ResumableUIMessageStore`, `createQuestpieResumableStreamStore({kv})`, `finalizeRun`, `reapExpiredRunLinks` |
| `@questpie/ai` | `aiConfig`, `aiPlugin`, contract types (`AiRunStatus`, `AgentRuntimeRunRequest`, …), **hooks unwired, see Gotchas** |

## Embedded Worker (the real execution path)

A separate process with a **system context** (reads `ctx.services.workerManager`, `ctx.collections`, `ctx.kv`):

```ts
// src/ai-worker.ts
import { createContext } from "#questpie";
import { startAIWorker } from "@questpie/ai/worker";

const ctx = await createContext({ accessMode: "system" });
await startAIWorker(ctx, {
	runtimes: [{ runtime: "claude-code" }],
	maxConcurrentRuns: 1,
	pollIntervalMs: 1000,
	sandbox: { passthroughHomeForAuth: true }, // reuse ~/.claude on a personal machine
	mcpServers: [{ name: "questpie", command: process.execPath, args: ["--bun", "run", "./src/mcp-entry.ts"], env: {} }],
});
```

Loop: `heartbeat` → `claimRun` (id-scoped CAS `pending`→`claimed`, bumps `producerLease.epoch`) → `executeRun` (streams into the KV sink) → the single `finalizeRun`.

## Resumable Stream + Finalize

Output streams into a KV-backed store (`createQuestpieResumableStreamStore({ kv })`, keys `rs:{id}:*`, 1h TTL). Serve an SSE tail off `store.readFrom(activeStreamId, offset)`; resume via `Last-Event-ID`/`?offset`, `gap`→`expired` fallback to the persisted transcript.

`finalizeRun(deps, input)` is the **exactly-once** latch: `finalizedAt IS NULL` ∧ matching lease `epoch` ∧ non-terminal `status`. It seals the stream, writes terminal status/summary/tokens/`uiMessages`, and (for `kind:"task"`/`"chat"`) writes knowledge artifacts + assistant `chat_messages`, once, even if two workers race.

`reapExpiredRunLinks(deps, now?)` (the cron + inline on each tail read) requeues expired leases when `retryPolicy:"auto"` (bump epoch → `pending`) or fails them via `finalizeRun` otherwise.

## Gotchas (verified against @questpie/ai@3.1.0)

- **`claude-code` runtime ONLY.** `createHarnessAgent` throws for anything else.
- **`aiConfig`/`aiPlugin`/`config/ai.ts` + `onBeforeRun`/`onAfterComplete` are DEFINED BUT NOT WIRED**, placeholder surface, consumed nowhere. Do not tell users to configure them.
- **`@questpie/ai/client` exports NOTHING** (relay streaming removed in the chat-v7 cutover). Client streaming = server resumable sink + app-owned SSE tail. The `.tsx` components under `src/client/.../components/` are dead/unexported.
- **HTTP worker fleet is PARKED** (finalize-over-HTTP is a HITL follow-up). Real usage = in-process embedded worker with in-process `finalizeRun`.
- **The bundled sandbox is NOT isolation.** `@questpie/ai` uses its own `createLocalHostSandbox` (host `bash -lc`, isolates HOME/XDG, filters secret env). `passthroughHomeForAuth:true` relaxes HOME isolation to read `~/.claude`; the worker runs `permissionMode:"allow-all"`. This is **unrelated** to [[sandbox]] (`@questpie/sandbox`, the Deno code-execution engine), do not conflate.
- **No live cross-turn attach.** Resume is replay against the persisted per-session HOME; `harnessResumeState` is written once at end-of-turn (the bridge session is destroyed when the turn's job ends).
- **A decoupled worker needs shared KV (Redis).** The HTTP tail can't see an in-process MemoryKV sink written by another process.
- **Postgres-coupled epoch fence**, the exactly-once CAS is a raw JSONB predicate over the double-encoded `producerLease` column.

## Rules

- Model `run_links` in the app; never expect the package to ship it.
- Run the worker as its own process with `createContext({ accessMode: "system" })`.
- Use the embedded worker + in-process `finalizeRun`; the HTTP fleet is not complete.
- Don't reach for `@questpie/ai` for trusted first-party automation, that's [[workflows]] and [jobs]. This is for streaming Claude Code agent turns.

Full reference: docs page `integrations/ai`. Related: [[sandbox]] (different sandbox), [[mcp]] (agents connect out via MCP), [[workflows]].
