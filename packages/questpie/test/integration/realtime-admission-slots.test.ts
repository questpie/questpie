import { afterEach, describe, expect, test } from "bun:test";

import { collection } from "../../src/exports/index.js";
import { createFetchHandler } from "../../src/server/adapters/http.js";
import { isRealtimeTopicRejectedPayload } from "../../src/shared/realtime-error.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { runTestDbMigrations } from "../utils/test-db";

/**
 * Connection slots, end to end through the real SSE route.
 *
 * The outage these cover: a slot was released only by an explicit teardown, so
 * when nothing propagated the client's disconnect the count was immortal and
 * the principal was locked out until the process restarted. Before this suite
 * there was no test anywhere asserting that an SSE slot is ever released.
 */

type Setup = Awaited<ReturnType<typeof buildMockApp>>;

let setup: Setup | undefined;

afterEach(async () => {
	await setup?.cleanup?.();
	setup = undefined;
});

const SESSION = {
	user: { id: "slot-user" },
	session: { id: "slot-session" },
};

async function build(realtime: Record<string, unknown>) {
	const built = await buildMockApp(
		{
			collections: {
				posts: collection("posts")
					.fields(({ f }) => ({ title: f.text().required() }))
					.access({ read: true }),
			},
		},
		{ realtime: { retentionDays: 0, ...realtime } as never },
	);
	await runTestDbMigrations(built.app);
	setup = built;
	return built;
}

function handlerFor(app: Setup["app"], authenticated: boolean) {
	return createFetchHandler(app, {
		getSession: async () => (authenticated ? SESSION : null),
	});
}

function subscribeRequest(signal?: AbortSignal) {
	return new Request("http://localhost/realtime", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			topics: [
				{
					id: "posts-all",
					resourceType: "collection",
					resource: "posts",
					operation: "find",
					limit: 10,
				},
			],
		}),
		...(signal ? { signal } : {}),
	});
}

/** A client that never reads its stream — the shape of an abandoned peer. */
async function subscribe(
	handler: (request: Request) => Promise<Response>,
	signal?: AbortSignal,
): Promise<Response> {
	const response = await handler(subscribeRequest(signal));
	if (response.status !== 200) await response.text().catch(() => {});
	return response;
}

/** A client that keeps reading, the way a live browser does. */
function liveReader(body: ReadableStream<Uint8Array>) {
	const reader = body.getReader();
	const pump = (async () => {
		try {
			// `close()` cancels the reader, which resolves the pending read as done.
			for (;;) {
				const chunk = await reader.read();
				if (chunk.done) return;
			}
		} catch {
			// Cancelled by the test.
		}
	})();
	return {
		close: async () => {
			await reader.cancel().catch(() => {});
			await pump;
		},
	};
}

/**
 * Read until the named SSE event arrives, so a test can be sure the stream is
 * fully established. Without this, tearing a connection down mid-`start()`
 * releases the slot through the start-catch and proves nothing about the
 * disconnect paths.
 */
async function awaitEvent(
	body: ReadableStream<Uint8Array>,
	event: string,
	timeoutMs: number,
): Promise<void> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let seen = "";
	let timer: ReturnType<typeof setTimeout> | undefined;
	const expired = new Promise<"timeout">((resolve) => {
		timer = setTimeout(() => resolve("timeout"), timeoutMs);
	});
	try {
		for (;;) {
			const outcome = await Promise.race([reader.read(), expired]);
			if (outcome === "timeout") {
				throw new Error(`Timed out waiting for SSE event "${event}"`);
			}
			if (outcome.done) {
				throw new Error(`Stream ended before SSE event "${event}"`);
			}
			seen += decoder.decode(outcome.value, { stream: true });
			if (seen.includes(`event: ${event}`)) return;
		}
	} finally {
		if (timer) clearTimeout(timer);
		reader.releaseLock();
	}
}

