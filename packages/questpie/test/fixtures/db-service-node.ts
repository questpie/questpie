import assert from "node:assert/strict";

import { sql } from "drizzle-orm";
import pg from "pg";

import dbService from "../../src/server/modules/core/services/db.js";

for (const driver of [undefined, "node-postgres"] as const) {
	const app = {
		config: {
			db: {
				url: process.env.QUESTPIE_TRANSACTION_LOCK_DATABASE_URL!,
				driver,
				pool: { max: 1 },
			},
		},
		getSchema: () => ({}),
		_dbCleanup: undefined as undefined | (() => Promise<void>),
	};
	try {
		const db = await dbService.state.create!({ app });
		assert(db.$client instanceof pg.Pool);
		await db.execute(sql`SELECT 1`);
	} finally {
		await app._dbCleanup?.();
	}
}
