import { canonicalMutationBytes, mutationDigest } from "../mutation/canonical";
import type { PostgresTransactionRunner } from "../postgres/contract";
import type { DurableEffectReservation } from "./postgres-effects";
import {
	durableEffectFence,
	durableEffectReservationInsert,
	durableEffectReservationRead,
	durableKernelMarker,
} from "./postgres-statements";
import type { DurableClaim } from "./rows";
import { effectIdentity, leaseTokenDigest } from "./rows";

export function createPostgresDatabaseDurableEffectReserve(
	input: Readonly<{
		database: PostgresTransactionRunner;
		application: string;
	}>,
): (
	claim: DurableClaim,
	request: Readonly<{ effectName: string; input: unknown }>,
) => Promise<DurableEffectReservation> {
	return (claim, request) => {
		const effectId = effectIdentity(
			input.application,
			claim.runId,
			request.effectName,
		);
		const inputDigest = mutationDigest(
			canonicalMutationBytes(request.input ?? null),
		);
		return input.database.transaction({
			mode: { isolation: "readCommitted", access: "readWrite" },
			use: async (transaction) => {
				await transaction.execute(durableKernelMarker, undefined);
				const held = await transaction.execute(durableEffectFence, {
					application: input.application,
					runId: claim.runId,
					attemptId: claim.attemptId,
					leaseTokenDigest: leaseTokenDigest(claim.leaseToken),
				});
				if (!held) return Object.freeze({ status: "fenced" as const });
				await transaction.execute(durableEffectReservationInsert, {
					application: input.application,
					runId: claim.runId,
					effectName: request.effectName,
					effectId,
					inputDigest,
					attemptId: claim.attemptId,
				});
				const row = await transaction.execute(durableEffectReservationRead, {
					application: input.application,
					runId: claim.runId,
					effectName: request.effectName,
				});
				if (row.effectId !== effectId)
					throw new TypeError(
						"durable effect identity does not match its input",
					);
				if (row.inputDigest !== inputDigest)
					return Object.freeze({ status: "conflict" as const, effectId });
				if (row.status === "succeeded")
					return Object.freeze({
						status: "recovered" as const,
						effectId,
						receipt: row.receipt as string,
					});
				return Object.freeze({ status: "reserved" as const, effectId });
			},
		});
	};
}
