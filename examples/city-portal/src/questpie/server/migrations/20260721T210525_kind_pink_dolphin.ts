import { migration } from "questpie/services"
import type { OperationSnapshot } from "questpie/migration"
import { sql } from "drizzle-orm"
import snapshotJson from "./snapshots/20260721T210525_kind_pink_dolphin.json"

const snapshot = snapshotJson as OperationSnapshot

export default migration({
	id: "kindPinkDolphin20260721T210525",
	async up({ db }) {
		await db.execute(sql`CREATE TABLE "jwks" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"publicKey" text NOT NULL,
	"privateKey" text NOT NULL,
	"createdAt" timestamp(3) with time zone NOT NULL,
	"expiresAt" timestamp(3) with time zone
);`)
		await db.execute(sql`CREATE TABLE "oauthAccessToken" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"token" varchar(500),
	"clientId" varchar(255) NOT NULL,
	"sessionId" varchar(255),
	"userId" varchar(255),
	"referenceId" varchar(255),
	"refreshId" varchar(255),
	"expiresAt" timestamp(3) with time zone,
	"createdAt" timestamp(3) with time zone,
	"scopes" jsonb NOT NULL
);`)
		await db.execute(sql`CREATE TABLE "oauthClient" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"clientId" varchar(255) NOT NULL,
	"clientSecret" varchar(500),
	"disabled" boolean DEFAULT false,
	"skipConsent" boolean,
	"enableEndSession" boolean,
	"subjectType" varchar(255),
	"scopes" jsonb,
	"userId" varchar(255),
	"createdAt" timestamp(3) with time zone,
	"updatedAt" timestamp(3) with time zone,
	"name" varchar(255),
	"uri" varchar(500),
	"icon" varchar(500),
	"contacts" jsonb,
	"tos" varchar(500),
	"policy" varchar(500),
	"softwareId" varchar(255),
	"softwareVersion" varchar(255),
	"softwareStatement" text,
	"redirectUris" jsonb NOT NULL,
	"postLogoutRedirectUris" jsonb,
	"tokenEndpointAuthMethod" varchar(255),
	"grantTypes" jsonb,
	"responseTypes" jsonb,
	"public" boolean,
	"type" varchar(255),
	"requirePKCE" boolean,
	"referenceId" varchar(255),
	"metadata" jsonb
);`)
		await db.execute(sql`CREATE TABLE "oauthConsent" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"clientId" varchar(255) NOT NULL,
	"userId" varchar(255),
	"referenceId" varchar(255),
	"scopes" jsonb NOT NULL,
	"createdAt" timestamp(3) with time zone,
	"updatedAt" timestamp(3) with time zone
);`)
		await db.execute(sql`CREATE TABLE "oauthRefreshToken" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"token" varchar(500) NOT NULL,
	"clientId" varchar(255) NOT NULL,
	"sessionId" varchar(255),
	"userId" varchar(255) NOT NULL,
	"referenceId" varchar(255),
	"expiresAt" timestamp(3) with time zone,
	"createdAt" timestamp(3) with time zone,
	"revoked" timestamp(3) with time zone,
	"authTime" timestamp(3) with time zone,
	"scopes" jsonb NOT NULL
);`)
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
	"title" varchar(1000),
	"created_at" timestamp(3) DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) DEFAULT now() NOT NULL
);`)
		await db.execute(sql`CREATE TABLE "questpie_channel_head" (
	"channel_hash" text PRIMARY KEY,
	"channel" text NOT NULL,
	"last_seq" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp(3) DEFAULT now() NOT NULL
);`)
		await db.execute(sql`CREATE TABLE "questpie_channel_event" (
	"channel_hash" text,
	"seq" bigint,
	"event_id" text NOT NULL,
	"channel" text NOT NULL,
	"event" text NOT NULL,
	"schema_identity" text NOT NULL,
	"payload" jsonb NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_at" timestamp(3) DEFAULT now() NOT NULL,
	CONSTRAINT "questpie_channel_event_pkey" PRIMARY KEY("channel_hash","seq")
);`)
		await db.execute(sql`CREATE TABLE "questpie_channel_dispatch" (
	"channel_hash" text PRIMARY KEY,
	"published_seq" bigint DEFAULT 0 NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"updated_at" timestamp(3) DEFAULT now() NOT NULL
);`)
		await db.execute(sql`CREATE TABLE "questpie_channel_presence" (
	"channel_hash" text,
	"connection_id" text,
	"principal_id" text NOT NULL,
	"channel" text NOT NULL,
	"data" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp(3) DEFAULT now() NOT NULL,
	CONSTRAINT "questpie_channel_presence_pkey" PRIMARY KEY("channel_hash","connection_id")
);`)
		await db.execute(sql`CREATE TABLE "questpie_realtime_topology" (
	"session_key" text PRIMARY KEY,
	"owner_id" text NOT NULL,
	"owner_generation" bigserial,
	"protocol_version" integer NOT NULL,
	"token_hash" text NOT NULL,
	"identity_hash" text NOT NULL,
	"lease_expires_at" timestamp with time zone NOT NULL,
	"desired_revision" bigint DEFAULT 0 NOT NULL,
	"applied_revision" bigint DEFAULT 0 NOT NULL,
	"desired_topology" jsonb NOT NULL,
	"created_at" timestamp(3) DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) DEFAULT now() NOT NULL
);`)
		await db.execute(sql`DROP INDEX "idx_realtime_log_seq";`)
		await db.execute(sql`DROP INDEX "idx_realtime_log_resource";`)
		await db.execute(sql`ALTER TABLE "apikey" ADD COLUMN "configId" varchar(255) DEFAULT 'default' NOT NULL;`)
		await db.execute(sql`ALTER TABLE "user" ADD COLUMN "avatar" varchar(36);`)
		await db.execute(sql`ALTER TABLE "site_settings_versions" ADD COLUMN "version_stage" text;`)
		await db.execute(sql`ALTER TABLE "site_settings_versions" ADD COLUMN "version_from_stage" text;`)
		await db.execute(sql`ALTER TABLE "questpie_realtime_log" ADD COLUMN "txid" xid8 DEFAULT pg_current_xact_id();`)
		await db.execute(sql`ALTER TABLE "announcements" DROP COLUMN "attachments";`)
		await db.execute(sql`ALTER TABLE "assets" ALTER COLUMN "key" DROP NOT NULL;`)
		await db.execute(sql`ALTER TABLE "assets" ALTER COLUMN "filename" DROP NOT NULL;`)
		await db.execute(sql`ALTER TABLE "assets" ALTER COLUMN "mime_type" DROP NOT NULL;`)
		await db.execute(sql`ALTER TABLE "assets" ALTER COLUMN "size" DROP NOT NULL;`)
		await db.execute(sql`ALTER TABLE "assets" ALTER COLUMN "created_at" SET DATA TYPE timestamp(3) USING "created_at"::timestamp(3);`)
		await db.execute(sql`ALTER TABLE "assets" ALTER COLUMN "updated_at" SET DATA TYPE timestamp(3) USING "updated_at"::timestamp(3);`)
		await db.execute(sql`ALTER TABLE "user" ALTER COLUMN "created_at" SET DATA TYPE timestamp(3) USING "created_at"::timestamp(3);`)
		await db.execute(sql`ALTER TABLE "user" ALTER COLUMN "updated_at" SET DATA TYPE timestamp(3) USING "updated_at"::timestamp(3);`)
		await db.execute(sql`ALTER TABLE "session" ALTER COLUMN "created_at" SET DATA TYPE timestamp(3) USING "created_at"::timestamp(3);`)
		await db.execute(sql`ALTER TABLE "session" ALTER COLUMN "updated_at" SET DATA TYPE timestamp(3) USING "updated_at"::timestamp(3);`)
		await db.execute(sql`ALTER TABLE "account" ALTER COLUMN "created_at" SET DATA TYPE timestamp(3) USING "created_at"::timestamp(3);`)
		await db.execute(sql`ALTER TABLE "account" ALTER COLUMN "updated_at" SET DATA TYPE timestamp(3) USING "updated_at"::timestamp(3);`)
		await db.execute(sql`ALTER TABLE "verification" ALTER COLUMN "value" SET DATA TYPE text USING "value"::text;`)
		await db.execute(sql`ALTER TABLE "verification" ALTER COLUMN "created_at" SET DATA TYPE timestamp(3) USING "created_at"::timestamp(3);`)
		await db.execute(sql`ALTER TABLE "verification" ALTER COLUMN "updated_at" SET DATA TYPE timestamp(3) USING "updated_at"::timestamp(3);`)
		await db.execute(sql`ALTER TABLE "apikey" ALTER COLUMN "created_at" SET DATA TYPE timestamp(3) USING "created_at"::timestamp(3);`)
		await db.execute(sql`ALTER TABLE "apikey" ALTER COLUMN "updated_at" SET DATA TYPE timestamp(3) USING "updated_at"::timestamp(3);`)
		await db.execute(sql`ALTER TABLE "admin_saved_views" ALTER COLUMN "created_at" SET DATA TYPE timestamp(3) USING "created_at"::timestamp(3);`)
		await db.execute(sql`ALTER TABLE "admin_saved_views" ALTER COLUMN "updated_at" SET DATA TYPE timestamp(3) USING "updated_at"::timestamp(3);`)
		await db.execute(sql`ALTER TABLE "admin_preferences" ALTER COLUMN "created_at" SET DATA TYPE timestamp(3) USING "created_at"::timestamp(3);`)
		await db.execute(sql`ALTER TABLE "admin_preferences" ALTER COLUMN "updated_at" SET DATA TYPE timestamp(3) USING "updated_at"::timestamp(3);`)
		await db.execute(sql`ALTER TABLE "admin_locks" ALTER COLUMN "created_at" SET DATA TYPE timestamp(3) USING "created_at"::timestamp(3);`)
		await db.execute(sql`ALTER TABLE "admin_locks" ALTER COLUMN "updated_at" SET DATA TYPE timestamp(3) USING "updated_at"::timestamp(3);`)
		await db.execute(sql`ALTER TABLE "cities" ALTER COLUMN "created_at" SET DATA TYPE timestamp(3) USING "created_at"::timestamp(3);`)
		await db.execute(sql`ALTER TABLE "cities" ALTER COLUMN "updated_at" SET DATA TYPE timestamp(3) USING "updated_at"::timestamp(3);`)
		await db.execute(sql`ALTER TABLE "cityMembers" ALTER COLUMN "created_at" SET DATA TYPE timestamp(3) USING "created_at"::timestamp(3);`)
		await db.execute(sql`ALTER TABLE "cityMembers" ALTER COLUMN "updated_at" SET DATA TYPE timestamp(3) USING "updated_at"::timestamp(3);`)
		await db.execute(sql`ALTER TABLE "pages" ALTER COLUMN "created_at" SET DATA TYPE timestamp(3) USING "created_at"::timestamp(3);`)
		await db.execute(sql`ALTER TABLE "pages" ALTER COLUMN "updated_at" SET DATA TYPE timestamp(3) USING "updated_at"::timestamp(3);`)
		await db.execute(sql`ALTER TABLE "news" ALTER COLUMN "created_at" SET DATA TYPE timestamp(3) USING "created_at"::timestamp(3);`)
		await db.execute(sql`ALTER TABLE "news" ALTER COLUMN "updated_at" SET DATA TYPE timestamp(3) USING "updated_at"::timestamp(3);`)
		await db.execute(sql`ALTER TABLE "announcements" ALTER COLUMN "created_at" SET DATA TYPE timestamp(3) USING "created_at"::timestamp(3);`)
		await db.execute(sql`ALTER TABLE "announcements" ALTER COLUMN "updated_at" SET DATA TYPE timestamp(3) USING "updated_at"::timestamp(3);`)
		await db.execute(sql`ALTER TABLE "documents" ALTER COLUMN "created_at" SET DATA TYPE timestamp(3) USING "created_at"::timestamp(3);`)
		await db.execute(sql`ALTER TABLE "documents" ALTER COLUMN "updated_at" SET DATA TYPE timestamp(3) USING "updated_at"::timestamp(3);`)
		await db.execute(sql`ALTER TABLE "contacts" ALTER COLUMN "created_at" SET DATA TYPE timestamp(3) USING "created_at"::timestamp(3);`)
		await db.execute(sql`ALTER TABLE "contacts" ALTER COLUMN "updated_at" SET DATA TYPE timestamp(3) USING "updated_at"::timestamp(3);`)
		await db.execute(sql`ALTER TABLE "submissions" ALTER COLUMN "created_at" SET DATA TYPE timestamp(3) USING "created_at"::timestamp(3);`)
		await db.execute(sql`ALTER TABLE "submissions" ALTER COLUMN "updated_at" SET DATA TYPE timestamp(3) USING "updated_at"::timestamp(3);`)
		await db.execute(sql`ALTER TABLE "site_settings" ALTER COLUMN "navigation" SET DEFAULT '[{"label":"Home","href":"/","isExternal":false},{"label":"News","href":"/news","isExternal":false},{"label":"Services","href":"/services","isExternal":false},{"label":"Contact","href":"/contact","isExternal":false}]';`)
		await db.execute(sql`ALTER TABLE "site_settings" ALTER COLUMN "footerLinks" SET DEFAULT '[{"label":"Privacy Policy","href":"/privacy","isExternal":false},{"label":"Accessibility","href":"/accessibility","isExternal":false},{"label":"Contact Us","href":"/contact","isExternal":false}]';`)
		await db.execute(sql`ALTER TABLE "site_settings" ALTER COLUMN "created_at" SET DATA TYPE timestamp(3) USING "created_at"::timestamp(3);`)
		await db.execute(sql`ALTER TABLE "site_settings" ALTER COLUMN "updated_at" SET DATA TYPE timestamp(3) USING "updated_at"::timestamp(3);`)
		await db.execute(sql`ALTER TABLE "site_settings_versions" ALTER COLUMN "version_created_at" SET DATA TYPE timestamp(3) USING "version_created_at"::timestamp(3);`)
		await db.execute(sql`ALTER TABLE "site_settings_versions" ALTER COLUMN "navigation" SET DEFAULT '[{"label":"Home","href":"/","isExternal":false},{"label":"News","href":"/news","isExternal":false},{"label":"Services","href":"/services","isExternal":false},{"label":"Contact","href":"/contact","isExternal":false}]';`)
		await db.execute(sql`ALTER TABLE "site_settings_versions" ALTER COLUMN "footerLinks" SET DEFAULT '[{"label":"Privacy Policy","href":"/privacy","isExternal":false},{"label":"Accessibility","href":"/accessibility","isExternal":false},{"label":"Contact Us","href":"/contact","isExternal":false}]';`)
		await db.execute(sql`ALTER TABLE "site_settings_versions" ALTER COLUMN "created_at" SET DATA TYPE timestamp(3) USING "created_at"::timestamp(3);`)
		await db.execute(sql`ALTER TABLE "site_settings_versions" ALTER COLUMN "updated_at" SET DATA TYPE timestamp(3) USING "updated_at"::timestamp(3);`)
		await db.execute(sql`ALTER TABLE "questpie_realtime_log" ALTER COLUMN "created_at" SET DATA TYPE timestamp(3) USING "created_at"::timestamp(3);`)
		await db.execute(sql`ALTER TABLE "questpie_search" ALTER COLUMN "created_at" SET DATA TYPE timestamp(3) USING "created_at"::timestamp(3);`)
		await db.execute(sql`ALTER TABLE "questpie_search" ALTER COLUMN "updated_at" SET DATA TYPE timestamp(3) USING "updated_at"::timestamp(3);`)
		await db.execute(sql`ALTER TABLE "questpie_search_facets" ALTER COLUMN "created_at" SET DATA TYPE timestamp(3) USING "created_at"::timestamp(3);`)
		await db.execute(sql`CREATE INDEX "audit_log_resource_type_idx" ON "admin_audit_log" ("resource","resourceType");`)
		await db.execute(sql`CREATE INDEX "audit_log_user_id_idx" ON "admin_audit_log" ("userId");`)
		await db.execute(sql`CREATE INDEX "audit_log_created_at_idx" ON "admin_audit_log" ("created_at");`)
		await db.execute(sql`CREATE INDEX "audit_log_resource_id_idx" ON "admin_audit_log" ("resource","resourceId");`)
		await db.execute(sql`CREATE INDEX "site_settings_versions_id_version_stage_version_number_index" ON "site_settings_versions" ("id","version_stage","version_number");`)
		await db.execute(sql`CREATE UNIQUE INDEX "uq_channel_event_event_id" ON "questpie_channel_event" ("event_id");`)
		await db.execute(sql`CREATE INDEX "idx_channel_event_created_at" ON "questpie_channel_event" ("created_at");`)
		await db.execute(sql`CREATE INDEX "idx_channel_presence_channel" ON "questpie_channel_presence" ("channel_hash");`)
		await db.execute(sql`CREATE INDEX "idx_channel_presence_expiry" ON "questpie_channel_presence" ("expires_at");`)
		await db.execute(sql`CREATE INDEX "idx_realtime_topology_owner_lease" ON "questpie_realtime_topology" ("owner_id","lease_expires_at");`)
		await db.execute(sql`CREATE INDEX "idx_realtime_topology_lease" ON "questpie_realtime_topology" ("lease_expires_at");`)
	},
	async down({ db }) {
		await db.execute(sql`DROP TABLE "jwks";`)
		await db.execute(sql`DROP TABLE "oauthAccessToken";`)
		await db.execute(sql`DROP TABLE "oauthClient";`)
		await db.execute(sql`DROP TABLE "oauthConsent";`)
		await db.execute(sql`DROP TABLE "oauthRefreshToken";`)
		await db.execute(sql`DROP TABLE "admin_audit_log";`)
		await db.execute(sql`DROP TABLE "questpie_channel_head";`)
		await db.execute(sql`DROP TABLE "questpie_channel_event";`)
		await db.execute(sql`DROP TABLE "questpie_channel_dispatch";`)
		await db.execute(sql`DROP TABLE "questpie_channel_presence";`)
		await db.execute(sql`DROP TABLE "questpie_realtime_topology";`)
		await db.execute(sql`DROP INDEX "site_settings_versions_id_version_stage_version_number_index";`)
		await db.execute(sql`ALTER TABLE "announcements" ADD COLUMN "attachments" varchar(36);`)
		await db.execute(sql`ALTER TABLE "apikey" DROP COLUMN "configId";`)
		await db.execute(sql`ALTER TABLE "user" DROP COLUMN "avatar";`)
		await db.execute(sql`ALTER TABLE "site_settings_versions" DROP COLUMN "version_stage";`)
		await db.execute(sql`ALTER TABLE "site_settings_versions" DROP COLUMN "version_from_stage";`)
		await db.execute(sql`ALTER TABLE "questpie_realtime_log" DROP COLUMN "txid";`)
		await db.execute(sql`ALTER TABLE "account" ALTER COLUMN "created_at" SET DATA TYPE timestamp USING "created_at"::timestamp;`)
		await db.execute(sql`ALTER TABLE "account" ALTER COLUMN "updated_at" SET DATA TYPE timestamp USING "updated_at"::timestamp;`)
		await db.execute(sql`ALTER TABLE "apikey" ALTER COLUMN "created_at" SET DATA TYPE timestamp USING "created_at"::timestamp;`)
		await db.execute(sql`ALTER TABLE "apikey" ALTER COLUMN "updated_at" SET DATA TYPE timestamp USING "updated_at"::timestamp;`)
		await db.execute(sql`ALTER TABLE "assets" ALTER COLUMN "key" SET NOT NULL;`)
		await db.execute(sql`ALTER TABLE "assets" ALTER COLUMN "filename" SET NOT NULL;`)
		await db.execute(sql`ALTER TABLE "assets" ALTER COLUMN "mime_type" SET NOT NULL;`)
		await db.execute(sql`ALTER TABLE "assets" ALTER COLUMN "size" SET NOT NULL;`)
		await db.execute(sql`ALTER TABLE "assets" ALTER COLUMN "created_at" SET DATA TYPE timestamp USING "created_at"::timestamp;`)
		await db.execute(sql`ALTER TABLE "assets" ALTER COLUMN "updated_at" SET DATA TYPE timestamp USING "updated_at"::timestamp;`)
		await db.execute(sql`ALTER TABLE "session" ALTER COLUMN "created_at" SET DATA TYPE timestamp USING "created_at"::timestamp;`)
		await db.execute(sql`ALTER TABLE "session" ALTER COLUMN "updated_at" SET DATA TYPE timestamp USING "updated_at"::timestamp;`)
		await db.execute(sql`ALTER TABLE "user" ALTER COLUMN "created_at" SET DATA TYPE timestamp USING "created_at"::timestamp;`)
		await db.execute(sql`ALTER TABLE "user" ALTER COLUMN "updated_at" SET DATA TYPE timestamp USING "updated_at"::timestamp;`)
		await db.execute(sql`ALTER TABLE "verification" ALTER COLUMN "value" SET DATA TYPE varchar(255) USING "value"::varchar(255);`)
		await db.execute(sql`ALTER TABLE "verification" ALTER COLUMN "created_at" SET DATA TYPE timestamp USING "created_at"::timestamp;`)
		await db.execute(sql`ALTER TABLE "verification" ALTER COLUMN "updated_at" SET DATA TYPE timestamp USING "updated_at"::timestamp;`)
		await db.execute(sql`ALTER TABLE "admin_locks" ALTER COLUMN "created_at" SET DATA TYPE timestamp USING "created_at"::timestamp;`)
		await db.execute(sql`ALTER TABLE "admin_locks" ALTER COLUMN "updated_at" SET DATA TYPE timestamp USING "updated_at"::timestamp;`)
		await db.execute(sql`ALTER TABLE "admin_preferences" ALTER COLUMN "created_at" SET DATA TYPE timestamp USING "created_at"::timestamp;`)
		await db.execute(sql`ALTER TABLE "admin_preferences" ALTER COLUMN "updated_at" SET DATA TYPE timestamp USING "updated_at"::timestamp;`)
		await db.execute(sql`ALTER TABLE "admin_saved_views" ALTER COLUMN "created_at" SET DATA TYPE timestamp USING "created_at"::timestamp;`)
		await db.execute(sql`ALTER TABLE "admin_saved_views" ALTER COLUMN "updated_at" SET DATA TYPE timestamp USING "updated_at"::timestamp;`)
		await db.execute(sql`ALTER TABLE "announcements" ALTER COLUMN "created_at" SET DATA TYPE timestamp USING "created_at"::timestamp;`)
		await db.execute(sql`ALTER TABLE "announcements" ALTER COLUMN "updated_at" SET DATA TYPE timestamp USING "updated_at"::timestamp;`)
		await db.execute(sql`ALTER TABLE "cities" ALTER COLUMN "created_at" SET DATA TYPE timestamp USING "created_at"::timestamp;`)
		await db.execute(sql`ALTER TABLE "cities" ALTER COLUMN "updated_at" SET DATA TYPE timestamp USING "updated_at"::timestamp;`)
		await db.execute(sql`ALTER TABLE "cityMembers" ALTER COLUMN "created_at" SET DATA TYPE timestamp USING "created_at"::timestamp;`)
		await db.execute(sql`ALTER TABLE "cityMembers" ALTER COLUMN "updated_at" SET DATA TYPE timestamp USING "updated_at"::timestamp;`)
		await db.execute(sql`ALTER TABLE "contacts" ALTER COLUMN "created_at" SET DATA TYPE timestamp USING "created_at"::timestamp;`)
		await db.execute(sql`ALTER TABLE "contacts" ALTER COLUMN "updated_at" SET DATA TYPE timestamp USING "updated_at"::timestamp;`)
		await db.execute(sql`ALTER TABLE "documents" ALTER COLUMN "created_at" SET DATA TYPE timestamp USING "created_at"::timestamp;`)
		await db.execute(sql`ALTER TABLE "documents" ALTER COLUMN "updated_at" SET DATA TYPE timestamp USING "updated_at"::timestamp;`)
		await db.execute(sql`ALTER TABLE "news" ALTER COLUMN "created_at" SET DATA TYPE timestamp USING "created_at"::timestamp;`)
		await db.execute(sql`ALTER TABLE "news" ALTER COLUMN "updated_at" SET DATA TYPE timestamp USING "updated_at"::timestamp;`)
		await db.execute(sql`ALTER TABLE "pages" ALTER COLUMN "created_at" SET DATA TYPE timestamp USING "created_at"::timestamp;`)
		await db.execute(sql`ALTER TABLE "pages" ALTER COLUMN "updated_at" SET DATA TYPE timestamp USING "updated_at"::timestamp;`)
		await db.execute(sql`ALTER TABLE "submissions" ALTER COLUMN "created_at" SET DATA TYPE timestamp USING "created_at"::timestamp;`)
		await db.execute(sql`ALTER TABLE "submissions" ALTER COLUMN "updated_at" SET DATA TYPE timestamp USING "updated_at"::timestamp;`)
		await db.execute(sql`ALTER TABLE "site_settings" ALTER COLUMN "navigation" SET DEFAULT '[{"label":"Home","href":"/"},{"label":"News","href":"/news"},{"label":"Services","href":"/services"},{"label":"Contact","href":"/contact"}]';`)
		await db.execute(sql`ALTER TABLE "site_settings" ALTER COLUMN "footerLinks" SET DEFAULT '[{"label":"Privacy Policy","href":"/privacy"},{"label":"Accessibility","href":"/accessibility"},{"label":"Contact Us","href":"/contact"}]';`)
		await db.execute(sql`ALTER TABLE "site_settings" ALTER COLUMN "created_at" SET DATA TYPE timestamp USING "created_at"::timestamp;`)
		await db.execute(sql`ALTER TABLE "site_settings" ALTER COLUMN "updated_at" SET DATA TYPE timestamp USING "updated_at"::timestamp;`)
		await db.execute(sql`ALTER TABLE "site_settings_versions" ALTER COLUMN "version_created_at" SET DATA TYPE timestamp USING "version_created_at"::timestamp;`)
		await db.execute(sql`ALTER TABLE "site_settings_versions" ALTER COLUMN "navigation" SET DEFAULT '[{"label":"Home","href":"/"},{"label":"News","href":"/news"},{"label":"Services","href":"/services"},{"label":"Contact","href":"/contact"}]';`)
		await db.execute(sql`ALTER TABLE "site_settings_versions" ALTER COLUMN "footerLinks" SET DEFAULT '[{"label":"Privacy Policy","href":"/privacy"},{"label":"Accessibility","href":"/accessibility"},{"label":"Contact Us","href":"/contact"}]';`)
		await db.execute(sql`ALTER TABLE "site_settings_versions" ALTER COLUMN "created_at" SET DATA TYPE timestamp USING "created_at"::timestamp;`)
		await db.execute(sql`ALTER TABLE "site_settings_versions" ALTER COLUMN "updated_at" SET DATA TYPE timestamp USING "updated_at"::timestamp;`)
		await db.execute(sql`ALTER TABLE "questpie_realtime_log" ALTER COLUMN "created_at" SET DATA TYPE timestamp USING "created_at"::timestamp;`)
		await db.execute(sql`ALTER TABLE "questpie_search" ALTER COLUMN "created_at" SET DATA TYPE timestamp USING "created_at"::timestamp;`)
		await db.execute(sql`ALTER TABLE "questpie_search" ALTER COLUMN "updated_at" SET DATA TYPE timestamp USING "updated_at"::timestamp;`)
		await db.execute(sql`ALTER TABLE "questpie_search_facets" ALTER COLUMN "created_at" SET DATA TYPE timestamp USING "created_at"::timestamp;`)
		await db.execute(sql`CREATE INDEX "idx_realtime_log_seq" ON "questpie_realtime_log" ("seq");`)
		await db.execute(sql`CREATE INDEX "idx_realtime_log_resource" ON "questpie_realtime_log" ("resource_type","resource");`)
	},
	snapshot,
})
