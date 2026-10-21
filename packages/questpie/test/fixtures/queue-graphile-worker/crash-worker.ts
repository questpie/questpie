import { GraphileWorkerAdapter } from "../../../src/exports/adapters/graphile-worker.js";

const adapter = new GraphileWorkerAdapter({
	connectionString: process.env.QUESTPIE_GRAPHILE_CRASH_URL!,
	schema: process.env.QUESTPIE_GRAPHILE_CRASH_SCHEMA!,
	pollInterval: 100,
	concurrentJobs: Number(process.env.QUESTPIE_GRAPHILE_CRASH_CONCURRENCY ?? 10),
});
adapter.on("error", () => {
	process.exitCode = 1;
});
await adapter.listen(
	{
		crash: async () => {
			process.stdout.write("claimed\n");
			await new Promise<void>(() => {});
		},
	},
	{
		teamSize: 2,
		batchSize: Number(process.env.QUESTPIE_GRAPHILE_CRASH_BATCH ?? 10),
	},
);
