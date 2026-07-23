import { afterEach, describe, expect, it } from "bun:test";

import {
	RealtimeMultiplexer,
	resolveRealtimeConnectionId,
} from "../../src/client/realtime/multiplexer";

type Mutable = Record<string, unknown>;
const originalSessionStorage = (globalThis as Mutable).sessionStorage;

afterEach(() => {
	(globalThis as Mutable).sessionStorage = originalSessionStorage;
});

describe("realtime connection identity", () => {
	it("generates a non-empty id and stays stable per tab via sessionStorage", () => {
		// No sessionStorage (server / privacy mode) → a fresh, non-empty id.
		const generated = resolveRealtimeConnectionId(() => 0.42);
		expect(typeof generated).toBe("string");
		expect(generated.length).toBeGreaterThan(0);

		// With sessionStorage → the SAME id every call, so a tab that hot-reloads or
		// refreshes (a NEW multiplexer instance) reuses its id and the server reclaims
		// its prior admission slot instead of leaking a fresh one.
		const store = new Map<string, string>();
		(globalThis as Mutable).sessionStorage = {
			getItem: (key: string) => store.get(key) ?? null,
			setItem: (key: string, value: string) => void store.set(key, value),
		};
		const first = resolveRealtimeConnectionId();
		const second = resolveRealtimeConnectionId();
		expect(first).toBe(second);
		expect(store.size).toBe(1);
	});

	it("sends its connectionId on the initial connect POST", async () => {
		const bodies: Array<{ topics?: unknown; connectionId?: unknown }> = [];
		const fetcher = ((_url: string, init?: RequestInit) => {
			bodies.push(JSON.parse(String(init?.body)));
			// A stream that stays open until the request signal aborts keeps connect()
			// parked in readStream; we only need the POST body captured, then destroy()
			// aborts it and the stream closes cleanly (no dangling promise).
			const signal = init?.signal;
			return Promise.resolve(
				new Response(
					new ReadableStream<Uint8Array>({
						start(controller) {
							if (!signal) return;
							if (signal.aborted) return void controller.close();
							signal.addEventListener(
								"abort",
								() => {
									try {
										controller.close();
									} catch {
										// Already closed by the runtime.
									}
								},
								{ once: true },
							);
						},
					}),
					{ status: 200, headers: { "content-type": "text/event-stream" } },
				),
			);
		}) as unknown as typeof fetch;

		const mux = new RealtimeMultiplexer(
			"http://localhost/api",
			true,
			0,
			{},
			undefined,
			fetcher,
		);
		mux.subscribe({ resourceType: "collection", resource: "posts" }, () => {});
		await new Promise((resolve) => setTimeout(resolve, 25));
		mux.destroy();

		expect(bodies.length).toBeGreaterThan(0);
		expect(Array.isArray(bodies[0]?.topics)).toBe(true);
		expect(typeof bodies[0]?.connectionId).toBe("string");
		expect((bodies[0]?.connectionId as string).length).toBeGreaterThan(0);
	});
});
