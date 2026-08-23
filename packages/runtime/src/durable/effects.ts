import type { DurableEffectLedger } from "./durable-effect-contract";
import type { DurableClaim } from "./rows";

export class DurableEffectAmbiguous extends Error {
	readonly effectName: string;
	readonly effectId: string;
	constructor(effectName: string, effectId: string, cause?: unknown) {
		super(`durable effect ${effectName} is ambiguous`, { cause });
		this.name = "DurableEffectAmbiguous";
		this.effectName = effectName;
		this.effectId = effectId;
	}
}

export class DurableEffectConflict extends Error {
	readonly effectName: string;
	readonly effectId: string;
	constructor(effectName: string, effectId: string) {
		super(`durable effect ${effectName} was reused with different input`);
		this.name = "DurableEffectConflict";
		this.effectName = effectName;
		this.effectId = effectId;
	}
}

export class DurableLeaseLost extends Error {
	constructor() {
		super("durable attempt lost its lease");
		this.name = "DurableLeaseLost";
	}
}

export type DurableEffectScope = Readonly<{
	effectId: string;
	attempt: number;
	signal: AbortSignal;
}>;

export type DurableEffectInvocation<Receipt extends string> = Readonly<{
	input: unknown;
	perform: (scope: DurableEffectScope) => Promise<Receipt>;
	recover?: (scope: DurableEffectScope) => Promise<Receipt | null>;
}>;

export interface DurableEffectHandle {
	invoke<Receipt extends string>(
		invocation: DurableEffectInvocation<Receipt>,
	): Promise<Receipt>;
}

export interface DurableRunHandle {
	readonly id: string;
	readonly dispatchId: string;
	effect(name: string): DurableEffectHandle;
}

/**
 * Builds the handler-visible effect surface for one physical attempt. The
 * effect identity is stable across attempts, so a provider idempotency receipt
 * recovers a lost response; without one the effect becomes `ambiguous`.
 */
export function createDurableRunHandle(
	input: Readonly<{
		ledger: DurableEffectLedger;
		claim: DurableClaim;
		declaredEffects: readonly string[];
		signal: AbortSignal;
	}>,
): DurableRunHandle {
	const used = new Set<string>();
	return Object.freeze<DurableRunHandle>({
		id: input.claim.runId,
		dispatchId: input.claim.dispatchId,
		effect(name) {
			if (!input.declaredEffects.includes(name))
				throw new TypeError(`Reaction effect ${name} is not declared`);
			return Object.freeze({
				async invoke<Receipt extends string>(
					invocation: DurableEffectInvocation<Receipt>,
				): Promise<Receipt> {
					if (used.has(name))
						throw new TypeError(
							`Reaction effect ${name} was invoked twice in one attempt`,
						);
					used.add(name);
					const reservation = await input.ledger.reserve(input.claim, {
						effectName: name,
						input: invocation.input,
					});
					if (reservation.status === "fenced") throw new DurableLeaseLost();
					if (reservation.status === "conflict")
						throw new DurableEffectConflict(name, reservation.effectId);
					if (reservation.status === "recovered")
						return reservation.receipt as Receipt;
					const scope = Object.freeze({
						effectId: reservation.effectId,
						attempt: input.claim.attemptNumber,
						signal: input.signal,
					});
					let receipt: Receipt;
					try {
						receipt = await invocation.perform(scope);
					} catch (failure) {
						// A thrown provider call is an unknown outcome. Only a reliable
						// lookup contract can resolve it: a receipt recovers the effect,
						// and an explicit `null` proves the provider never accepted it.
						// Absent or failing lookup leaves the effect ambiguous.
						const lookup = invocation.recover;
						if (!lookup) {
							await input.ledger.markAmbiguous(input.claim, {
								effectName: name,
							});
							throw new DurableEffectAmbiguous(
								name,
								reservation.effectId,
								failure,
							);
						}
						let recovered: Receipt | null;
						try {
							recovered = await lookup(scope);
						} catch (lookupFailure) {
							await input.ledger.markAmbiguous(input.claim, {
								effectName: name,
							});
							throw new DurableEffectAmbiguous(
								name,
								reservation.effectId,
								lookupFailure,
							);
						}
						if (recovered === null) throw failure;
						receipt = recovered;
					}
					if (
						(await input.ledger.settle(input.claim, {
							effectName: name,
							receipt,
						})) === "fenced"
					)
						throw new DurableLeaseLost();
					return receipt;
				},
			});
		},
	});
}
