import type { RealtimeAdapter } from "../adapter.js";
import type { RealtimeChangeEvent, RealtimeNotice } from "../types.js";

type MaybePromise<T> = T | Promise<T>;

export interface CloudflareDurableObjectId {}

export interface CloudflareDurableObjectStub {
	fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export interface CloudflareDurableObjectNamespace {
	idFromName(name: string): CloudflareDurableObjectId;
	get(id: CloudflareDurableObjectId): CloudflareDurableObjectStub;
}

export type CloudflareDurableObjectNamespaceProvider =
	() => MaybePromise<CloudflareDurableObjectNamespace>;
export type CloudflareDurableObjectNamespaceInput =
	| CloudflareDurableObjectNamespace
	| CloudflareDurableObjectNamespaceProvider;

export interface CloudflareRealtimeAdapterOptions {
	namespace: CloudflareDurableObjectNamespaceInput;
	objectName?: string;
	hubPath?: string;
	/** Keep non-blocking notify requests alive for the current Worker event. */
	waitUntil?: (promise: Promise<unknown>) => void;
	/** Receives background publish and relay failures. Defaults to console.error. */
	onError?: (error: unknown) => void;
}

function isCloudflareDurableObjectNamespaceProvider(
	namespace: CloudflareDurableObjectNamespaceInput,
): namespace is CloudflareDurableObjectNamespaceProvider {
	return typeof namespace === "function";
}

function normalizeHubPath(path: string | undefined): string {
	if (!path) return "/__questpie/realtime";
	const withSlash = path.startsWith("/") ? path : `/${path}`;
	return withSlash.endsWith("/") ? withSlash.slice(0, -1) : withSlash;
}

function noticeFromEvent(
	event: RealtimeChangeEvent | RealtimeNotice,
): RealtimeNotice {
	return {
		seq: event.seq,
		resourceType: event.resourceType,
		resource: event.resource,
		operation: event.operation,
	};
}

type CloudflareRealtimeShard = Pick<
	RealtimeNotice,
	"resourceType" | "resource"
>;

export interface CloudflareRealtimeConnection {
	ready: Promise<void>;
	done: Promise<void>;
	close(): void;
}

export class CloudflareRealtimeAdapter implements RealtimeAdapter {
	public readonly runtime = "cloudflare" as const;

	private readonly getNamespace: CloudflareDurableObjectNamespaceProvider;
	private readonly objectName: string;
	private readonly hubPath: string;
	private readonly waitUntil?: (promise: Promise<unknown>) => void;
	private readonly onError?: (error: unknown) => void;
	private readonly handlers = new Set<(notice: RealtimeNotice) => void>();

	constructor(options: CloudflareRealtimeAdapterOptions) {
		const namespace = options.namespace;
		this.getNamespace = isCloudflareDurableObjectNamespaceProvider(namespace)
			? namespace
			: () => namespace;
		this.objectName = options.objectName ?? "questpie-realtime";
		this.hubPath = normalizeHubPath(options.hubPath);
		this.waitUntil = options.waitUntil;
		this.onError = options.onError;
	}

	get subscribePath(): string {
		return `${this.hubPath}/subscribe`;
	}

	get notifyPath(): string {
		return `${this.hubPath}/notify`;
	}

	async start(): Promise<void> {}

	async stop(): Promise<void> {
		this.handlers.clear();
	}

	async notify(event: RealtimeChangeEvent): Promise<void> {
		const notice = noticeFromEvent(event);
		const publish = this.publishNotice(notice).catch((error) => {
			this.reportError(error);
		});
		this.waitUntil?.(publish);
	}

	private async publishNotice(notice: RealtimeNotice): Promise<void> {
		const stub = await this.getStub(notice);
		const response = await stub.fetch(
			`https://questpie.internal${this.notifyPath}`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(notice),
			},
		);

		if (!response.ok) {
			throw new Error(
				`CloudflareRealtimeAdapter notify failed with ${response.status}.`,
			);
		}
	}

	private reportError(error: unknown): void {
		if (this.onError) {
			this.onError(error);
			return;
		}

		console.error("[questpie] Cloudflare realtime publish failed.", error);
	}

