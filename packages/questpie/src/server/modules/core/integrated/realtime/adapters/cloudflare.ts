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

export class CloudflareRealtimeAdapter implements RealtimeAdapter {
	public readonly runtime = "cloudflare" as const;

	private readonly getNamespace: CloudflareDurableObjectNamespaceProvider;
	private readonly objectName: string;
	private readonly hubPath: string;
	private readonly handlers = new Set<(notice: RealtimeNotice) => void>();

	constructor(options: CloudflareRealtimeAdapterOptions) {
		const namespace = options.namespace;
		this.getNamespace = isCloudflareDurableObjectNamespaceProvider(namespace)
			? namespace
			: () => namespace;
		this.objectName = options.objectName ?? "questpie-realtime";
		this.hubPath = normalizeHubPath(options.hubPath);
	}

	get subscribePath(): string {
		return `${this.hubPath}/subscribe`;
	}

	get notifyPath(): string {
		return `${this.hubPath}/notify`;
	}

	async start(): Promise<void> {}
	async startPublisher(): Promise<void> {}

	async stop(): Promise<void> {
		this.handlers.clear();
	}

	async notify(event: RealtimeChangeEvent): Promise<void> {
		const stub = await this.getStub();
		const response = await stub.fetch(
			`https://questpie.internal${this.notifyPath}`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(event),
			},
		);

		if (!response.ok) {
			throw new Error(
				`CloudflareRealtimeAdapter notify failed with ${response.status}.`,
			);
		}
	}

	subscribe(handler: (notice: RealtimeNotice) => void): () => void {
		this.handlers.add(handler);
		return () => {
			this.handlers.delete(handler);
		};
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		url.pathname = this.subscribePath;
		const stub = await this.getStub();
		return stub.fetch(new Request(url, request));
	}

	async deliver(event: RealtimeChangeEvent | RealtimeNotice): Promise<void> {
		const notice = noticeFromEvent(event);
		for (const handler of this.handlers) {
			handler(notice);
		}
	}

	private async getStub(): Promise<CloudflareDurableObjectStub> {
		const namespace = await this.getNamespace();
		return namespace.get(namespace.idFromName(this.objectName));
	}
}

export function cloudflareRealtimeAdapter(
	options: CloudflareRealtimeAdapterOptions,
): CloudflareRealtimeAdapter {
	return new CloudflareRealtimeAdapter(options);
}
