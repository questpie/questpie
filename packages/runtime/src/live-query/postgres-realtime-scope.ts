import type { PostgresTransactionRunner } from "../postgres";
import { createPostgresRealtimeGenerationDatabaseStore } from "./postgres-realtime-generations-database";
import { createPostgresRealtimeScopeDatabaseStore } from "./postgres-realtime-scope-database";
import type { PostgresRealtimeScopeStore } from "./postgres-realtime-scope-store";

export type {
	PostgresRealtimeScopeLease,
	PostgresRealtimeWatch,
} from "./postgres-realtime-scope-contract";
export type { PostgresRealtimeScopeStore } from "./postgres-realtime-scope-store";

export function createPostgresRealtimeScopeStore(
	input: Readonly<{ database: PostgresTransactionRunner }>,
): PostgresRealtimeScopeStore {
	return createPostgresRealtimeScopeDatabaseStore({
		database: input.database,
		generations: createPostgresRealtimeGenerationDatabaseStore(input.database),
	});
}
