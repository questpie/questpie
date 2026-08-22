import type { PostgresTransactionRunner } from "../postgres/contract";
import { appendPostgresDatabaseDurableRunEvent } from "./postgres-database-event";
import {
	durableEffectFence,
	durableEffectSettle,
	durableKernelMarker,
} from "./postgres-statements";
import type { DurableClaim } from "./rows";
import { leaseTokenDigest } from "./rows";

export function createPostgresDatabaseDurableEffectSettle(
	input: Readonly<{
		database: PostgresTransactionRunner;
		application: string;
	}>,
): (
	claim: DurableClaim,
	request: Readonly<{ effectName: string; receipt: string }>,
) => Promise<"applied" | "fenced"> {
	return (claim, request) =>
		input.database.transaction({
			mode: { isolation: "readCommitted", access: "readWrite" },
			use: async (transaction) => {
				await transaction.execute(durableKernelMarker, undefined);
				const held = await transaction.execute(durableEffectFence, {
					application: input.application,
					runId: claim.runId,
					attemptId: claim.attemptId,
					leaseTokenDigest: leaseTokenDigest(claim.leaseToken),
				});
				if (!held) return "fenced" as const;
				const effectId = await transaction.execute(durableEffectSettle, {
					application: input.application,
					runId: claim.runId,
					effectName: request.effectName,
					receipt: request.receipt,
					attemptId: claim.attemptId,
				});
				if (effectId)
					await appendPostgresDatabaseDurableRunEvent(transaction, {
						application: input.application,
						claim,
						kind: "effectSettled",
					});
				return "applied" as const;
			},
		});
}