	subscribe(handler: (notice: RealtimeNotice) => void): () => void {
		this.handlers.add(handler);
		return () => {
			this.handlers.delete(handler);
		};
	}

	connect(
		topics: CloudflareRealtimeShard[],
		signal?: AbortSignal,
	): CloudflareRealtimeConnection {
		const abortController = new AbortController();
		const abort = () => abortController.abort();
		signal?.addEventListener("abort", abort, { once: true });

		const uniqueTopics = new Map<string, CloudflareRealtimeShard>();
		for (const topic of topics) {
			uniqueTopics.set(`${topic.resourceType}:${topic.resource}`, topic);
		}

		const streams = [...uniqueTopics.values()].map((topic) =>
			this.openShard(topic, abortController.signal),
		);
		const ready = Promise.all(streams).then(
			() => {},
			() => {},
		);
		const done = Promise.all(
			streams.map(async (stream) => this.consumeShard(await stream)),
		)
			.then(() => {})
			.catch((error) => {
				if (!abortController.signal.aborted) {
					this.reportError(error);
				}
			});

		return {
			ready,
			done,
			close: () => {
				signal?.removeEventListener("abort", abort);
				abortController.abort();
			},
		};
	}

	async fetch(request: Request): Promise<Response> {
		let body: {
			topics?: Array<{ resourceType?: unknown; resource?: unknown }>;
		};
		try {
			body = await request.clone().json();
		} catch {
			return new Response("A single realtime topic is required.", {
				status: 400,
			});
		}

		const topic = body.topics?.[0];
		if (
			body.topics?.length !== 1 ||
			(topic?.resourceType !== "collection" &&
				topic?.resourceType !== "global") ||
			typeof topic.resource !== "string" ||
			!topic.resource
		) {
			return new Response("A single realtime topic is required.", {
				status: 400,
			});
		}

		const url = new URL(request.url);
		url.pathname = this.subscribePath;
		const stub = await this.getStub({
			resourceType: topic.resourceType,
			resource: topic.resource,
		});
		return stub.fetch(new Request(url, request));
	}

	async deliver(event: RealtimeChangeEvent | RealtimeNotice): Promise<void> {
		const notice = noticeFromEvent(event);
		for (const handler of this.handlers) {
			handler(notice);
		}
	}

	private async openShard(
		shard: CloudflareRealtimeShard,
		signal: AbortSignal,
	): Promise<ReadableStream<Uint8Array>> {
		const stub = await this.getStub(shard);
		const response = await stub.fetch(
			`https://questpie.internal${this.subscribePath}`,
			{ method: "POST", signal },
		);

		if (!response.ok || !response.body) {
			throw new Error(
				`CloudflareRealtimeAdapter subscribe failed with ${response.status}.`,
			);
		}
		return response.body;
	}

	private async consumeShard(
		stream: ReadableStream<Uint8Array>,
	): Promise<void> {
		const reader = stream.getReader();
		const decoder = new TextDecoder();
		let buffered = "";

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffered += decoder.decode(value, { stream: true });
				let newlineIndex = buffered.indexOf("\n");
				while (newlineIndex >= 0) {
					const line = buffered.slice(0, newlineIndex).trim();
					buffered = buffered.slice(newlineIndex + 1);
					if (line) {
						await this.deliver(JSON.parse(line) as RealtimeNotice);
					}
					newlineIndex = buffered.indexOf("\n");
				}
			}

			const finalLine = buffered.trim();
			if (finalLine) {
				await this.deliver(JSON.parse(finalLine) as RealtimeNotice);
			}
		} finally {
			reader.releaseLock();
		}
	}

	private async getStub(
		shard: CloudflareRealtimeShard,
	): Promise<CloudflareDurableObjectStub> {
		const namespace = await this.getNamespace();
		const objectName = `${this.objectName}:${shard.resourceType}:${shard.resource}`;
		return namespace.get(namespace.idFromName(objectName));
	}
}

export function cloudflareRealtimeAdapter(
	options: CloudflareRealtimeAdapterOptions,
): CloudflareRealtimeAdapter {
	return new CloudflareRealtimeAdapter(options);
}
