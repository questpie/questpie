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

// startAIWorker needs resolved services (workerManager), which live on a
// context, not the bare app instance — so run it within a system context.
const ctx = await createContext({ accessMode: "system" });

// TODO: this should be auto-detectable from the array of supported cli's
await startAIWorker(ctx, {
	maxConcurrentRuns: maxConcurrentRuns(),
	pollIntervalMs: 1000,
	// Register the ACP-capable agent CLIs available on this host; the run's
	// requested runtime (default codex) is matched against this set.
	runtimes: [{ runtime: "codex" }, { runtime: "claude-code" }],
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
