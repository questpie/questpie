import { createHash } from "node:crypto";

import type { ChangeWake } from "../realtime/transport.js";

const MAX_SAFE_COUNTER = BigInt(Number.MAX_SAFE_INTEGER);

/** Broker metadata is a lossy hint. Durable bigint cursors are never derived from it. */
export function createCrdtChangeWake(input: {
	namespace: string;
	resourceId: string;
	resourceEpochId: string;
	aggregateEpoch: bigint;
	head: bigint;
	fenceGeneration: bigint;
	reason: "publish" | "reconnect" | "reconcile";
}): Extract<ChangeWake, { kind: "crdt" }> {
	return Object.freeze({
		kind: "crdt",
		aggregateHash: createHash("sha256")
			.update("questpie-crdt-aggregate-wake-v1\0")
			.update(input.namespace)
			.update("\0")
			.update(input.resourceId)
			.update("\0")
			.update(input.resourceEpochId)
			.digest("hex"),
		aggregateEpoch: saturatingHint(input.aggregateEpoch),
		head: saturatingHint(input.head),
		fenceGeneration: saturatingHint(input.fenceGeneration),
		reason: input.reason,
	});
}

function saturatingHint(value: bigint): number {
	if (value < 0n) throw new TypeError("CRDT wake counter must be nonnegative");
	return Number(value > MAX_SAFE_COUNTER ? MAX_SAFE_COUNTER : value);
}
