import type {
	PostgresRealtimeGeneration,
	PostgresRealtimeWatch,
} from "./postgres-realtime-scope-contract";

function text(value: unknown, label: string): string {
	if (typeof value !== "string" || value.length === 0)
		throw new TypeError(`${label} is invalid`);
	return value;
}

function integer(value: unknown, label: string): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0)
		throw new TypeError(`${label} is invalid`);
	return value;
}

function bigint(value: unknown, label: string, allowZero = false): bigint {
	const pattern = allowZero ? /^(?:0|[1-9][0-9]*)$/u : /^[1-9][0-9]*$/u;
	if (typeof value !== "string" || !pattern.test(value))
		throw new TypeError(`${label} is invalid`);
	return BigInt(value);
}

function bytes(value: unknown, label: string): Uint8Array {
	if (!(value instanceof Uint8Array))
		throw new TypeError(`${label} is invalid`);
	return new Uint8Array(value);
}

export function decodePostgresRealtimeWatch(
	row: readonly unknown[],
): PostgresRealtimeWatch {
	if (row.length !== 20) throw new TypeError("realtime watch row is invalid");
	const generation = row[13];
	const delivery = row[17];
	const resetReason = row[18];
	if (
		typeof row[8] !== "boolean" ||
		(row[9] !== null && typeof row[9] !== "string")
	)
		throw new TypeError("realtime watch resume state is invalid");
	if (generation === null) {
		if (row.slice(14).some((value) => value !== null))
			throw new TypeError("realtime watch generation is incomplete");
	} else if (
		typeof row[14] !== "string" ||
		!(row[15] instanceof Uint8Array) ||
		!(row[16] instanceof Uint8Array) ||
		(delivery !== "initial" && delivery !== "reset" && delivery !== "update") ||
		(resetReason !== null &&
			resetReason !== "authority-changed" &&
			resetReason !== "deployment-changed" &&
			resetReason !== "resume-unavailable") ||
		(delivery === "reset" ? resetReason === null : resetReason !== null) ||
		(row[19] !== null && typeof row[19] !== "boolean")
	)
		throw new TypeError("realtime watch generation is invalid");
	return Object.freeze({
		bindingIdentity: text(row[0], "binding identity"),
		authorityPartitionDigest: text(row[1], "authority partition digest"),
		queryIdentity: text(row[2], "Query identity"),
		queryBytes: bytes(row[3], "Query bytes"),
		inputBytes: bytes(row[4], "input bytes"),
		inputDigest: text(row[5], "input digest"),
		contextInputBytes: bytes(row[6], "Context input bytes"),
		wireVersion: integer(row[7], "wire version"),
		resumeRequested: row[8],
		requestedResumeToken: row[9],
		activeSlot: integer(row[10], "active slot"),
		invalidationGeneration: bigint(row[11], "invalidation generation"),
		evaluatedInvalidationGeneration: bigint(
			row[12],
			"evaluated invalidation generation",
			true,
		),
		latest:
			generation === null
				? null
				: Object.freeze({
						generation: bigint(generation, "generation"),
						tokenDigest: row[14] as string,
						resultBytes: bytes(row[15], "result bytes"),
						dependencyPlanBytes: bytes(row[16], "dependency plan bytes"),
						delivery: delivery as PostgresRealtimeGeneration["delivery"],
						resetReason:
							resetReason as PostgresRealtimeGeneration["resetReason"],
						acknowledged: row[19] === true,
					}),
	});
}
