import { afterEach, describe, expect, it, spyOn } from "bun:test";

import { createClient } from "../../src/client/index.js";
import {
	realtimeTopicKey,
	type TopicConfig,
} from "../../src/client/realtime/multiplexer.js";
import {
	deserializeCompatibleTypedEventWire,
	stringifyCompatibleTypedEventWire,
} from "../../src/shared/typed-wire.js";

async function waitFor(predicate: () => boolean) {
	for (let attempt = 0; attempt < 100; attempt++) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error("Timed out waiting for route subscription");
}
const clients: ReturnType<typeof createClient>[] = [];
afterEach(() => {
	for (const client of clients.splice(0)) client.realtime.destroy();
});

describe("route LIVE client", () => {
	it("uses the declared catch-all parameter name for HTTP and LIVE", async () => {
		let requestedUrl = "";
		const client = createClient<any>({
			baseURL: "http://fixture.local",
			basePath: "/api",
			useSuperJSON: false,
			fetch: async (url) => {
				requestedUrl = String(url);
				return Response.json({ ok: true });
			},
		});
		clients.push(client);
		const params = { path: "folder/note ?#" };
		await client.routes.files["[...path]"].post({}, { params });
		expect(requestedUrl).toBe(
			"http://fixture.local/api/files/folder%2Fnote%20%3F%23",
		);
		const stream = spyOn(client.realtime, "stream").mockImplementation(
			async function* () {
				yield { ok: true };
			},
		);
		try {
			const watch = client.routes.files["[...path]"].post.watch({}, { params });
			expect((await watch[Symbol.asyncIterator]().next()).value).toEqual({
				ok: true,
			});
			expect(stream.mock.calls[0]?.[0]).toMatchObject({
				resource: "files/[...path]",
				params,
			});
			expect(() =>
				client.routes.files["[...path]"].post.watch(
					{},
					{ params: { path: "" } },
				),
			).toThrow("Missing route parameter: path");
		} finally {
			stream.mockRestore();
		}
	});

	it("substitutes path params for the same HTTP route, with locale and cancellation", async () => {
		let captured: { url: string; init?: RequestInit } | undefined;
		const client = createClient<any>({
			baseURL: "http://fixture.local",
			basePath: "/api",
			useSuperJSON: false,
			fetch: async (url, init) => {
				captured = { url: String(url), init };
				return Response.json({ ok: true });
			},
		});
		clients.push(client);
		const abort = new AbortController();
		await client.routes.projects["[projectId]"].workingRuns.post(
			{ limit: 3 },
			{ params: { projectId: "a/b ?#" }, locale: "sk", signal: abort.signal },
		);
		expect(captured?.url).toBe(
			"http://fixture.local/api/projects/a%2Fb%20%3F%23/working-runs",
		);
		expect(JSON.parse(String(captured?.init?.body))).toEqual({ limit: 3 });
		expect(new Headers(captured?.init?.headers).get("accept-language")).toBe(
			"sk",
		);
		expect(captured?.init?.signal).toBe(abort.signal);
		await expect(
			client.routes.projects["[projectId]"].workingRuns.post({}),
		).rejects.toThrow("Missing route parameter: projectId");
		expect(() =>
			client.routes.projects["[projectId]"].workingRuns.post.watch({}),
		).toThrow("Missing route parameter: projectId");
		for (const projectId of [".", ".."]) {
			await expect(
				client.routes.projects["[projectId]"].workingRuns.post(
					{},
					{ params: { projectId } },
				),
			).rejects.toThrow("Route parameters cannot be dot segments");
			expect(() =>
				client.routes.projects["[projectId]"].workingRuns.post.watch(
					{},
					{ params: { projectId } },
				),
			).toThrow("Route parameters cannot be dot segments");
		}
	});

	it("shares SSE with collections and preserves typed wire data and sibling delivery after denial", async () => {
		const openings: Array<{
			topics: Array<Record<string, unknown>>;
			send: (event: string, value: Record<string, unknown>) => void;
		}> = [];
		let httpCalls = 0;
		const encoder = new TextEncoder();
		const client = createClient<any>({
			baseURL: "http://fixture.local",
			fetch: async (url, init) => {
				if (String(url).endsWith("/realtime/config"))
					return Response.json({ provider: "sse" });
				if (!String(url).endsWith("/realtime")) {
					httpCalls++;
					throw new Error("Unexpected one-shot fetch");
				}
				const payload = JSON.parse(String(init?.body));
				if (payload.sessionId)
					return Response.json({ status: "accepted" }, { status: 202 });
				let controller!: ReadableStreamDefaultController<Uint8Array>;
				let closed = false;
				const body = new ReadableStream<Uint8Array>({
					start(value) {
						controller = value;
					},
					cancel() {
						closed = true;
					},
				});
				const send = (event: string, value: Record<string, unknown>) => {
					if (!closed)
						controller.enqueue(
							encoder.encode(
								`event: ${event}\ndata: ${stringifyCompatibleTypedEventWire(value)}\n\n`,
							),
						);
				};
				init?.signal?.addEventListener("abort", () => {
					if (!closed) {
						closed = true;
						controller.close();
					}
				});
				openings.push({ topics: payload.topics, send });
				send("session", {
					sessionId: "session",
					token: "token",
					control: { protocol: "questpie-realtime-topology", versions: [2] },
				});
				return new Response(body, {
					headers: { "Content-Type": "text/event-stream" },
				});
			},
		});
		clients.push(client);
		client.setLocale("sk");
		const abort = new AbortController();
		const at = new Date("2026-10-22T12:00:00.000Z");
		const routeSource = client.routes.projects[
			"[projectId]"
		].workingRuns.post.watch(
			{ at, label: at.toISOString() },
			{ params: { projectId: "p1" }, signal: abort.signal },
		);
		const route = routeSource[Symbol.asyncIterator]();
		const collectionSource = client.realtime.stream(
			{ resourceType: "collection", resource: "tasks" },
			abort.signal,
		);
		const collection = collectionSource[Symbol.asyncIterator]();
		const firstRoute = route.next();
		const firstCollection = collection.next();
		await waitFor(() => openings.length === 1);
		const opening = openings[0]!;
		expect(opening.topics).toHaveLength(2);
		const raw = opening.topics.find((topic) => topic.resourceType === "route")!;
		const decoded =
			deserializeCompatibleTypedEventWire<Record<string, unknown>>(raw);
		expect(decoded).toMatchObject({
			resource: "projects/[projectId]/workingRuns",
			operation: "query",
			method: "POST",
			params: { projectId: "p1" },
			locale: "sk",
			input: { at, label: at.toISOString() },
		});
		expect((decoded.input as { at: Date }).at).toBeInstanceOf(Date);
		const sibling = opening.topics.find(
			(topic) => topic.resourceType === "collection",
		)!;
		opening.send("snapshot", {
			topicId: raw.id,
			seq: 1,
			data: { at, names: ["Ada"] },
		});
		opening.send("snapshot", {
			topicId: sibling.id,
			seq: 1,
			data: { docs: [{ id: "1" }] },
		});
		expect((await firstRoute).value).toEqual({ at, names: ["Ada"] });
		expect((await firstCollection).value).toEqual({ docs: [{ id: "1" }] });
		const rejected = route.next();
		const siblingNext = collection.next();
		opening.send("error", {
			code: "REALTIME_TOPIC_REJECTED",
			topicId: raw.id,
			resource: decoded.resource,
			operation: "query",
			message: "Access ended",
			retryable: false,
			details: { reason: "access" },
		});
		await expect(rejected).rejects.toMatchObject({
			code: "REALTIME_TOPIC_REJECTED",
			retryable: false,
		});
		opening.send("snapshot", {
			topicId: sibling.id,
			seq: 2,
			data: { docs: [{ id: "2" }] },
		});
		expect((await siblingNext).value).toMatchObject({ docs: [{ id: "2" }] });
		expect(openings).toHaveLength(1);
		expect(httpCalls).toBe(0);
		abort.abort();
		await collection.return?.();
		expect(client.realtime.topicCount).toBe(0);
	});

	it("distinguishes Dates, ISO strings and different instants in topic identity", () => {
		const topic = (at: unknown): TopicConfig => ({
			resourceType: "route",
			resource: "runs",
			operation: "query",
			method: "POST",
			input: { at },
		});
		const at = new Date("2026-10-22T12:00:00.000Z");
		expect(realtimeTopicKey(topic(at))).not.toBe(
			realtimeTopicKey(topic(at.toISOString())),
		);
		expect(realtimeTopicKey(topic(at))).not.toBe(
			realtimeTopicKey(topic(new Date(at.getTime() + 1))),
		);
		expect(realtimeTopicKey(topic(at))).toBe(
			realtimeTopicKey(topic(new Date(at))),
		);
	});
});
