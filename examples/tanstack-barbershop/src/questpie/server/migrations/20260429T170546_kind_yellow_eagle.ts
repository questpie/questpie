import { sql } from "drizzle-orm";
import { migration } from "questpie";
import type { OperationSnapshot } from "questpie";

import snapshotJson from "./snapshots/20260429T170546_kind_yellow_eagle.json";

const snapshot = snapshotJson as OperationSnapshot;

export default migration({
	id: "kindYellowEagle20260429T170546",
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
		await db.execute(sql`INSERT INTO "pages_versions" (
	"id",
	"version_number",
	"version_operation",
	"version_stage",
	"slug",
	"created_at",
	"updated_at"
)
SELECT
	"pages"."id",
	1,
	'create',
	CASE WHEN "pages"."isPublished" THEN 'published' ELSE 'draft' END,
	"pages"."slug",
	"pages"."created_at",
	"pages"."updated_at"
FROM "pages";`);
		await db.execute(sql`INSERT INTO "pages_i18n_versions" (
	"parent_id",
	"version_number",
	"locale",
	"_localized",
	"title",
	"description",
	"content",
	"metaTitle",
	"metaDescription"
)
SELECT
	"pages_i18n"."parent_id",
	1,
	"pages_i18n"."locale",
	"pages_i18n"."_localized",
	"pages_i18n"."title",
	"pages_i18n"."description",
	"pages_i18n"."content",
	"pages_i18n"."metaTitle",
	"pages_i18n"."metaDescription"
FROM "pages_i18n";`);
		await db.execute(sql`ALTER TABLE "pages" DROP COLUMN "isPublished";`);
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
		await db.execute(
			sql`ALTER TABLE "pages" ADD COLUMN "isPublished" boolean DEFAULT false NOT NULL;`,
		);
		await db.execute(sql`UPDATE "pages"
SET "isPublished" = EXISTS (
	SELECT 1
	FROM "pages_versions"
	WHERE "pages_versions"."id" = "pages"."id"
		AND "pages_versions"."version_stage" = 'published'
);`);
		await db.execute(sql`DROP TABLE "pages_versions";`);
		await db.execute(sql`DROP TABLE "pages_i18n_versions";`);
	},
	snapshot,
});
