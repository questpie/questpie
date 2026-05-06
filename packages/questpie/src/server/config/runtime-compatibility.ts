import type {
	DbConfig,
	QuestpieConfig,
} from "#questpie/server/config/types.js";
import type { QueueAdapter } from "#questpie/server/modules/core/integrated/queue/adapter.js";

export interface CloudflareCompatibilityIssue {
	path: string;
	message: string;
}

export class CloudflareCompatibilityError extends Error {
	constructor(public readonly issues: CloudflareCompatibilityIssue[]) {
		super(
			`[questpie] Cloudflare adapter is not compatible with the current app config:\n${issues
				.map((issue) => `  - ${issue.path}: ${issue.message}`)
				.join("\n")}`,
		);
		this.name = "CloudflareCompatibilityError";
	}
}

function isCloudflareDbConfig(db: DbConfig): boolean {
	return "drizzle" in db || "create" in db;
}

function getAdapterName(adapter: unknown): string {
	if (!adapter || typeof adapter !== "object") return "";
	return adapter.constructor?.name ?? "";
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
	return (
		!!value &&
		typeof value === "object" &&
		"then" in value &&
		typeof value.then === "function"
	);
}

function hasPushConsumer(adapter: QueueAdapter): boolean {
	return adapter.capabilities?.pushConsumer ?? !!adapter.createPushConsumer;
}

function isCloudflareRuntimeAdapter(adapter: unknown): boolean {
	if (!adapter || typeof adapter !== "object") return false;
	return (adapter as { runtime?: unknown }).runtime === "cloudflare";
}

const TCP_REALTIME_ADAPTERS = new Set([
	"PgNotifyAdapter",
	"RedisStreamsAdapter",
]);

export function getCloudflareCompatibilityIssues(
	config: QuestpieConfig,
): CloudflareCompatibilityIssue[] {
	const issues: CloudflareCompatibilityIssue[] = [];

	if (!isCloudflareDbConfig(config.db)) {
		issues.push({
			path: "db",
			message:
				"Cloudflare Workers cannot use the built-in Bun SQL or PGlite database config. Provide db: { create: ({ schema }) => ... } or db: { drizzle: ... } with a Cloudflare-compatible Drizzle driver, such as Hyperdrive + postgres-js.",
		});
	}

	if (!config.storage || !("driver" in config.storage)) {
		issues.push({
			path: "storage",
			message:
				"Cloudflare Workers do not provide local filesystem storage. Provide storage: { driver: ... } backed by R2 or S3-compatible storage.",
		});
	}

	if (!config.queue?.adapter) {
		issues.push({
			path: "queue.adapter",
			message:
				"Cloudflare Workers require an explicit queue adapter. Use cloudflareQueuesAdapter with a Queues producer binding.",
		});
	} else if (
		!isCloudflareRuntimeAdapter(config.queue.adapter) ||
		!hasPushConsumer(config.queue.adapter)
	) {
		issues.push({
			path: "queue.adapter",
			message:
				'Cloudflare Workers require a Cloudflare push-based queue adapter. Use cloudflareQueuesAdapter or a custom adapter with runtime: "cloudflare" and createPushConsumer().',
		});
	}

	const emailAdapter = config.email?.adapter;
	if (emailAdapter && !isPromiseLike(emailAdapter)) {
		const adapterName = getAdapterName(emailAdapter);
		if (adapterName === "SmtpAdapter") {
			issues.push({
				path: "email.adapter",
				message:
					"SMTP adapters require raw TCP sockets. Use an HTTP-based email adapter for Cloudflare Workers.",
			});
		}
	}

	if (!config.kv?.adapter) {
		issues.push({
			path: "kv.adapter",
			message:
				"Cloudflare Workers require an explicit KV adapter. Use cloudflareKVAdapter with a Workers KV namespace binding.",
		});
	} else if (!isCloudflareRuntimeAdapter(config.kv.adapter)) {
		issues.push({
			path: "kv.adapter",
			message:
				'Cloudflare Workers require a Cloudflare KV adapter. Use cloudflareKVAdapter or a custom adapter with runtime: "cloudflare".',
		});
	}

	const realtimeAdapterName = getAdapterName(config.realtime?.adapter);
	if (!config.realtime?.adapter) {
		issues.push({
			path: "realtime.adapter",
			message:
				"Cloudflare Workers require an explicit realtime adapter. Use cloudflareRealtimeAdapter with a Durable Object namespace binding.",
		});
	} else if (
		TCP_REALTIME_ADAPTERS.has(realtimeAdapterName) ||
		!isCloudflareRuntimeAdapter(config.realtime.adapter)
	) {
		issues.push({
			path: "realtime.adapter",
			message:
				"Cloudflare Workers require a Cloudflare realtime adapter. pg_notify, Redis Streams, and polling fallbacks are not supported.",
		});
	}

	return issues;
}

export function assertCloudflareCompatible(config: QuestpieConfig): void {
	const issues = getCloudflareCompatibilityIssues(config);
	if (issues.length > 0) {
		throw new CloudflareCompatibilityError(issues);
	}
}
