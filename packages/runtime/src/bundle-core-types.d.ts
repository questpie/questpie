export {
	definePostgresStatement,
	type PostgresParameter,
	type PostgresStatement,
	type PostgresTransaction,
	type PostgresTransactionRunner,
} from "./postgres/contract-types.js";

import type { PostgresTransaction } from "./postgres/contract-types.js";

export type ReadinessMigration = Readonly<{
	identity: string;
	sequence: number;
	parent: string | null;
	checksum: string;
}>;

export declare function verifyPostgresDatabaseReadinessPrerequisitesInOwnedTransaction(
	input: Readonly<{
		transaction: PostgresTransaction;
		protocol: Readonly<{ version: 6; checksum: string }>;
		application: string;
		postgresSchema: string;
		migrationHead: string | null;
		committedMigrations: readonly ReadinessMigration[];
	}>,
): Promise<void>;
