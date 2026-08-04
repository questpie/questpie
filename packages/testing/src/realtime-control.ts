import type { Evidence } from "./evidence.js";

export interface RealtimeTransportControl {
	disconnect(): void | Promise<void>;
	connect?(): void | Promise<void>;
}

export interface CycleRealtimeTransportOptions {
	/** Bring the transport back up. Default true. */
	reconnect?: boolean;
	/** How long to stay down, so a client's own retry can be observed. */
	downtimeMs?: number;
	evidence?: Evidence;
}

export interface RealtimeTransportCycle {
	reconnected: boolean;
}

/**
 * Drops a realtime transport and brings it back.
 *
 * Transport-agnostic on purpose: it calls the caller's own connect and
 * disconnect and touches nothing else. It never writes to a channel ledger or
 * any other durable store, because a fault helper that edits the state a test
 * is about to assert on has decided the outcome in advance.
 */
export async function cycleRealtimeTransport(
	control: RealtimeTransportControl,
	options: CycleRealtimeTransportOptions = {},
): Promise<RealtimeTransportCycle> {
	if (typeof control?.disconnect !== "function") {
		throw new TypeError("control.disconnect must be a function");
	}
	const reconnect = options.reconnect ?? true;
	if (reconnect && typeof control.connect !== "function") {
		throw new TypeError(
			"control.connect must be a function when reconnect is wanted. Pass reconnect: false to leave the transport down.",
		);
	}

	try {
		await control.disconnect();
		options.evidence?.push("stdout", "realtime transport disconnected");
		if (options.downtimeMs) await Bun.sleep(options.downtimeMs);
	} finally {
		// Reconnect even when the disconnect threw. A transport left down by a
		// failed fault injection breaks every test that runs after it, and that
		// failure points at the wrong place.
		if (reconnect) {
			await control.connect?.();
			options.evidence?.push("stdout", "realtime transport reconnected");
		}
	}

	return { reconnected: reconnect };
}
