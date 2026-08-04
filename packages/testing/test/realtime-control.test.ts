import { describe, expect, it } from "bun:test";

import { createEvidence, cycleRealtimeTransport } from "../src/scenario.js";

/*
 * UC-TEST-023, 024. The helper drives the caller's own transport. It never
 * writes to a ledger, a table or anything else durable, so a fault test cannot
 * quietly corrupt the state it is meant to observe.
 */

function transport() {
	const calls: string[] = [];
	return {
		calls,
		control: {
			disconnect: () => void calls.push("disconnect"),
			connect: () => void calls.push("connect"),
		},
	};
}

describe("UC-TEST-023 transport-restart-boundary", () => {
	it("drops the transport and brings it back", async () => {
		const { calls, control } = transport();

		const result = await cycleRealtimeTransport(control);

		expect(calls).toEqual(["disconnect", "connect"]);
		expect(result.reconnected).toBe(true);
	});

	it("leaves the transport down when the caller only wants the drop", async () => {
		const { calls, control } = transport();

		const result = await cycleRealtimeTransport(control, { reconnect: false });

		expect(calls).toEqual(["disconnect"]);
		expect(result.reconnected).toBe(false);
	});

	it("waits between the drop and the reconnect when asked", async () => {
		const { control } = transport();
		const started = Date.now();

		await cycleRealtimeTransport(control, { downtimeMs: 30 });

		expect(Date.now() - started).toBeGreaterThanOrEqual(25);
	});

	it("awaits an async transport", async () => {
		const calls: string[] = [];
		await cycleRealtimeTransport({
			disconnect: async () => {
				await Bun.sleep(5);
				calls.push("disconnect");
			},
			connect: async () => {
				await Bun.sleep(5);
				calls.push("connect");
			},
		});

		expect(calls).toEqual(["disconnect", "connect"]);
	});

	it("reconnects even when the disconnect throws, so a fault test cannot leave it down", async () => {
		const calls: string[] = [];

		await expect(
			cycleRealtimeTransport({
				disconnect: () => {
					throw new Error("socket already closed");
				},
				connect: () => void calls.push("connect"),
			}),
		).rejects.toThrow("socket already closed");
		expect(calls).toEqual(["connect"]);
	});

	it("refuses a transport without a disconnect", () => {
		expect(() =>
			cycleRealtimeTransport({} as unknown as { disconnect: () => void }),
		).toThrow(TypeError);
	});

	it("requires a connect when a reconnect was asked for", () => {
		expect(() => cycleRealtimeTransport({ disconnect: () => {} })).toThrow(
			TypeError,
		);
	});

	it("accepts a disconnect-only transport when no reconnect is wanted", async () => {
		const result = await cycleRealtimeTransport(
			{ disconnect: () => {} },
			{ reconnect: false },
		);

		expect(result.reconnected).toBe(false);
	});
});

describe("UC-TEST-024 fault-controls-carry-evidence", () => {
	it("records the boundary it drove", async () => {
		const evidence = createEvidence({});
		const { control } = transport();

		await cycleRealtimeTransport(control, { downtimeMs: 1, evidence });

		const log = evidence.tail().join("\n");
		expect(log).toContain("realtime transport disconnected");
		expect(log).toContain("realtime transport reconnected");
	});
});
