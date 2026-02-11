import type { Migration, OperationSnapshot } from "questpie"
import { sql } from "drizzle-orm"
import snapshotJson from "./snapshots/20260211T164057_bright_yellow_tiger.json"

const snapshot = snapshotJson as OperationSnapshot

export const brightYellowTiger20260211T164057: Migration = {
	id: "brightYellowTiger20260211T164057",
	async up({ db }) {
		await db.execute(sql`CREATE TABLE "assets" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"width" integer,
	"height" integer,
	"alt" varchar(500),
	"caption" text,
	"key" varchar(255) NOT NULL,
	"filename" varchar(255) NOT NULL,
	"mime_type" varchar(100) NOT NULL,
	"size" integer NOT NULL,
	"visibility" varchar(20) DEFAULT 'public' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`)
		await db.execute(sql`CREATE TABLE "user" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" varchar(255) NOT NULL,
	"email" varchar(255) NOT NULL,
	"emailVerified" boolean NOT NULL,
	"image" varchar(500),
	"role" varchar(50),
	"banned" boolean DEFAULT false,
	"banReason" varchar(255),
	"banExpires" timestamp(3) with time zone,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`)
		await db.execute(sql`CREATE TABLE "session" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"userId" varchar(255) NOT NULL,
	"token" varchar(255) NOT NULL,
	"expiresAt" timestamp(3) with time zone NOT NULL,
	"ipAddress" varchar(45),
	"userAgent" varchar(500),
	"impersonatedBy" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`)
		await db.execute(sql`CREATE TABLE "account" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"userId" varchar(255) NOT NULL,
	"accountId" varchar(255) NOT NULL,
	"providerId" varchar(255) NOT NULL,
	"accessToken" varchar(500),
	"refreshToken" varchar(500),
	"accessTokenExpiresAt" timestamp(3) with time zone,
	"refreshTokenExpiresAt" timestamp(3) with time zone,
	"scope" varchar(255),
	"idToken" varchar(500),
	"password" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`)
		await db.execute(sql`CREATE TABLE "verification" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"identifier" varchar(255) NOT NULL,
	"value" varchar(255) NOT NULL,
	"expiresAt" timestamp(3) with time zone NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`)
		await db.execute(sql`CREATE TABLE "apikey" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" varchar(255),
	"start" varchar(255),
	"prefix" varchar(255),
	"key" varchar(500) NOT NULL,
	"userId" varchar(255) NOT NULL,
	"refillInterval" integer,
	"refillAmount" integer,
	"lastRefillAt" timestamp(3) with time zone,
	"enabled" boolean DEFAULT true,
	"rateLimitEnabled" boolean DEFAULT true,
	"rateLimitTimeWindow" integer,
	"rateLimitMax" integer,
	"requestCount" integer DEFAULT 0,
	"remaining" integer,
	"lastRequest" timestamp(3) with time zone,
	"expiresAt" timestamp(3) with time zone,
	"permissions" text,
	"metadata" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`)
		await db.execute(sql`CREATE TABLE "admin_saved_views" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"userId" varchar(255) NOT NULL,
	"collectionName" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"configuration" jsonb NOT NULL,
	"isDefault" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`)
		await db.execute(sql`CREATE TABLE "admin_preferences" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"userId" varchar(255) NOT NULL,
	"key" varchar(255) NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`)
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
		await db.execute(sql`CREATE TABLE "cities" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" varchar(255) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"logo" varchar(36),
	"email" varchar(255),
	"phone" varchar(50),
	"address" text,
	"website" varchar(255),
	"population" integer,
	"isActive" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`)
		await db.execute(sql`CREATE TABLE "cityMembers" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"user" varchar(36) NOT NULL,
	"city" varchar(36) NOT NULL,
	"role" varchar(50) DEFAULT 'editor' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`)
		await db.execute(sql`CREATE TABLE "pages" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"city" varchar(36) NOT NULL,
	"title" varchar(255) NOT NULL,
	"slug" varchar(255) NOT NULL,
	"content" jsonb,
	"excerpt" text,
	"parent" varchar(36),
	"order" integer DEFAULT 0,
	"showInNav" boolean DEFAULT true,
	"featuredImage" varchar(36),
	"isPublished" boolean DEFAULT false,
	"metaTitle" varchar(70),
	"metaDescription" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`)
		await db.execute(sql`CREATE TABLE "news" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"city" varchar(36) NOT NULL,
	"title" varchar(255) NOT NULL,
	"slug" varchar(255) NOT NULL,
	"excerpt" text,
	"content" jsonb,
	"image" varchar(36),
	"category" varchar(50) DEFAULT 'general',
	"publishedAt" timestamp(3) with time zone,
	"author" varchar(255),
	"isPublished" boolean DEFAULT false,
	"isFeatured" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`)
		await db.execute(sql`CREATE TABLE "announcements" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"city" varchar(36) NOT NULL,
	"title" varchar(255) NOT NULL,
	"content" jsonb,
	"category" varchar(50) DEFAULT 'notice' NOT NULL,
	"validFrom" date NOT NULL,
	"validTo" date NOT NULL,
	"isPinned" boolean DEFAULT false,
	"attachments" varchar(36),
	"referenceNumber" varchar(100),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`)
		await db.execute(sql`CREATE TABLE "documents" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"city" varchar(36) NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text,
	"category" varchar(50) DEFAULT 'other' NOT NULL,
	"file" varchar(36) NOT NULL,
	"publishedDate" date,
	"version" varchar(50),
	"isPublished" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`)
		await db.execute(sql`CREATE TABLE "contacts" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"city" varchar(36) NOT NULL,
	"department" varchar(255) NOT NULL,
	"description" text,
	"contactPerson" varchar(255),
	"position" varchar(255),
	"email" varchar(255),
	"phone" varchar(50),
	"address" text,
	"officeHours" varchar(255),
	"order" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`)
		await db.execute(sql`CREATE TABLE "submissions" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"city" varchar(36) NOT NULL,
	"name" varchar(255) NOT NULL,
	"email" varchar(255) NOT NULL,
	"phone" varchar(50),
	"subject" varchar(255) NOT NULL,
	"message" text NOT NULL,
	"department" varchar(50) DEFAULT 'general',
	"status" varchar(50) DEFAULT 'new' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`)
		await db.execute(sql`CREATE TABLE "site_settings" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"scope_id" text,
	"siteName" varchar(255) DEFAULT 'City Council' NOT NULL,
	"tagline" varchar(255) DEFAULT 'Working for our community',
	"logo" varchar(36),
	"favicon" varchar(36),
	"primaryColour" varchar(255) DEFAULT '#1e40af',
	"secondaryColour" varchar(255) DEFAULT '#64748b',
	"navigation" jsonb DEFAULT '[{"label":"Home","href":"/"},{"label":"News","href":"/news"},{"label":"Services","href":"/services"},{"label":"Contact","href":"/contact"}]',
	"footerText" text DEFAULT 'Your local council, working for you.',
	"footerLinks" jsonb DEFAULT '[{"label":"Privacy Policy","href":"/privacy"},{"label":"Accessibility","href":"/accessibility"},{"label":"Contact Us","href":"/contact"}]',
	"copyrightText" varchar(255) DEFAULT 'City Council. All rights reserved.',
	"socialLinks" jsonb DEFAULT '[]',
	"contactEmail" varchar(255) DEFAULT 'enquiries@council.gov.uk',
	"contactPhone" varchar(255) DEFAULT '+44 20 7123 4567',
	"address" text DEFAULT 'Council House
City Centre
Postcode',
	"emergencyPhone" varchar(255),
	"openingHours" text DEFAULT 'Monday - Friday: 9:00 - 17:00
Saturday - Sunday: Closed',
	"metaTitle" varchar(255) DEFAULT 'City Council - Official Website',
	"metaDescription" text DEFAULT 'Official website of the City Council. Find information about local services, news, and how to contact us.',
	"ogImage" varchar(36),
	"googleAnalyticsId" varchar(255),
	"alertEnabled" boolean DEFAULT false,
	"alertMessage" text,
	"alertType" varchar(50) DEFAULT 'info',
	"alertLink" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`)
		await db.execute(sql`CREATE TABLE "site_settings_versions" (
	"version_id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"id" text NOT NULL,
	"version_number" integer NOT NULL,
	"version_operation" text NOT NULL,
	"version_user_id" text,
	"version_created_at" timestamp DEFAULT now() NOT NULL,
	"scope_id" text,
	"siteName" varchar(255) DEFAULT 'City Council' NOT NULL,
	"tagline" varchar(255) DEFAULT 'Working for our community',
	"logo" varchar(36),
	"favicon" varchar(36),
	"primaryColour" varchar(255) DEFAULT '#1e40af',
	"secondaryColour" varchar(255) DEFAULT '#64748b',
	"navigation" jsonb DEFAULT '[{"label":"Home","href":"/"},{"label":"News","href":"/news"},{"label":"Services","href":"/services"},{"label":"Contact","href":"/contact"}]',
	"footerText" text DEFAULT 'Your local council, working for you.',
	"footerLinks" jsonb DEFAULT '[{"label":"Privacy Policy","href":"/privacy"},{"label":"Accessibility","href":"/accessibility"},{"label":"Contact Us","href":"/contact"}]',
	"copyrightText" varchar(255) DEFAULT 'City Council. All rights reserved.',
	"socialLinks" jsonb DEFAULT '[]',
	"contactEmail" varchar(255) DEFAULT 'enquiries@council.gov.uk',
	"contactPhone" varchar(255) DEFAULT '+44 20 7123 4567',
	"address" text DEFAULT 'Council House
City Centre
Postcode',
	"emergencyPhone" varchar(255),
	"openingHours" text DEFAULT 'Monday - Friday: 9:00 - 17:00
Saturday - Sunday: Closed',
	"metaTitle" varchar(255) DEFAULT 'City Council - Official Website',
	"metaDescription" text DEFAULT 'Official website of the City Council. Find information about local services, news, and how to contact us.',
	"ogImage" varchar(36),
	"googleAnalyticsId" varchar(255),
	"alertEnabled" boolean DEFAULT false,
	"alertMessage" text,
	"alertType" varchar(50) DEFAULT 'info',
	"alertLink" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`)
		await db.execute(sql`CREATE TABLE "questpie_realtime_log" (
	"seq" bigserial PRIMARY KEY,
	"resource_type" text NOT NULL,
	"resource" text NOT NULL,
	"operation" text NOT NULL,
	"record_id" text,
	"locale" text,
	"payload" jsonb DEFAULT '{}',
	"created_at" timestamp DEFAULT now() NOT NULL
);`)
		await db.execute(sql`CREATE TABLE "questpie_search" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"collection_name" text NOT NULL,
	"record_id" text NOT NULL,
	"locale" text NOT NULL,
	"title" text NOT NULL,
	"content" text,
	"metadata" jsonb DEFAULT '{}',
	"fts_vector" tsvector GENERATED ALWAYS AS (setweight(to_tsvector('simple', coalesce(title, '')), 'A') || setweight(to_tsvector('simple', coalesce(content, '')), 'B')) STORED NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_search_entry" UNIQUE("collection_name","record_id","locale")
);`)
		await db.execute(sql`CREATE TABLE "questpie_search_facets" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"search_id" text NOT NULL,
	"collection_name" text NOT NULL,
	"locale" text NOT NULL,
	"facet_name" text NOT NULL,
	"facet_value" text NOT NULL,
	"numeric_value" numeric,
	"created_at" timestamp DEFAULT now() NOT NULL
);`)
		await db.execute(sql`CREATE UNIQUE INDEX "admin_preferences_user_key_idx" ON "admin_preferences" ("userId","key");`)
		await db.execute(sql`CREATE UNIQUE INDEX "cities_slug_unique" ON "cities" ("slug");`)
		await db.execute(sql`CREATE UNIQUE INDEX "city_members_unique" ON "cityMembers" ("user","city");`)
		await db.execute(sql`CREATE UNIQUE INDEX "pages_city_slug_unique" ON "pages" ("city","slug");`)
		await db.execute(sql`CREATE UNIQUE INDEX "news_city_slug_unique" ON "news" ("city","slug");`)
		await db.execute(sql`CREATE UNIQUE INDEX "site_settings_scope_idx" ON "site_settings" ("scope_id");`)
		await db.execute(sql`CREATE INDEX "site_settings_versions_id_version_number_index" ON "site_settings_versions" ("id","version_number");`)
		await db.execute(sql`CREATE INDEX "site_settings_versions_version_created_at_index" ON "site_settings_versions" ("version_created_at");`)
		await db.execute(sql`CREATE INDEX "idx_realtime_log_seq" ON "questpie_realtime_log" ("seq");`)
		await db.execute(sql`CREATE INDEX "idx_realtime_log_resource" ON "questpie_realtime_log" ("resource_type","resource");`)
		await db.execute(sql`CREATE INDEX "idx_realtime_log_created_at" ON "questpie_realtime_log" ("created_at");`)
		await db.execute(sql`CREATE INDEX "idx_search_fts" ON "questpie_search" USING gin ("fts_vector");`)
		await db.execute(sql`CREATE INDEX "idx_search_trigram" ON "questpie_search" USING gin ("title" gin_trgm_ops);`)
		await db.execute(sql`CREATE INDEX "idx_search_collection_locale" ON "questpie_search" ("collection_name","locale");`)
		await db.execute(sql`CREATE INDEX "idx_search_record_id" ON "questpie_search" ("record_id");`)
		await db.execute(sql`CREATE INDEX "idx_facets_agg" ON "questpie_search_facets" ("collection_name","locale","facet_name","facet_value");`)
		await db.execute(sql`CREATE INDEX "idx_facets_search_id" ON "questpie_search_facets" ("search_id");`)
		await db.execute(sql`CREATE INDEX "idx_facets_collection" ON "questpie_search_facets" ("collection_name");`)
	},
	async down({ db }) {
		await db.execute(sql`DROP TABLE "assets";`)
		await db.execute(sql`DROP TABLE "user";`)
		await db.execute(sql`DROP TABLE "session";`)
		await db.execute(sql`DROP TABLE "account";`)
		await db.execute(sql`DROP TABLE "verification";`)
		await db.execute(sql`DROP TABLE "apikey";`)
		await db.execute(sql`DROP TABLE "admin_saved_views";`)
		await db.execute(sql`DROP TABLE "admin_preferences";`)
		await db.execute(sql`DROP TABLE "admin_locks";`)
		await db.execute(sql`DROP TABLE "cities";`)
		await db.execute(sql`DROP TABLE "cityMembers";`)
		await db.execute(sql`DROP TABLE "pages";`)
		await db.execute(sql`DROP TABLE "news";`)
		await db.execute(sql`DROP TABLE "announcements";`)
		await db.execute(sql`DROP TABLE "documents";`)
		await db.execute(sql`DROP TABLE "contacts";`)
		await db.execute(sql`DROP TABLE "submissions";`)
		await db.execute(sql`DROP TABLE "site_settings";`)
		await db.execute(sql`DROP TABLE "site_settings_versions";`)
		await db.execute(sql`DROP TABLE "questpie_realtime_log";`)
		await db.execute(sql`DROP TABLE "questpie_search";`)
		await db.execute(sql`DROP TABLE "questpie_search_facets";`)
	},
	snapshot,
}
