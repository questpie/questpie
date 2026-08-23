import type {
	PostgresTransaction,
	PostgresTransactionRunner,
} from "../postgres/contract";
import {
	durableRunEventsRead,
	durableRunInspect,
} from "./postgres-inspection-statements";
import type { DurableKernel } from "./rows";

export function createPostgresDatabaseDurableInspection(
	input: Readonly<{
		database: PostgresTransactionRunner;
		application: string;
	}>,
): Pick<DurableKernel, "events" | "inspect"> {
	const read = <Output>(
		use: (transaction: PostgresTransaction) => Promise<Output>,
	): Promise<Output> =>
		input.database.transaction({
			mode: { isolation: "readCommitted", access: "readOnly" },
			use,
		});
	return Object.freeze({
		inspect: (runId) =>
			read((transaction) =>
				transaction.execute(durableRunInspect, {
					application: input.application,
					runId,
				}),
			),
		events: (runId) =>
			read((transaction) =>
				transaction.execute(durableRunEventsRead, {
					application: input.application,
					runId,
				}),
			),
	});
}
