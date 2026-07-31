import { sql } from "drizzle-orm";
import type { OperationSnapshot } from "questpie/migration";
import { migration } from "questpie/services";

import snapshotJson from "./snapshots/20260730T182023_optimistic-concurrency-revisions.json";

const snapshot = snapshotJson as OperationSnapshot;

export default migration({
	id: "optimisticConcurrencyRevisions20260730T182023",
	async up({ db }) {
		await db.execute(
			sql`ALTER TABLE "pages_versions" ADD COLUMN "source_revision" integer;`,
		);
		await db.execute(
			sql`ALTER TABLE "site_settings_versions" ADD COLUMN "source_revision" integer;`,
		);
	},
	async down({ db }) {
		await db.execute(
			sql`ALTER TABLE "pages_versions" DROP COLUMN "source_revision";`,
		);
		await db.execute(
			sql`ALTER TABLE "site_settings_versions" DROP COLUMN "source_revision";`,
		);
	},
	snapshot,
});
