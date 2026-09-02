import type { PostgresTransactionRunner } from "../postgres/contract";
import type { DurableEffectLedger } from "./durable-effect-contract";
import {
	assertDurableAttemptPostgresTransactionRunner,
	type DurableAttemptPostgresTransactionRunner,
} from "./postgres-attempt-observation";
import { createPostgresDatabaseDurableEffectAmbiguous } from "./postgres-database-effect-ambiguous";
import { createPostgresDatabaseDurableEffectRead } from "./postgres-database-effect-read";
import { createPostgresDatabaseDurableEffectReserve } from "./postgres-database-effect-reserve";
import { createPostgresDatabaseDurableEffectSettle } from "./postgres-database-effect-settle";

export function createPostgresDatabaseDurableEffectLedger(
	input: Readonly<{
		database: PostgresTransactionRunner;
		attemptDatabase: DurableAttemptPostgresTransactionRunner;
		application: string;
	}>,
): DurableEffectLedger {
	assertDurableAttemptPostgresTransactionRunner(input.attemptDatabase);
	return Object.freeze({
		reserve: createPostgresDatabaseDurableEffectReserve({
			database: input.attemptDatabase,
			application: input.application,
		}),
		settle: createPostgresDatabaseDurableEffectSettle({
			database: input.attemptDatabase,
			application: input.application,
		}),
		markAmbiguous: createPostgresDatabaseDurableEffectAmbiguous({
			database: input.attemptDatabase,
			application: input.application,
		}),
		read: createPostgresDatabaseDurableEffectRead(input),
	});
}
