import type { Migration, OperationSnapshot } from "questpie"
import { sql } from "drizzle-orm"
import snapshotJson from "./snapshots/20260211T100836_calm_blue_phoenix.json"

const snapshot = snapshotJson as OperationSnapshot

export const calmBluePhoenix20260211T100836: Migration = {
	id: "calmBluePhoenix20260211T100836",
	async up({ db }) {
		await db.execute(sql`CREATE TABLE "admin_locks" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"resourceType" varchar(50) NOT NULL,
	"resource" varchar(255) NOT NULL,
	"resourceId" varchar(255) NOT NULL,
	"user" varchar(36) NOT NULL,
	"sessionId" varchar(64) NOT NULL,
	"expiresAt" date NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`)
		await db.execute(sql`ALTER TABLE "reviews" ALTER COLUMN "rating" SET DATA TYPE varchar(50) USING "rating"::varchar(50);`)
	},
	async down({ db }) {
		await db.execute(sql`DROP TABLE "admin_locks";`)
		await db.execute(sql`ALTER TABLE "reviews" ALTER COLUMN "rating" SET DATA TYPE integer USING "rating"::integer;`)
	},
	snapshot,
}
