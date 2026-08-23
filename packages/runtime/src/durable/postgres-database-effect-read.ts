import type { PostgresTransactionRunner } from "../postgres/contract";
import type { DurableEffectView } from "./durable-effect-contract";
import { durableEffectRead } from "./postgres-statements";

export function createPostgresDatabaseDurableEffectRead(
	input: Readonly<{
		database: PostgresTransactionRunner;
		application: string;
	}>,
): (runId: string) => Promise<readonly DurableEffectView[]> {
	return (runId) =>
		input.database.transaction({
			mode: { isolation: "readCommitted", access: "readOnly" },
			use: (transaction) =>
				transaction.execute(durableEffectRead, {
					application: input.application,
					runId,
				}),
		});
}
