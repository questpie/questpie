import type { PostgresTransactionRunner } from "../postgres/contract";
import type { DurableEffectLedger } from "./durable-effect-contract";
import { createPostgresDatabaseDurableEffectAmbiguous } from "./postgres-database-effect-ambiguous";
import { createPostgresDatabaseDurableEffectRead } from "./postgres-database-effect-read";
import { createPostgresDatabaseDurableEffectReserve } from "./postgres-database-effect-reserve";
import { createPostgresDatabaseDurableEffectSettle } from "./postgres-database-effect-settle";

export function createPostgresDatabaseDurableEffectLedger(
	input: Readonly<{
		database: PostgresTransactionRunner;
		application: string;
	}>,
): DurableEffectLedger {
	return Object.freeze({
		reserve: createPostgresDatabaseDurableEffectReserve(input),
		settle: createPostgresDatabaseDurableEffectSettle(input),
		markAmbiguous: createPostgresDatabaseDurableEffectAmbiguous(input),
		read: createPostgresDatabaseDurableEffectRead(input),
	});
}
