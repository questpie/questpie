import type { DurableClaim } from "./rows";

export type DurableEffectStatus =
	| "acknowledged"
	| "ambiguous"
	| "pending"
	| "succeeded";

export type DurableEffectReservation =
	| Readonly<{ status: "reserved"; effectId: string }>
	| Readonly<{ status: "recovered"; effectId: string; receipt: string }>
	| Readonly<{ status: "conflict"; effectId: string }>
	| Readonly<{ status: "fenced" }>;

export type DurableEffectView = Readonly<{
	effectName: string;
	effectId: string;
	status: DurableEffectStatus;
	receipt: string | null;
}>;

/**
 * A lost provider response has no safe automatic answer. QUESTPIE keeps one
 * stable effect identity for one logical effect across every attempt so a
 * provider idempotency receipt can recover it, and records `ambiguous`
 * otherwise. It does not claim exactly-once effects.
 */
export interface DurableEffectLedger {
	reserve(
		claim: DurableClaim,
		input: Readonly<{ effectName: string; input: unknown }>,
	): Promise<DurableEffectReservation>;
	settle(
		claim: DurableClaim,
		input: Readonly<{ effectName: string; receipt: string }>,
	): Promise<"applied" | "fenced">;
	markAmbiguous(
		claim: DurableClaim,
		input: Readonly<{ effectName: string }>,
	): Promise<"applied" | "fenced">;
	read(runId: string): Promise<readonly DurableEffectView[]>;
}
