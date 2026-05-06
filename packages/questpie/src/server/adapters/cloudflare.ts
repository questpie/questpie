import { realtimeSubscribe } from "#questpie/server/adapters/routes/realtime.js";
import { assertCloudflareCompatible } from "#questpie/server/config/runtime-compatibility.js";

import type { Questpie } from "../config/questpie.js";
import type { QueuePushBatch } from "../modules/core/integrated/queue/adapter.js";
import type { JobDefinition } from "../modules/core/integrated/queue/types.js";
import type { RealtimeChangeEvent } from "../modules/core/integrated/realtime/types.js";
import { createFetchHandler } from "./http.js";
import type { AdapterConfig, AdapterContext } from "./types.js";

type MaybePromise<T> = T | Promise<T>;

export interface CloudflareQueueMessage {
	id: string;
	body: unknown;
	attempts?: number;
	ack(): MaybePromise<void>;
	retry(options?: { delaySeconds?: number }): MaybePromise<void>;
}

export interface CloudflareQueueBatch {
	messages: CloudflareQueueMessage[];
	ackAll?(): MaybePromise<void>;
	retryAll?(options?: { delaySeconds?: number }): MaybePromise<void>;
}

export interface CloudflareScheduledController {
	cron: string;
	scheduledTime?: number;
}

export interface CloudflareExecutionContext {
	waitUntil(promise: Promise<unknown>): void;
}

type CloudflareRealtimeAdapterLike = {
	runtime: "cloudflare";
	subscribePath: string;
	notifyPath: string;
	fetch(request: Request): Promise<Response>;
	deliver(event: RealtimeChangeEvent): Promise<void>;
};

export type CloudflareFetchFallback = (
	request: Request,
	context?: AdapterContext,
) => MaybePromise<Response>;

export type CloudflareAdapterConfig = AdapterConfig & {
	/**
	 * Called when the request does not match QUESTPIE's basePath.
	 * Useful when one Worker also serves a frontend renderer.
	 */
	fallback?: CloudflareFetchFallback;
};

function getCloudflareRealtimeAdapter(app: Questpie<any>) {
	const adapter = app.config.realtime?.adapter;
	if (
		!adapter ||
		typeof adapter !== "object" ||
		(adapter as { runtime?: unknown }).runtime !== "cloudflare"
	) {
		throw new Error(
			"[questpie] Cloudflare realtime adapter is required. Configure realtime.adapter with cloudflareRealtimeAdapter().",
		);
	}
	return adapter as CloudflareRealtimeAdapterLike;
}

function normalizeBasePath(basePath: string | undefined): string {
	if (!basePath || basePath === "/") return "";
	const withSlash = basePath.startsWith("/") ? basePath : `/${basePath}`;
	return withSlash.endsWith("/") ? withSlash.slice(0, -1) : withSlash;
}

function matchesRealtimePath(request: Request, basePath: string | undefined) {
	const pathname = new URL(request.url).pathname;
	const prefix = normalizeBasePath(basePath);
	return pathname === `${prefix}/realtime`;
}

export function toCloudflareQueuePushBatch(
	batch: CloudflareQueueBatch,
): QueuePushBatch {
	return {
		raw: batch,
		messages: batch.messages.map((message) => ({
			id: message.id,
			body: message.body,
			attempts: message.attempts,
			ack: async () => {
				await message.ack();
			},
			retry: async (options) => {
				await message.retry(options);
			},
		})),
		...(batch.ackAll
			? {
					ackAll: async () => {
						await batch.ackAll?.();
					},
				}
			: {}),
		...(batch.retryAll
			? {
					retryAll: async (options) => {
						await batch.retryAll?.(options);
					},
				}
			: {}),
	};
}

export function createCloudflareQueueHandler(app: Questpie<any>) {
	assertCloudflareCompatible(app.config);
	const consumer = app.queue.createPushConsumer();

	return async (batch: CloudflareQueueBatch): Promise<void> => {
		await consumer(toCloudflareQueuePushBatch(batch));
	};
}

export function createCloudflareScheduledHandler(app: Questpie<any>) {
	assertCloudflareCompatible(app.config);

	return async (
		controller: CloudflareScheduledController,
		_env?: unknown,
		ctx?: CloudflareExecutionContext,
	): Promise<void> => {
		const run = publishScheduledJobs(app, controller.cron);
		ctx?.waitUntil(run);
		if (!ctx) await run;
	};
}

export async function publishScheduledJobs(
	app: Questpie<any>,
	cron: string,
): Promise<number> {
	const queue = app.queue as Record<string, unknown>;
	const jobs = (app.config.queue?.jobs ?? {}) as Record<string, JobDefinition>;
	let published = 0;

	for (const [jobKey, job] of Object.entries(jobs)) {
		if (job.options?.cron !== cron) continue;

		const payload = job.schema.parse({});
		const queueJob = queue[jobKey] as
			| { publish(payload: unknown): Promise<string | null> }
			| undefined;
		if (!queueJob) {
			throw new Error(
				`[questpie] Queue job "${jobKey}" is not available on app.queue.`,
			);
		}

		await queueJob.publish(payload);
		published += 1;
	}

	return published;
}

export function createCloudflareFetchHandler(
	app: Questpie<any>,
	config: CloudflareAdapterConfig = {},
) {
	assertCloudflareCompatible(app.config);
	const fetchHandler = createFetchHandler(app, config);

	return async (
		request: Request,
		context?: AdapterContext,
	): Promise<Response> => {
		if (matchesRealtimePath(request, config.basePath)) {
			return getCloudflareRealtimeAdapter(app).fetch(request);
		}

		const response = await fetchHandler(request, context);
		if (response) return response;

		return (
			(await config.fallback?.(request, context)) ??
			new Response("Not Found", { status: 404 })
		);
	};
}

export function createCloudflareRealtimeDurableObjectHandler(
	app: Questpie<any>,
	config: AdapterConfig = {},
) {
	assertCloudflareCompatible(app.config);
	const adapter = getCloudflareRealtimeAdapter(app);

	return async (request: Request): Promise<Response> => {
		const url = new URL(request.url);

		if (request.method === "POST" && url.pathname === adapter.notifyPath) {
			const event = (await request.json()) as RealtimeChangeEvent;
			await adapter.deliver(event);
			return new Response(null, { status: 204 });
		}

		if (request.method === "POST" && url.pathname === adapter.subscribePath) {
			return realtimeSubscribe(app, request, {}, undefined, config);
		}

		return new Response("Not Found", { status: 404 });
	};
}

export function createCloudflareWorkerHandlers(
	app: Questpie<any>,
	config: CloudflareAdapterConfig = {},
) {
	return {
		fetch: createCloudflareFetchHandler(app, config),
		queue: createCloudflareQueueHandler(app),
		scheduled: createCloudflareScheduledHandler(app),
	};
}
