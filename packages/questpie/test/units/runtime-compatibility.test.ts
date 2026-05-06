import { describe, expect, test } from "bun:test";

import {
	cloudflareKVAdapter,
	type CloudflareKVNamespace,
} from "../../src/exports/adapters/cloudflare-kv.js";
import { cloudflareQueuesAdapter } from "../../src/exports/adapters/cloudflare-queues.js";
import { cloudflareRealtimeAdapter } from "../../src/exports/adapters/cloudflare-realtime.js";
import {
	assertCloudflareCompatible,
	CloudflareCompatibilityError,
	getCloudflareCompatibilityIssues,
} from "../../src/server/config/runtime-compatibility.js";

const cloudflareNamespace: CloudflareKVNamespace = {
	async get() {
		return null;
	},
	async put() {},
	async delete() {},
	async list() {
		return { keys: [], list_complete: true };
	},
};

const durableObjectNamespace = {
	idFromName: (name: string) => ({ name }),
	get: () => ({
		fetch: async () => new Response(null, { status: 204 }),
	}),
};

function createCompatibleConfig() {
	return {
		app: { url: "https://example.com" },
		secret: "test-secret",
		db: {
			create: () => ({ marker: "drizzle" }) as any,
		},
		collections: {},
		storage: {
			driver: {} as any,
		},
		queue: {
			jobs: {},
			adapter: cloudflareQueuesAdapter({
				queue: { send: async () => undefined },
			}),
		},
		kv: {
			adapter: cloudflareKVAdapter({ namespace: cloudflareNamespace }),
		},
		realtime: {
			adapter: cloudflareRealtimeAdapter({
				namespace: durableObjectNamespace,
			}),
		},
	} as any;
}

describe("Cloudflare compatibility", () => {
	test("reports missing explicit Cloudflare adapters", () => {
		const issues = getCloudflareCompatibilityIssues({
			app: { url: "https://example.com" },
			db: { url: "postgres://example/db" },
			collections: {},
		} as any);

		expect(issues.map((issue) => issue.path)).toEqual([
			"db",
			"storage",
			"queue.adapter",
			"kv.adapter",
			"realtime.adapter",
		]);
	});

	test("accepts explicit Cloudflare-compatible config", () => {
		const config = createCompatibleConfig();

		expect(getCloudflareCompatibilityIssues(config)).toEqual([]);
		expect(() => assertCloudflareCompatible(config)).not.toThrow();
	});

	test("reports queue adapters without Cloudflare runtime marker", () => {
		const config = createCompatibleConfig();
		config.queue.adapter = {
			capabilities: { pushConsumer: true },
			start: async () => {},
			stop: async () => {},
			publish: async () => "job_1",
			schedule: async () => {},
			unschedule: async () => {},
			createPushConsumer: () => async () => {},
			on: () => {},
		};

		const issues = getCloudflareCompatibilityIssues(config);

		expect(issues.map((issue) => issue.path)).toContain("queue.adapter");
	});

	test("throws a Cloudflare-specific error", () => {
		expect(() =>
			assertCloudflareCompatible({
				app: { url: "https://example.com" },
				db: { url: "postgres://example/db" },
				collections: {},
			} as any),
		).toThrow(CloudflareCompatibilityError);
	});
});
