import { httpSandboxAdapter } from "@questpie/sandbox/adapter";
import type { RedisClientType } from "redis";
import { runtimeConfig } from "questpie/app";
import { ConsoleAdapter } from "questpie/adapters/console";
import { pgBossAdapter } from "questpie/adapters/pg-boss";
import { redisKVAdapter, type RedisKVClient } from "questpie/adapters/redis-kv";

const DATABASE_URL =
	process.env.DATABASE_URL || "postgres://localhost/autopilot";

// Shared KV. Default (in-process fleet, OQ3) uses the framework's MemoryKVAdapter
// — the API and the co-resident worker share one Map. A DECOUPLED worker
// (src/ai-worker.ts) cannot share that Map, so it requires a shared Redis KV;
// wire it only when REDIS_URL is set (ai-worker.ts asserts presence at boot).
// `redis` is loaded lazily so the default path never imports it.
const REDIS_URL = process.env.REDIS_URL;
let sharedRedisClient: RedisClientType | undefined;
async function resolveRedisKVClient(): Promise<RedisKVClient> {
	if (!sharedRedisClient) {
		const { createClient } = await import("redis");
		sharedRedisClient = createClient({ url: REDIS_URL });
		await sharedRedisClient.connect();
	}
	return sharedRedisClient as unknown as RedisKVClient;
}

export default runtimeConfig({
	app: {
		url: process.env.APP_URL || "http://localhost:3000",
	},
	db: {
		url: DATABASE_URL,
	},
	storage: {
		basePath: "/api",
	},
	secret: process.env.BETTER_AUTH_SECRET || "demo-secret-change-in-production",
	email: {
		adapter: new ConsoleAdapter({ logHtml: false }),
	},
	queue: { adapter: pgBossAdapter({ connectionString: DATABASE_URL }) },
	kv: REDIS_URL
		? { adapter: redisKVAdapter({ client: resolveRedisKVClient }) }
		: undefined,
	executor: {
		sandboxed: httpSandboxAdapter({
			url: process.env.SANDBOX_URL ?? "http://127.0.0.1:8787",
		}),
		brokerUrl:
			process.env.SANDBOX_BROKER_URL ??
			"http://127.0.0.1:3000/api/sandbox/rpc",
	},
});
