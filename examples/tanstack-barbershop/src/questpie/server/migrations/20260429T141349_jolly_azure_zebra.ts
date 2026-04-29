import { sql } from "drizzle-orm";
import { migration } from "questpie";
import type { OperationSnapshot } from "questpie";

import snapshotJson from "./snapshots/20260429T141349_jolly_azure_zebra.json";

const snapshot = snapshotJson as OperationSnapshot;

export default migration({
	id: "jollyAzureZebra20260429T141349",
	async up({ db }) {
		await db.execute(sql`CREATE TABLE "pages_versions" (
	"version_id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"id" text NOT NULL,
	"version_number" integer NOT NULL,
	"version_operation" text NOT NULL,
	"version_stage" text,
	"version_from_stage" text,
	"version_user_id" text,
	"version_created_at" timestamp DEFAULT now() NOT NULL,
	"slug" varchar(255) NOT NULL,
	"isPublished" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`);
		await db.execute(sql`CREATE TABLE "pages_i18n_versions" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"parent_id" text NOT NULL,
	"version_number" integer NOT NULL,
	"locale" text NOT NULL,
	"_localized" jsonb,
	"title" varchar(255) NOT NULL,
	"description" text,
	"content" jsonb,
	"metaTitle" varchar(255),
	"metaDescription" text
);`);
		await db.execute(
			sql`ALTER TABLE "user" ALTER COLUMN "image" SET DATA TYPE varchar(500) USING "image"::varchar(500);`,
		);
		await db.execute(
			sql`ALTER TABLE "site_settings_i18n" ALTER COLUMN "navigation" SET DEFAULT '[{"label":"Home","href":"/"},{"label":"Services","href":"/services"},{"label":"Our Team","href":"/barbers"},{"label":"Contact","href":"/contact"}]';`,
		);
		await db.execute(
			sql`ALTER TABLE "site_settings_i18n_versions" ALTER COLUMN "navigation" SET DEFAULT '[{"label":"Home","href":"/"},{"label":"Services","href":"/services"},{"label":"Our Team","href":"/barbers"},{"label":"Contact","href":"/contact"}]';`,
		);
		await db.execute(
			sql`CREATE INDEX "pages_versions_id_version_number_index" ON "pages_versions" ("id","version_number");`,
		);
		await db.execute(
			sql`CREATE INDEX "pages_versions_id_version_stage_version_number_index" ON "pages_versions" ("id","version_stage","version_number");`,
		);
		await db.execute(
			sql`CREATE INDEX "pages_versions_version_created_at_index" ON "pages_versions" ("version_created_at");`,
		);
		await db.execute(
			sql`CREATE UNIQUE INDEX "pages_i18n_versions_parent_id_version_number_locale_index" ON "pages_i18n_versions" ("parent_id","version_number","locale");`,
		);
		await db.execute(
			sql`CREATE INDEX "pages_i18n_versions_parent_id_version_number_index" ON "pages_i18n_versions" ("parent_id","version_number");`,
		);
	},
	async down({ db }) {
		await db.execute(sql`DROP TABLE "pages_versions";`);
		await db.execute(sql`DROP TABLE "pages_i18n_versions";`);
		await db.execute(
			sql`ALTER TABLE "user" ALTER COLUMN "image" SET DATA TYPE varchar(2048) USING "image"::varchar(2048);`,
		);
		await db.execute(
			sql`ALTER TABLE "site_settings_i18n" ALTER COLUMN "navigation" SET DEFAULT '[{"label":"Home","href":"/"},{"label":"Services","href":"/services"},{"label":"Our Team","href":"/barbers"},{"label":"Blog","href":"/blog"},{"label":"Contact","href":"/contact"}]';`,
		);
		await db.execute(
			sql`ALTER TABLE "site_settings_i18n_versions" ALTER COLUMN "navigation" SET DEFAULT '[{"label":"Home","href":"/"},{"label":"Services","href":"/services"},{"label":"Our Team","href":"/barbers"},{"label":"Blog","href":"/blog"},{"label":"Contact","href":"/contact"}]';`,
		);
	},
	snapshot,
});
