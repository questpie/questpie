import { z } from "zod";

import { job } from "../integrated/queue/job.js";
import { drainStorageCleanup } from "../integrated/storage/cleanup-store.js";

export const STORAGE_CLEANUP_JOB_NAME = "storage-cleanup" as const;

export const storageCleanupSchema = z.object({
	batchSize: z.number().int().min(1).max(1_000).optional(),
	concurrency: z.number().int().min(1).max(32).optional(),
	maxBatches: z.number().int().min(1).max(100).optional(),
});

const storageCleanupJob = job({
	name: STORAGE_CLEANUP_JOB_NAME,
	schema: storageCleanupSchema,
	options: {
		cron: "* * * * *",
		queuePolicy: "stately",
		retryLimit: 3,
		retryDelay: 30,
		retryBackoff: true,
	},
	handler: async (ctx) => {
		const { payload } = ctx;
		const db = (ctx as any).db;
		const storage = (ctx as any).storage;
		const logger = (ctx as any).logger;
		if (!db || !storage) {
			throw new Error("Storage cleanup requires database and storage services");
		}

		const maxBatches = payload.maxBatches ?? 10;
		for (let batch = 0; batch < maxBatches; batch += 1) {
			const result = await drainStorageCleanup({
				app: (ctx as any).app,
				batchSize: payload.batchSize,
				concurrency: payload.concurrency,
				db,
				logger,
				storage,
			});
			if (result.claimed < (payload.batchSize ?? 100)) break;
		}
	},
});

export default storageCleanupJob;
