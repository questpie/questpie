import type { SQL } from "bun";

import type { DurableEffectLedger } from "./durable-effect-contract";
import { createBunDurablePostgresTransactionRunner } from "./postgres-bun-compatibility";
import { createPostgresDatabaseDurableEffectLedger } from "./postgres-database-effect-ledger";

export type {
	DurableEffectLedger,
	DurableEffectReservation,
	DurableEffectStatus,
	DurableEffectView,
} from "./durable-effect-contract";

export function createPostgresDurableEffectLedger(
	input: Readonly<{ sql: SQL; application: string }>,
): DurableEffectLedger {
	return createPostgresDatabaseDurableEffectLedger({
		database: createBunDurablePostgresTransactionRunner(input.sql),
		application: input.application,
	});
}
