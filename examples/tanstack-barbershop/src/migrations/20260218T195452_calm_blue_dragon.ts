import { sql } from "drizzle-orm";
import type { Migration, OperationSnapshot } from "questpie";
import snapshotJson from "./snapshots/20260218T195452_calm_blue_dragon.json";

const snapshot = snapshotJson as OperationSnapshot;

export const calmBlueDragon20260218T195452: Migration = {
	id: "calmBlueDragon20260218T195452",
	async up({ db }) {
		await db.execute(
			sql`ALTER TABLE "site_settings_versions" ADD COLUMN "version_stage" text;`,
		);
		await db.execute(
			sql`ALTER TABLE "site_settings_versions" ADD COLUMN "version_from_stage" text;`,
		);
		await db.execute(
			sql`CREATE INDEX "site_settings_versions_id_version_stage_version_number_index" ON "site_settings_versions" ("id","version_stage","version_number");`,
		);
	},
	async down({ db }) {
		await db.execute(
			sql`DROP INDEX "site_settings_versions_id_version_stage_version_number_index";`,
		);
		await db.execute(
			sql`ALTER TABLE "site_settings_versions" DROP COLUMN "version_stage";`,
		);
		await db.execute(
			sql`ALTER TABLE "site_settings_versions" DROP COLUMN "version_from_stage";`,
		);
	},
	snapshot,
};
