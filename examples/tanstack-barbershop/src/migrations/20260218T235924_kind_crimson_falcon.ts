import { sql } from "drizzle-orm";
import type { Migration, OperationSnapshot } from "questpie";
import snapshotJson from "./snapshots/20260218T235924_kind_crimson_falcon.json";

const snapshot = snapshotJson as OperationSnapshot;

export const kindCrimsonFalcon20260218T235924: Migration = {
	id: "kindCrimsonFalcon20260218T235924",
	async up({ db }) {
		await db.execute(
			sql`ALTER TABLE "admin_audit_log" ADD COLUMN "title" varchar(1000);`,
		);
	},
	async down({ db }) {
		await db.execute(sql`ALTER TABLE "admin_audit_log" DROP COLUMN "title";`);
	},
	snapshot,
};
