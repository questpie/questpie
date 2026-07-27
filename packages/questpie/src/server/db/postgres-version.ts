import { sql } from "drizzle-orm";

import { getEnv } from "../utils/env.js";
import { rowsOf } from "./driver-result.js";

const POSTGRES_13_VERSION_NUM = 130_000;
const POSTGRES_15_VERSION_NUM = 150_000;
export const QUESTPIE_SCHEMA_INTROSPECTION_ENV =
	"QUESTPIE_SCHEMA_INTROSPECTION";

type VersionDb = {
	execute(query: unknown): Promise<unknown>;
};

async function readPostgresVersion(db: VersionDb): Promise<number> {
	const result = await db.execute(
		sql`SELECT current_setting('server_version_num')::integer AS "serverVersionNum"`,
	);
	const row = rowsOf<{ serverVersionNum?: string | number }>(result)[0];
	return Number(row?.serverVersionNum);
}

/** Fail during database service startup when the framework baseline is unmet. */
export async function assertSupportedPostgresVersion(
	db: VersionDb,
): Promise<void> {
	if (getEnv(QUESTPIE_SCHEMA_INTROSPECTION_ENV) === "1") return;

	const version = await readPostgresVersion(db);
	if (!Number.isInteger(version) || version < POSTGRES_15_VERSION_NUM) {
		const detected = Number.isInteger(version) ? String(version) : "unknown";
		throw new Error(
			`QUESTPIE requires PostgreSQL 15 or newer (server_version_num >= ${POSTGRES_15_VERSION_NUM}); detected ${detected}`,
		);
	}
}

/** Fail before migrations/startup when xid8 transaction ids are unavailable. */
export async function assertPostgres13ForRealtimeTxid(
	db: VersionDb,
): Promise<void> {
	if (getEnv(QUESTPIE_SCHEMA_INTROSPECTION_ENV) === "1") return;

	const version = await readPostgresVersion(db);

	if (!Number.isInteger(version) || version < POSTGRES_13_VERSION_NUM) {
		const detected = Number.isInteger(version) ? String(version) : "unknown";
		throw new Error(
			`QUESTPIE realtime txid requires PostgreSQL 13 or newer (server_version_num >= ${POSTGRES_13_VERSION_NUM}); detected ${detected}`,
		);
	}
}
