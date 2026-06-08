import { sql } from "drizzle-orm";
import { migration } from "questpie/services";

/**
 * Autopilot MEMORIES (WS-8 / memory slice 1) — schema + the pgvector embedding store.
 *
 * Design: `.private/miniapps-v2-design.md` §9. This migration is HAND-WRITTEN (like
 * `add_run_links_and_ai_module`) rather than drizzle-generated because it mixes two
 * things drizzle's schema diff does not own:
 *   1. The `agent_memory` + `memory_settings` collection tables (drizzle COULD emit
 *      these, but the app's snapshot has drifted far from the live schema, so the
 *      interactive generator is not viable here — they are written explicitly).
 *   2. The pgvector bits (extension + the `embedding` column on `questpie_search` +
 *      the ivfflat index) — these are the documented `search_007/008/009` steps. The
 *      `embedding` column is INTENTIONALLY not in the shared Drizzle search schema
 *      (adding a `vector` column there would force the plain-Postgres adapter to
 *      create it without the extension), so it can only be added here.
 *
 * pgvector RESILIENCE: the extension + column + index are guarded so this migration
 * still applies on a Postgres WITHOUT pgvector installed (the memory tables are
 * created regardless; only the semantic-search column is skipped — recall then
 * degrades to "off", exactly as `injectMemoriesIntoInstructions` handles). On such a
 * DB `CREATE EXTENSION "vector"` would fail, so the embedding block is wrapped in a
 * DO/EXCEPTION that logs-and-continues.
 */
export default migration({
	id: "autopilotMemories20260606T004300",
	async up({ db }) {
		// ── agent_memory ──────────────────────────────────────────────────────
		await db.execute(sql`CREATE TABLE IF NOT EXISTS "agent_memory" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"type" varchar(50) DEFAULT 'episodic' NOT NULL,
	"scopeType" varchar(50) DEFAULT 'company' NOT NULL,
	"scopeRef" varchar(255),
	"content" text NOT NULL,
	"importance" integer DEFAULT 5 NOT NULL,
	"confidence" integer,
	"status" varchar(50) DEFAULT 'active' NOT NULL,
	"supersedes" varchar(36),
	"sourceRun" varchar(36),
	"source" varchar(50) DEFAULT 'reflection' NOT NULL,
	"contentHash" varchar(255),
	"lastAccessedAt" timestamp(3) with time zone,
	"accessCount" integer DEFAULT 0,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`);
		await db.execute(
			sql`CREATE INDEX IF NOT EXISTS "agent_memory_status_idx" ON "agent_memory" ("status");`,
		);
		await db.execute(
			sql`CREATE INDEX IF NOT EXISTS "agent_memory_scope_idx" ON "agent_memory" ("scopeType","scopeRef");`,
		);
		await db.execute(
			sql`CREATE INDEX IF NOT EXISTS "agent_memory_type_idx" ON "agent_memory" ("type");`,
		);
		await db.execute(
			sql`CREATE INDEX IF NOT EXISTS "agent_memory_content_hash_idx" ON "agent_memory" ("contentHash");`,
		);
		await db.execute(
			sql`CREATE INDEX IF NOT EXISTS "agent_memory_source_run_idx" ON "agent_memory" ("sourceRun");`,
		);
		await db.execute(
			sql`CREATE INDEX IF NOT EXISTS "agent_memory_supersedes_idx" ON "agent_memory" ("supersedes");`,
		);

		// ── memory_settings ───────────────────────────────────────────────────
		await db.execute(sql`CREATE TABLE IF NOT EXISTS "memory_settings" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"scopeType" varchar(50) DEFAULT 'company' NOT NULL,
	"scopeRef" varchar(255),
	"agentMayWrite" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`);
		await db.execute(
			sql`CREATE UNIQUE INDEX IF NOT EXISTS "memory_settings_scope_idx" ON "memory_settings" ("scopeType","scopeRef");`,
		);
		await db.execute(
			sql`CREATE INDEX IF NOT EXISTS "memory_settings_scope_type_idx" ON "memory_settings" ("scopeType");`,
		);

		// ── pgvector: extension + embedding column + ivfflat index ─────────────
		// (search_007/008/009). Guarded so a Postgres WITHOUT pgvector still applies
		// the rest of this migration cleanly — semantic recall is simply unavailable
		// there (the injection layer degrades to "off"). The embedding column has
		// 1536 dims = OpenAI text-embedding-3-small (the configured provider default).
		await db.execute(sql`
DO $$
BEGIN
	BEGIN
		CREATE EXTENSION IF NOT EXISTS "vector";
	EXCEPTION WHEN OTHERS THEN
		RAISE NOTICE 'pgvector extension unavailable; skipping embedding column (semantic recall disabled): %', SQLERRM;
		RETURN;
	END;
	ALTER TABLE "questpie_search" ADD COLUMN IF NOT EXISTS "embedding" vector(1536);
	CREATE INDEX IF NOT EXISTS "idx_search_embedding" ON "questpie_search" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);
END
$$;`);
	},
	async down({ db }) {
		await db.execute(sql`DROP INDEX IF EXISTS "idx_search_embedding";`);
		await db.execute(
			sql`ALTER TABLE "questpie_search" DROP COLUMN IF EXISTS "embedding";`,
		);
		await db.execute(sql`DROP TABLE IF EXISTS "memory_settings";`);
		await db.execute(sql`DROP TABLE IF EXISTS "agent_memory";`);
	},
});