async function readsToCompletion(
	body: ReadableStream<Uint8Array>,
	timeoutMs: number,
): Promise<boolean> {
	const reader = body.getReader();
	let timer: ReturnType<typeof setTimeout> | undefined;
	const expired = new Promise<"timeout">((resolve) => {
		timer = setTimeout(() => resolve("timeout"), timeoutMs);
	});
	try {
		for (;;) {
			const outcome = await Promise.race([reader.read(), expired]);
			if (outcome === "timeout") return false;
			if (outcome.done) return true;
		}
	} finally {
		if (timer) clearTimeout(timer);
		reader.releaseLock();
	}
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("realtime admission slots", () => {
	// TTL is 4 keepalive beats, so 60ms of keepalive is a 240ms lease.
	const FAST_LEASE = { keepAliveIntervalMs: 60 };
	const LEASE_MS = 60 * 4;

	test("a leaked slot self-heals after the TTL, and its stream is torn down", async () => {
		const built = await build({
			...FAST_LEASE,
			admission: { maxConnectionsPerPrincipal: 2 },
		});
		const handler = handlerFor(built.app, true);

		const first = await subscribe(handler);
		const second = await subscribe(handler);
		const refused = await subscribe(handler);
		expect([first.status, second.status, refused.status]).toEqual([
			200, 200, 400,
		]);

		// Nobody read either stream and nothing aborted them: exactly the state
		// the runtime leaves behind when it never reports the disconnect.
		await sleep(LEASE_MS + 200);

		const readmitted = await subscribe(handler);
		expect(readmitted.status).toBe(200);

		// Reclaiming the slot must also close the stream holding it — otherwise
		// the scheduler group and topology heartbeat behind it leak on.
		expect(await readsToCompletion(first.body!, 2000)).toBe(true);

		await readmitted.body?.cancel().catch(() => {});
		await second.body?.cancel().catch(() => {});
	}, 30_000);

	test("a live client renews its lease, so the TTL never evicts it", async () => {
		const built = await build({
			...FAST_LEASE,
			admission: { maxConnectionsPerPrincipal: 1 },
		});
		const handler = handlerFor(built.app, true);

		const live = await subscribe(handler);
		expect(live.status).toBe(200);
		const reader = liveReader(live.body!);

		// Three lease windows of an idle-but-read stream. Only the keepalive
		// flows, which is the point: the TTL has to outlast a silent connection.
		await sleep(LEASE_MS * 3);

		const refused = await subscribe(handler);
		expect(refused.status).toBe(400);

		await reader.close();
	}, 30_000);

	test("an unauthenticated client is subject to a cap", async () => {
		const built = await build({
			...FAST_LEASE,
			admission: {
				maxConnectionsPerPrincipal: 5,
				maxAnonymousConnections: 2,
			},
		});
		const handler = handlerFor(built.app, false);

		const statuses: number[] = [];
		const bodies: ReadableStream<Uint8Array>[] = [];
		let lastRefusal: Response | undefined;
		for (let index = 0; index < 4; index += 1) {
			const response = await handler(subscribeRequest());
			statuses.push(response.status);
			if (response.status === 200 && response.body) bodies.push(response.body);
			else lastRefusal = response;
		}
		// Every anonymous connection shares one bucket, so the cap binds.
		expect(statuses).toEqual([200, 200, 400, 400]);

		const payload = (await lastRefusal!.json()) as {
			errors: unknown[];
		};
		expect(payload.errors).toHaveLength(1);
		expect(isRealtimeTopicRejectedPayload(payload.errors[0])).toBe(true);
		expect(payload.errors[0]).toMatchObject({
			details: { reason: "connection_limit", configuredLimit: 2, observed: 2 },
		});

		for (const body of bodies) await body.cancel().catch(() => {});
	}, 30_000);

	test("a connection_limit rejection reaches the client typed, with both numbers", async () => {
		const built = await build({
			...FAST_LEASE,
			admission: { maxConnectionsPerPrincipal: 1 },
		});
		const handler = handlerFor(built.app, true);

		const held = await subscribe(handler);
		expect(held.status).toBe(200);

		const refused = await handler(subscribeRequest());
		expect(refused.status).toBe(400);
		const payload = (await refused.json()) as { errors: unknown[] };
		const rejection = payload.errors[0];
		expect(isRealtimeTopicRejectedPayload(rejection)).toBe(true);
		expect(rejection).toMatchObject({
			code: "REALTIME_TOPIC_REJECTED",
			topicId: "posts-all",
			resource: "posts",
			operation: "find",
			retryable: false,
			details: {
				reason: "connection_limit",
				// The configured cap and what the server actually counted. These
				// two numbers are the entire diagnosis.
				configuredLimit: 1,
				observed: 1,
			},
		});
		expect((rejection as { message: string }).message).toContain("1 of 1");

		await held.body?.cancel().catch(() => {});
	}, 30_000);

	test("an SSE slot is released when the client disconnects", async () => {
		// A lease far longer than the test, so only a real release path can free
		// the slot here — the TTL cannot stand in for it.
		const built = await build({
			keepAliveIntervalMs: 30_000,
			admission: { maxConnectionsPerPrincipal: 1 },
		});
		const handler = handlerFor(built.app, true);

		// 1. The client aborts the request (browser navigation, watchdog reconnect).
		const aborter = new AbortController();
		const aborted = await subscribe(handler, aborter.signal);
		expect(aborted.status).toBe(200);
		await awaitEvent(aborted.body!, "snapshot", 5000);
		await sleep(100);
		expect((await subscribe(handler)).status).toBe(400);

		aborter.abort();
		await sleep(100);
		const afterAbort = await subscribe(handler);
		expect(afterAbort.status).toBe(200);

		// 2. The consumer cancels the response body.
		await awaitEvent(afterAbort.body!, "snapshot", 5000);
		await sleep(100);
		expect((await subscribe(handler)).status).toBe(400);

		await afterAbort.body!.cancel();
		await sleep(100);
		const afterCancel = await subscribe(handler);
		expect(afterCancel.status).toBe(200);
		await afterCancel.body?.cancel().catch(() => {});
	}, 30_000);
});
