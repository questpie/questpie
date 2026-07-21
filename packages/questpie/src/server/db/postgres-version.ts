import { sql } from "drizzle-orm";

import { getEnv } from "../utils/env.js";
import { rowsOf } from "./driver-result.js";

const POSTGRES_13_VERSION_NUM = 130_000;
export const QUESTPIE_SCHEMA_INTROSPECTION_ENV =
	"QUESTPIE_SCHEMA_INTROSPECTION";

type VersionDb = {
	execute(query: unknown): Promise<unknown>;
};

/** Fail before migrations/startup when xid8 transaction ids are unavailable. */
export async function assertPostgres13ForRealtimeTxid(
	db: VersionDb,
): Promise<void> {
	if (getEnv(QUESTPIE_SCHEMA_INTROSPECTION_ENV) === "1") return;

	const result = await db.execute(
		sql`SELECT current_setting('server_version_num')::integer AS "serverVersionNum"`,
	);
	const row = rowsOf<{ serverVersionNum?: string | number }>(result)[0];
	const version = Number(row?.serverVersionNum);

	if (!Number.isInteger(version) || version < POSTGRES_13_VERSION_NUM) {
		const detected = Number.isInteger(version) ? String(version) : "unknown";
		throw new Error(
			`QUESTPIE realtime txid requires PostgreSQL 13 or newer (server_version_num >= ${POSTGRES_13_VERSION_NUM}); detected ${detected}`,
		);
	}
}
