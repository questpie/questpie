import { migration } from "questpie/services"
import type { OperationSnapshot } from "questpie/migration"
import { sql } from "drizzle-orm"
import snapshotJson from "./snapshots/20260517T095535_happy_orange_unicorn.json"

const snapshot = snapshotJson as OperationSnapshot

export default migration({
	id: "happyOrangeUnicorn20260517T095535",
	async up({ db }) {
		await db.execute(sql`CREATE INDEX "activity_task_idx" ON "activity" ("task");`)
		await db.execute(sql`CREATE INDEX "activity_run_idx" ON "activity" ("run");`)
		await db.execute(sql`CREATE INDEX "activity_type_idx" ON "activity" ("type");`)
		await db.execute(sql`CREATE INDEX "activity_project_idx" ON "activity" ("project");`)
		await db.execute(sql`CREATE INDEX "capabilities_project_idx" ON "capabilities" ("project");`)
		await db.execute(sql`CREATE INDEX "capabilities_enabled_idx" ON "capabilities" ("enabled");`)
		await db.execute(sql`CREATE INDEX "environments_project_idx" ON "environments" ("project");`)
		await db.execute(sql`CREATE INDEX "join_tokens_expires_at_idx" ON "join_tokens" ("expiresAt");`)
		await db.execute(sql`CREATE INDEX "providers_type_enabled_idx" ON "providers" ("type","enabled");`)
		await db.execute(sql`CREATE INDEX "providers_project_idx" ON "providers" ("project");`)
		await db.execute(sql`CREATE INDEX "schedules_enabled_next_run_idx" ON "schedules" ("enabled","nextRunAt");`)
		await db.execute(sql`CREATE INDEX "schedules_mode_idx" ON "schedules" ("mode");`)
		await db.execute(sql`CREATE INDEX "scripts_project_idx" ON "scripts" ("project");`)
		await db.execute(sql`CREATE INDEX "secrets_scope_idx" ON "secrets" ("scope");`)
		await db.execute(sql`CREATE INDEX "workflow_configs_project_idx" ON "workflow_configs" ("project");`)
		await db.execute(sql`CREATE INDEX "workflow_configs_enabled_idx" ON "workflow_configs" ("enabled");`)
	},
	async down({ db }) {
		await db.execute(sql`DROP INDEX "activity_task_idx";`)
		await db.execute(sql`DROP INDEX "activity_run_idx";`)
		await db.execute(sql`DROP INDEX "activity_type_idx";`)
		await db.execute(sql`DROP INDEX "activity_project_idx";`)
		await db.execute(sql`DROP INDEX "capabilities_project_idx";`)
		await db.execute(sql`DROP INDEX "capabilities_enabled_idx";`)
		await db.execute(sql`DROP INDEX "environments_project_idx";`)
		await db.execute(sql`DROP INDEX "join_tokens_expires_at_idx";`)
		await db.execute(sql`DROP INDEX "providers_type_enabled_idx";`)
		await db.execute(sql`DROP INDEX "providers_project_idx";`)
		await db.execute(sql`DROP INDEX "schedules_enabled_next_run_idx";`)
		await db.execute(sql`DROP INDEX "schedules_mode_idx";`)
		await db.execute(sql`DROP INDEX "scripts_project_idx";`)
		await db.execute(sql`DROP INDEX "secrets_scope_idx";`)
		await db.execute(sql`DROP INDEX "workflow_configs_project_idx";`)
		await db.execute(sql`DROP INDEX "workflow_configs_enabled_idx";`)
	},
	snapshot,
})
