import { createContext } from "#questpie";
import { startAIWorker } from "@questpie/ai/worker";

const mcpEntrypoint = new URL("./mcp-stdio.ts", import.meta.url).pathname;

function maxConcurrentRuns() {
	const raw = process.env.AI_WORKER_MAX_CONCURRENT_RUNS;
	if (!raw) return 1;
	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || parsed < 1) return 1;
	return Math.floor(parsed);
}

// Decoupled worker: a separate process cannot share the API's in-process
// MemoryKVAdapter Map, so the resumable stream sink it writes would be invisible
// to the HTTP /stream tail. Require a shared KV (Redis). questpie.config.ts wires
// Redis only when REDIS_URL is set, so REDIS_URL-unset ⟺ MemoryKVAdapter active.
// The in-process fleet never runs this file, so this cannot false-positive.
function assertSharedKvForDecoupledWorker(): void {
	if (!process.env.REDIS_URL) {
		throw new Error(
			"AI worker started decoupled but no shared KV is configured — set REDIS_URL (or run the worker in-process). A separate worker process cannot share the API's in-process KV.",
		);
	}
}

assertSharedKvForDecoupledWorker();

// startAIWorker needs resolved services (workerManager), which live on a
// context, not the bare app instance — so run it within a system context.
const ctx = await createContext({ accessMode: "system" });

await startAIWorker(ctx, {
	maxConcurrentRuns: maxConcurrentRuns(),
	pollIntervalMs: 1000,
	runtimes: [{ runtime: "claude-code" }],
	// Personal-machine worker: the claude-code bridge authenticates via the
	// host Claude subscription (~/.claude), so pass the real HOME through the
	// otherwise-isolated sandbox HOME.
	sandbox: { passthroughHomeForAuth: true },
	mcpServers: [
		{
			name: "questpie-autopilot",
			command: process.execPath,
			args: ["--bun", "run", mcpEntrypoint],
			env: {
				DATABASE_URL: process.env.DATABASE_URL ?? "",
				APP_URL: process.env.APP_URL ?? "",
			},
		},
	],
});
