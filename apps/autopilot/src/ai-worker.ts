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

await startAIWorker(ctx, {
	maxConcurrentRuns: maxConcurrentRuns(),
	pollIntervalMs: 1000,
	runtimes: [{ runtime: "claude-code" }],
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
