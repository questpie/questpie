import type { PostgresTransactionRunner } from "../postgres/contract";
import { appendPostgresDatabaseDurableRunEvent } from "./postgres-database-event";
import {
	durableEffectAmbiguous,
	durableEffectFence,
	durableKernelMarker,
} from "./postgres-statements";
import type { DurableClaim } from "./rows";
import { leaseTokenDigest } from "./rows";

export function createPostgresDatabaseDurableEffectAmbiguous(
	input: Readonly<{
		database: PostgresTransactionRunner;
		application: string;
	}>,
): (
	claim: DurableClaim,
	request: Readonly<{ effectName: string }>,
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
				const effectId = await transaction.execute(durableEffectAmbiguous, {
					application: input.application,
					runId: claim.runId,
					effectName: request.effectName,
				});
				if (effectId)
					await appendPostgresDatabaseDurableRunEvent(transaction, {
						application: input.application,
						claim,
						kind: "effectAmbiguous",
					});
				return "applied" as const;
			},
		});
}
