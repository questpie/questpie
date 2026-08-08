import { sql } from "drizzle-orm";

import type { Migration } from "./types.js";

/**
 * Framework-owned compatibility migrations run after application migrations.
 *
 * They intentionally have no snapshots: application schema generation already
 * includes framework tables, while these migrations repair databases created
 * by an older migration or by development-only schema push.
 */
export const frameworkMigrations: readonly Migration[] = [
	{
		id: "questpieRealtimeSettledAt20260808T000000",
		async up({ db }) {
			await db.execute(sql`
				DO $$
				BEGIN
					IF to_regclass('questpie_realtime_log') IS NOT NULL THEN
						ALTER TABLE "questpie_realtime_log"
						ADD COLUMN IF NOT EXISTS "settled_at" timestamp(3);
						CREATE INDEX IF NOT EXISTS "idx_realtime_log_settled_at"
						ON "questpie_realtime_log" ("settled_at");
					END IF;
				END $$
			`);
		},
		async down() {
			// Compatibility migrations are deliberately forward-only. The column may
			// have been created by an application migration or schema push, so removing
			// it during rollback would destroy schema owned by another migration path.
		},
	},
];
