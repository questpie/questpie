import { expect, test } from "bun:test";

import { QueryClient, QueryObserver } from "@tanstack/query-core";

import { createClient } from "./generated/live-client";
import { createQueryAdapter } from "./generated/live-client.react-query";

const id = "018f5f6e-5f2c-7b41-a854-3d9a6b6b7131";
const date = "2026-09-08T10:00:00.000Z";
const protocol = { name: "questpie.realtime", version: 1 };

function externalPeer() {
	let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
	let streamClosed = false;
	let current: { bindingId: string; query: string } | undefined;
	const commands: {
		command: string;
		bindingId: string;
		query?: string;
		resumeToken?: string | null;
		input?: unknown;
	}[] = [];
	let ordinaryReads = 0;
	let streams = 0;
	let token = 0;
	const closed = Promise.withResolvers<void>();
	const emit = (frame: object) =>
		stream!.enqueue(
			new TextEncoder().encode(
				`data: ${JSON.stringify({ protocol, ...frame })}\n\n`,
			),
		);
	const deliver = (title: string, delivery = "update") =>
		emit({
			kind: "delivery",
			...current,
			delivery,
			payload: { id, title, updatedAt: date },
			resetReason: null,
			resumeToken: `synthetic-${++token}`,
		});
	const transport = (async (request: Request): Promise<Response> => {
		if (new URL(request.url).pathname !== "/_questpie/realtime") {
			ordinaryReads++;
			return new Response(
				JSON.stringify({
					callId: request.headers.get("Questpie-Call-Id"),
					result: { id, title: "Initial", updatedAt: date },
				}),
				{ headers: { "content-type": "application/json; charset=utf-8" } },
			);
		}
		if (request.method === "GET") {
			streams++;
			const body = new ReadableStream<Uint8Array>({
				start(controller) {
					stream = controller;
					emit({
						kind: "ready",
						scopeId: request.headers.get("x-questpie-realtime-scope"),
					});
					request.signal.addEventListener(
						"abort",
						() => {
							streamClosed = true;
							controller.close();
							closed.resolve();
						},
						{ once: true },
					);
				},
			});
			return new Response(body, {
				headers: { "content-type": "text/event-stream" },
			});
		}
		const command = await request.json();
		commands.push(command);
		if (command.command === "open") {
			current = { bindingId: command.bindingId, query: command.query };
			deliver("Initial", "initial");
		}
		return new Response(null, { status: 202 });
	}) as typeof fetch;
	return {
		transport,
		commands,
		deliver,
		closed: closed.promise,
		fail: () =>
			emit({
				kind: "failure",
				...current,
				error: { code: "AUTHORIZATION_FAILED" },
			}),
		get ordinaryReads() {
			return ordinaryReads;
		},
		get streams() {
			return streams;
		},
		get streamClosed() {
			return streamClosed;
		},
	};
}

test("unobserved generated watch prefetch releases its binding and stream after the first snapshot", async () => {
	const peer = externalPeer();
	const cache = new QueryClient();
	const client = createClient({
		baseUrl: "https://proof.invalid",
		fetch: peer.transport,
	});
	const adapter = createQueryAdapter(
		client.withContext({ companyId: id }),
		cache,
	);
	try {
		const options = adapter.queries["tasks.detail"].options({ id });
		const result = await cache.fetchQuery(options);
		await peer.closed;
		expect(result?.title).toBe("Initial");
		expect(
			peer.commands.filter((command) => command.command === "close"),
		).toHaveLength(1);
		expect(peer.streamClosed).toBe(true);
		expect(peer.ordinaryReads).toBe(0);
	} finally {
		await adapter.dispose();
		cache.clear();
	}
}, 2_000);

test("generated authorization failure retires retained native data and cannot restart via old options", async () => {
	const peer = externalPeer();
	const cache = new QueryClient();
	const client = createClient({
		baseUrl: "https://proof.invalid",
		fetch: peer.transport,
	});
	const adapter = createQueryAdapter(
		client.withContext({ companyId: id }),
		cache,
	);
	const options = adapter.queries["tasks.detail"].options({ id });
	const observer = new QueryObserver(cache, options);
	const stop = observer.subscribe(() => {});
	try {
		await cache.fetchQuery(options);
		const denied = new Promise<void>((resolve) => {
			const off = observer.subscribe((result) => {
				if (result.isError) {
					off();
					resolve();
				}
			});
		});
		peer.fail();
		await denied;
		await peer.closed;
		expect(observer.getCurrentResult().data).toBeUndefined();
		expect(cache.getQueryData(options.queryKey)).toBeUndefined();
		await expect(cache.fetchQuery(options)).rejects.toThrow("SCOPE_RETIRED");
		expect(
			peer.commands.filter((command) => command.command === "open"),
		).toHaveLength(1);
	} finally {
		stop();
		await adapter.dispose();
		cache.clear();
	}
}, 2_000);

test("generated watch supplies finite native fetch and later decoded snapshots through one transport binding", async () => {
	const peer = externalPeer();
	const cache = new QueryClient();
	const client = createClient({
		baseUrl: "https://proof.invalid",
		fetch: peer.transport,
	});
	const adapter = createQueryAdapter(
		client.withContext({ companyId: id }),
		cache,
	);
	const options = adapter.queries["tasks.detail"].options({
		id,
		asOf: new Date(date),
	});
	const observer = new QueryObserver(cache, options);
	const stop = observer.subscribe(() => {});
	try {
		const initial = await cache.fetchQuery(options);
		expect(initial?.updatedAt.toISOString()).toBe(date);
		expect(
			peer.commands.filter((command) => command.command === "open"),
		).toHaveLength(1);
		expect(peer.ordinaryReads).toBe(0);
		expect(peer.streams).toBe(1);
		expect(peer.commands[0]?.input).toEqual({ asOf: date, id });
		const updated = new Promise<void>((resolve) => {
			const off = observer.subscribe((result) => {
				if (result.data?.title === "Changed") {
					off();
					resolve();
				}
			});
		});
		peer.deliver("Changed");
		await updated;
		expect(cache.getQueryData(options.queryKey)?.title).toBe("Changed");
	} finally {
		stop();
		await adapter.dispose();
		cache.clear();
	}
}, 2_000);
