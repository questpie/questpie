import { canonicalMutationBytes, mutationDigest } from "../mutation/canonical";
import type { LinkedReactionRetry } from "./projection";

export type DurableRow = Readonly<Record<string, unknown>>;

export type DurableQuery = (
	statement: string,
	parameters?: readonly unknown[],
) => Promise<readonly DurableRow[]>;

export type DurablePrincipalKind = "anonymous" | "service" | "user";

export type DurableActor = Readonly<{
	kind: DurablePrincipalKind;
	id: string;
}>;

/**
 * The durable kernel opts every one of its own transactions into the
 * `questpie_internal` guard. Application and worker statements that never call
 * this are rejected by the run, attempt, event, and dispatch triggers.
 */
export const durableKernelMarkerStatement =
	"SELECT set_config('questpie.durable_kernel', 'on', true)";

export async function markDurableKernelTransaction(
	query: DurableQuery,
): Promise<void> {
	await query(durableKernelMarkerStatement);
}

export function durableText(value: unknown, label: string): string {
	if (typeof value !== "string" || value.length === 0)
		throw new TypeError(`${label} must be nonempty text`);
	return value;
}

export function durableBytes(value: unknown, label: string): Uint8Array {
	if (!(value instanceof Uint8Array))
		throw new TypeError(`${label} must be PostgreSQL bytea`);
	return value;
}

export function durableDate(value: unknown, label: string): Date {
	if (!(value instanceof Date)) throw new TypeError(`${label} must be a date`);
	return value;
}

export function durableInteger(value: unknown, label: string): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value))
		throw new TypeError(`${label} must be an integer`);
	return value;
}

export function durablePrincipalKind(
	value: unknown,
	label: string,
): DurablePrincipalKind {
	const text = durableText(value, label);
	if (text !== "anonymous" && text !== "service" && text !== "user")
		throw new TypeError(`${label} is not a Principal kind`);
	return text;
}

export function retryBytes(retry: LinkedReactionRetry): Uint8Array {
	return canonicalMutationBytes({
		backoff: retry.backoff,
		horizonMilliseconds: retry.horizonMilliseconds,
		initialDelayMilliseconds: retry.initialDelayMilliseconds,
		jitter: retry.jitter,
		maximumAttempts: retry.maximumAttempts,
		maximumDelayMilliseconds: retry.maximumDelayMilliseconds,
	});
}

export function decodeRetryBytes(value: unknown): LinkedReactionRetry {
	const decoded = JSON.parse(
		new TextDecoder().decode(durableBytes(value, "retry program")),
	) as Readonly<Record<string, unknown>>;
	return Object.freeze({
		maximumAttempts: durableInteger(
			decoded.maximumAttempts,
			"retry maximumAttempts",
		),
		initialDelayMilliseconds: durableInteger(
			decoded.initialDelayMilliseconds,
			"retry initialDelayMilliseconds",
		),
		backoff: "exponential" as const,
		maximumDelayMilliseconds: durableInteger(
			decoded.maximumDelayMilliseconds,
			"retry maximumDelayMilliseconds",
		),
		jitter: "full" as const,
		horizonMilliseconds: durableInteger(
			decoded.horizonMilliseconds,
			"retry horizonMilliseconds",
		),
	});
}

/** Full jitter over an exponential backoff, bounded by the declared cap. */
export function retryDelayMilliseconds(
	retry: LinkedReactionRetry,
	attemptNumber: number,
	random: () => number,
): number {
	const exponential =
		retry.initialDelayMilliseconds * 2 ** Math.max(0, attemptNumber - 1);
	const capped = Math.min(exponential, retry.maximumDelayMilliseconds);
	return Math.floor(random() * capped);
}

export function leaseTokenDigest(token: string): string {
	return mutationDigest(new TextEncoder().encode(token));
}

export function effectIdentity(
	application: string,
	runId: string,
	effectName: string,
): string {
	const digest = mutationDigest(
		canonicalMutationBytes({ application, effectName, runId }),
	);
	return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}
