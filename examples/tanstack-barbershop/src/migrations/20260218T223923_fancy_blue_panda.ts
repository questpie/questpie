import type { Migration, OperationSnapshot } from "questpie"
import { sql } from "drizzle-orm"
import snapshotJson from "./snapshots/20260218T223923_fancy_blue_panda.json"

const snapshot = snapshotJson as OperationSnapshot

export const fancyBluePanda20260218T223923: Migration = {
	id: "fancyBluePanda20260218T223923",
	async up({ db }) {
		await db.execute(sql`CREATE TABLE "admin_audit_log" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"action" varchar(50) NOT NULL,
	"resourceType" varchar(50) NOT NULL,
	"resource" varchar(255) NOT NULL,
	"resourceId" varchar(255),
	"resourceLabel" varchar(500),
	"userId" varchar(255),
	"userName" varchar(255),
	"locale" varchar(10),
	"changes" jsonb,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`)
		await db.execute(sql`CREATE INDEX "audit_log_resource_type_idx" ON "admin_audit_log" ("resource","resourceType");`)
		await db.execute(sql`CREATE INDEX "audit_log_user_id_idx" ON "admin_audit_log" ("userId");`)
		await db.execute(sql`CREATE INDEX "audit_log_created_at_idx" ON "admin_audit_log" ("created_at");`)
		await db.execute(sql`CREATE INDEX "audit_log_resource_id_idx" ON "admin_audit_log" ("resource","resourceId");`)
	},
	async down({ db }) {
		await db.execute(sql`DROP TABLE "admin_audit_log";`)
	},
	snapshot,
}
