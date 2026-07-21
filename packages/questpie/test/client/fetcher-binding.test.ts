import { afterEach, describe, expect, it } from "vitest";

import { RealtimeMultiplexer } from "../../src/client/realtime/multiplexer";

/**
 * Browsers throw `TypeError: Failed to execute 'fetch' on 'Window': Illegal
 * invocation` when native fetch is invoked with a foreign `this`. The
 * multiplexer stores its fetcher on the instance and calls it as a METHOD
 * (`this.fetcher(...)`), so an unbound `globalThis.fetch` default reproduces
 * exactly the admin list-view crash (autopilot a1-1b). Node/Bun fetch is
 * tolerant, so this suite simulates the browser strictness with a probe.
 */

const originalFetch = globalThis.fetch;

function strictFetch(this: unknown, ...args: Parameters<typeof fetch>) {
	if (this !== undefined && this !== globalThis) {
		throw new TypeError(
			"Failed to execute 'fetch' on 'Window': Illegal invocation (simulated)",
		);
	}
	return Promise.resolve(
		new Response(JSON.stringify({ ok: true, url: String(args[0]) }), {
			status: 200,
			headers: { "content-type": "application/json" },
		}),
	);
}

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("client fetcher binding (browser Illegal invocation guard)", () => {
	it("multiplexer default fetcher survives method-style invocation", async () => {
		globalThis.fetch = strictFetch as typeof fetch;

		// Default-constructed fetcher — must already be bound at capture time.
		const mux = new RealtimeMultiplexer("http://localhost/api");

		// This is the exact failing pattern: instance-stored fetcher invoked as
		// a method, so `this` is the multiplexer instance unless bound.
		const response = await (
			mux as unknown as { fetcher: typeof fetch }
		).fetcher("http://localhost/api/realtime");
		expect(response.status).toBe(200);
	});

	it("an unbound native-like fetch reproduces the failure through the same call shape", async () => {
		globalThis.fetch = strictFetch as typeof fetch;

		const holder = { fetcher: globalThis.fetch };
		expect(() => holder.fetcher("http://localhost/api/realtime")).toThrow(
			/Illegal invocation/,
		);
	});
});
