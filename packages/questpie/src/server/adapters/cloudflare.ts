import { realtimeSubscribe } from "#questpie/server/adapters/routes/realtime.js";
import { assertCloudflareCompatible } from "#questpie/server/config/runtime-compatibility.js";

import type { Questpie } from "../config/questpie.js";
import type { QueuePushBatch } from "../modules/core/integrated/queue/adapter.js";
import type { JobDefinition } from "../modules/core/integrated/queue/types.js";
import type {
	RealtimeChangeEvent,
	RealtimeNotice,
} from "../modules/core/integrated/realtime/types.js";
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
	deliver(event: RealtimeChangeEvent | RealtimeNotice): Promise<void>;
	subscribe(handler: (notice: RealtimeNotice) => void): () => void;
	connect(
		topics: Array<Pick<RealtimeNotice, "resourceType" | "resource">>,
		signal?: AbortSignal,
	): { ready: Promise<void>; done: Promise<void>; close(): void };
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

function createCloudflareNoticeStream(
	adapter: CloudflareRealtimeAdapterLike,
): Response {
	const encoder = new TextEncoder();
	let unsubscribe: (() => void) | undefined;
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			unsubscribe = adapter.subscribe((notice) => {
				controller.enqueue(encoder.encode(`${JSON.stringify(notice)}\n`));
			});
		},
		cancel() {
			unsubscribe?.();
		},
	});

	return new Response(stream, {
		headers: {
			"Cache-Control": "no-cache, no-transform",
			"Content-Type": "application/x-ndjson",
		},
	});
}

async function readCloudflareRealtimeShards(
	request: Request,
): Promise<Array<Pick<RealtimeNotice, "resourceType" | "resource">>> {
	try {
		const body = (await request.json()) as {
			topics?: Array<{ resourceType?: unknown; resource?: unknown }>;
		};
		if (!Array.isArray(body.topics)) return [];

		return body.topics.flatMap((topic) => {
			if (
				(topic.resourceType !== "collection" &&
					topic.resourceType !== "global") ||
				typeof topic.resource !== "string" ||
				!topic.resource
			) {
				return [];
			}

			return [
				{
					resourceType: topic.resourceType,
					resource: topic.resource,
				},
			];
		});
	} catch {
		return [];
	}
}

function withCloudflareRealtimeCleanup(
	response: Response,
	cleanup: () => void,
): Response {
	if (!response.body) {
		cleanup();
		return response;
	}

	const reader = response.body.getReader();
	let cleanedUp = false;
	const close = () => {
		if (cleanedUp) return;
		cleanedUp = true;
		cleanup();
	};
	const stream = new ReadableStream<Uint8Array>({
		async pull(controller) {
			try {
				const { done, value } = await reader.read();
				if (done) {
					close();
					controller.close();
					return;
				}
				controller.enqueue(value);
			} catch (error) {
				close();
				controller.error(error);
			}
		},
		async cancel(reason) {
			close();
			await reader.cancel(reason);
		},
	});

	return new Response(stream, {
		headers: response.headers,
		status: response.status,
		statusText: response.statusText,
	});
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
			const adapter = getCloudflareRealtimeAdapter(app);
			const shardsRequest = request.clone();
			const response = await realtimeSubscribe(
				app,
				request,
				{},
				context,
				config,
			);
			if (!response.ok || !response.body) return response;

			const shards = await readCloudflareRealtimeShards(shardsRequest);
			if (shards.length === 0) return response;

			const connection = adapter.connect(shards, request.signal);
			await connection.ready;
			return withCloudflareRealtimeCleanup(response, connection.close);
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
	void config;
	const adapter = getCloudflareRealtimeAdapter(app);

	return async (request: Request): Promise<Response> => {
		const url = new URL(request.url);

		if (request.method === "POST" && url.pathname === adapter.notifyPath) {
			const notice = (await request.json()) as RealtimeNotice;
			await adapter.deliver(notice);
			return new Response(null, { status: 204 });
		}

		if (request.method === "POST" && url.pathname === adapter.subscribePath) {
			return createCloudflareNoticeStream(adapter);
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
