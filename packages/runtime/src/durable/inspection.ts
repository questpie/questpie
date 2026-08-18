import { mutationDigest } from "../mutation/canonical";
import type { DurableEffectView } from "./postgres-effects";
import type { DurableRunState, DurableRunView } from "./postgres-kernel";

/**
 * The inspection projection is strictly narrower than the kernel read.
 *
 * The kernel keeps `resultBytes` because the worker needs the encoded result,
 * and the ledger keeps the provider receipt because a later attempt recovers a
 * lost response from it. Neither is this surface's to disclose: an output codec
 * is a shape contract, not an authorization filter, so whatever a handler
 * returns would otherwise reach every caller that can read a run, bypassing the
 * Collection output Field Policy governing the same data through its Query.
 *
 * Result becomes presence, length, and digest; receipt becomes presence.
 * Presence rather than truncation, because a truncated payload is still a
 * payload path. A result that should be visible is exposed as data through a
 * Policy-protected Query, which is what ADR-0014 already requires.
 */
export type DurableRunInspection = Readonly<{
	runId: string;
	version: number;
	dispatchId: string;
	resource: string;
	state: DurableRunState;
	attemptCount: number;
	currentAttemptId: string | null;
	cancellationRequested: boolean;
	deadLetter: boolean;
	failureCode: string | null;
	result: Readonly<{ present: boolean; bytes: number; digest: string | null }>;
	availableAt: Date;
	terminalAt: Date | null;
}>;

export type DurableEffectInspection = Readonly<{
	effectName: string;
	effectId: string;
	status: DurableEffectView["status"];
	receiptPresent: boolean;
}>;

export function projectDurableRunInspection(
	view: DurableRunView,
): DurableRunInspection {
	const bytes = view.resultBytes;
	return Object.freeze({
		runId: view.runId,
		version: view.version,
		dispatchId: view.dispatchId,
		resource: view.resource,
		state: view.state,
		attemptCount: view.attemptCount,
		currentAttemptId: view.currentAttemptId,
		cancellationRequested: view.cancellationRequested,
		deadLetter: view.deadLetter,
		failureCode: view.failureCode,
		result: Object.freeze({
			present: bytes !== null,
			bytes: bytes === null ? 0 : bytes.byteLength,
			digest: bytes === null ? null : mutationDigest(bytes),
		}),
		availableAt: view.availableAt,
		terminalAt: view.terminalAt,
	});
}

export function projectDurableEffectInspection(
	view: DurableEffectView,
): DurableEffectInspection {
	return Object.freeze({
		effectName: view.effectName,
		effectId: view.effectId,
		status: view.status,
		receiptPresent: view.receipt !== null,
	});
}
