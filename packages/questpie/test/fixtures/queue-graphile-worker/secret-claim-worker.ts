import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { z } from "zod";

import { GraphileWorkerAdapter } from "../../../src/exports/adapters/graphile-worker.js";
import { createQueueClient } from "../../../src/server/modules/core/integrated/queue/service.js";

const client = postgres(process.env.QUESTPIE_GRAPHILE_CRASH_URL!);
const db = drizzle({ client });
const adapter = new GraphileWorkerAdapter({
	connectionString: process.env.QUESTPIE_GRAPHILE_CRASH_URL!,
	schema: process.env.QUESTPIE_GRAPHILE_CRASH_SCHEMA!,
	pollInterval: 100,
	concurrentJobs: 1,
});
const queue = createQueueClient(
	{
		delivery: {
			name: "delivery",
			schema: z.object({ value: z.string() }),
			handler: async () => {
				throw new Error("Blocked secret handler must not start");
			},
		},
	},
	adapter,
	{
		getDatabase: () => db,
		createContext: async () => ({ db }),
		getApp: () => ({ db, collections: {}, globals: {} }),
		secret: "graphile-test-root-secret-at-least-32-bytes",
		logger: { info() {}, warn() {}, error() {} },
	},
);
await queue.listen({ gracefulShutdown: false });
process.stdout.write("listening\n");
