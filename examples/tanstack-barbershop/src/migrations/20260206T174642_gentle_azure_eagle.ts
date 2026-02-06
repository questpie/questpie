import type { Migration, OperationSnapshot } from "questpie";
import { sql } from "drizzle-orm";
import snapshotJson from "./snapshots/20260206T174642_gentle_azure_eagle.json";

const snapshot = snapshotJson as OperationSnapshot;

export const gentleAzureEagle20260206T174642: Migration = {
  id: "gentleAzureEagle20260206T174642",
  async up({ db }) {
    // for now this must be done manually as part of the migration since we need the pg_trgm extension for some of the indexes, and not all users may have it installed already
    await db.execute(sql`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);
    await db.execute(sql`CREATE EXTENSION IF NOT EXISTS "pg_trgm";`);

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
);`);
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
);`);
    await db.execute(sql`CREATE TABLE "session" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"userId" varchar(255) NOT NULL,
	"token" varchar(255) NOT NULL,
	"expiresAt" timestamp(3) with time zone NOT NULL,
	"ipAddress" varchar(45),
	"userAgent" varchar(500),
	"impersonatedBy" varchar(255)
);`);
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
	"password" varchar(255)
);`);
    await db.execute(sql`CREATE TABLE "verification" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"identifier" varchar(255) NOT NULL,
	"value" varchar(255) NOT NULL,
	"expiresAt" timestamp(3) with time zone NOT NULL
);`);
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
);`);
    await db.execute(sql`CREATE TABLE "admin_saved_views" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"userId" varchar(255) NOT NULL,
	"collectionName" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"configuration" jsonb NOT NULL,
	"isDefault" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`);
    await db.execute(sql`CREATE TABLE "admin_preferences" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"userId" varchar(255) NOT NULL,
	"key" varchar(255) NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`);
    await db.execute(sql`CREATE TABLE "barbers" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" varchar(255) NOT NULL,
	"slug" varchar(255) NOT NULL,
	"email" varchar(255) NOT NULL,
	"phone" varchar(50),
	"avatar" varchar(36),
	"isActive" boolean DEFAULT true NOT NULL,
	"workingHours" jsonb,
	"socialLinks" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`);
    await db.execute(sql`CREATE TABLE "barbers_i18n" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"parent_id" text NOT NULL,
	"locale" text NOT NULL,
	"_localized" jsonb,
	"bio" jsonb,
	"specialties" jsonb
);`);
    await db.execute(sql`CREATE TABLE "services" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"image" varchar(36),
	"duration" integer NOT NULL,
	"price" integer NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`);
    await db.execute(sql`CREATE TABLE "services_i18n" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"parent_id" text NOT NULL,
	"locale" text NOT NULL,
	"_localized" jsonb,
	"name" varchar(255) NOT NULL,
	"description" text
);`);
    await db.execute(sql`CREATE TABLE "barber_services" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"barber" varchar(36) NOT NULL,
	"service" varchar(36) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`);
    await db.execute(sql`CREATE TABLE "appointments" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"customer" varchar(36) NOT NULL,
	"barber" varchar(36) NOT NULL,
	"service" varchar(36) NOT NULL,
	"scheduledAt" timestamp(3) with time zone NOT NULL,
	"status" varchar(50) DEFAULT 'pending' NOT NULL,
	"notes" text,
	"cancelledAt" timestamp(3) with time zone,
	"cancellationReason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`);
    await db.execute(sql`CREATE TABLE "reviews" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"customer" varchar(36),
	"customerName" varchar(255) NOT NULL,
	"customerEmail" varchar(255),
	"barber" varchar(36) NOT NULL,
	"appointment" varchar(36),
	"rating" integer NOT NULL,
	"isApproved" boolean DEFAULT false NOT NULL,
	"isFeatured" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`);
    await db.execute(sql`CREATE TABLE "reviews_i18n" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"parent_id" text NOT NULL,
	"locale" text NOT NULL,
	"_localized" jsonb,
	"comment" text
);`);
    await db.execute(sql`CREATE TABLE "pages" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"slug" varchar(255) NOT NULL,
	"isPublished" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`);
    await db.execute(sql`CREATE TABLE "pages_i18n" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"parent_id" text NOT NULL,
	"locale" text NOT NULL,
	"_localized" jsonb,
	"title" varchar(255) NOT NULL,
	"description" text,
	"content" jsonb,
	"metaTitle" varchar(255),
	"metaDescription" text
);`);
    await db.execute(sql`CREATE TABLE "site_settings" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"shopName" varchar(255) DEFAULT 'Sharp Cuts' NOT NULL,
	"logo" varchar(36),
	"ctaButtonLink" varchar(255) DEFAULT '/booking',
	"contactEmail" varchar(255) DEFAULT 'hello@barbershop.com' NOT NULL,
	"contactPhone" varchar(255) DEFAULT '+1 555 0100',
	"address" varchar(255) DEFAULT '123 Main Street',
	"city" varchar(255) DEFAULT 'New York',
	"zipCode" varchar(255) DEFAULT '10001',
	"country" varchar(255) DEFAULT 'USA',
	"mapEmbedUrl" varchar(255),
	"isOpen" boolean DEFAULT true NOT NULL,
	"bookingEnabled" boolean DEFAULT true NOT NULL,
	"businessHours" jsonb DEFAULT '{"monday":{"isOpen":true,"start":"09:00","end":"18:00"},"tuesday":{"isOpen":true,"start":"09:00","end":"18:00"},"wednesday":{"isOpen":true,"start":"09:00","end":"18:00"},"thursday":{"isOpen":true,"start":"09:00","end":"20:00"},"friday":{"isOpen":true,"start":"09:00","end":"20:00"},"saturday":{"isOpen":true,"start":"10:00","end":"16:00"},"sunday":{"isOpen":false,"start":"","end":""}}',
	"bookingSettings" jsonb DEFAULT '{"minAdvanceHours":2,"maxAdvanceDays":30,"slotDurationMinutes":30,"allowCancellation":true,"cancellationDeadlineHours":24}',
	"socialLinks" jsonb DEFAULT '[{"platform":"instagram","url":"https://instagram.com/sharpcuts"},{"platform":"facebook","url":"https://facebook.com/sharpcuts"}]',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`);
    await db.execute(sql`CREATE TABLE "site_settings_i18n" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"parent_id" text NOT NULL,
	"locale" text NOT NULL,
	"tagline" varchar(255) DEFAULT 'Your Style, Our Passion',
	"navigation" jsonb DEFAULT '[{"label":"Home","href":"/"},{"label":"Services","href":"/services"},{"label":"Our Team","href":"/barbers"},{"label":"Contact","href":"/contact"}]',
	"ctaButtonText" varchar(255) DEFAULT 'Book Now',
	"footerTagline" varchar(255) DEFAULT 'Your Style, Our Passion',
	"footerLinks" jsonb DEFAULT '[{"label":"Services","href":"/services"},{"label":"Our Team","href":"/barbers"},{"label":"Contact","href":"/contact"},{"label":"Privacy Policy","href":"/privacy"}]',
	"copyrightText" varchar(255) DEFAULT 'Sharp Cuts. All rights reserved.',
	"metaTitle" varchar(255) DEFAULT 'Sharp Cuts - Premium Barbershop',
	"metaDescription" text DEFAULT 'Professional barbershop services - haircuts, beard grooming, and more.'
);`);
    await db.execute(sql`CREATE TABLE "site_settings_versions" (
	"version_id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"id" text NOT NULL,
	"version_number" integer NOT NULL,
	"version_operation" text NOT NULL,
	"version_user_id" text,
	"version_created_at" timestamp DEFAULT now() NOT NULL,
	"shopName" varchar(255) DEFAULT 'Sharp Cuts' NOT NULL,
	"logo" varchar(36),
	"ctaButtonLink" varchar(255) DEFAULT '/booking',
	"contactEmail" varchar(255) DEFAULT 'hello@barbershop.com' NOT NULL,
	"contactPhone" varchar(255) DEFAULT '+1 555 0100',
	"address" varchar(255) DEFAULT '123 Main Street',
	"city" varchar(255) DEFAULT 'New York',
	"zipCode" varchar(255) DEFAULT '10001',
	"country" varchar(255) DEFAULT 'USA',
	"mapEmbedUrl" varchar(255),
	"isOpen" boolean DEFAULT true NOT NULL,
	"bookingEnabled" boolean DEFAULT true NOT NULL,
	"businessHours" jsonb DEFAULT '{"monday":{"isOpen":true,"start":"09:00","end":"18:00"},"tuesday":{"isOpen":true,"start":"09:00","end":"18:00"},"wednesday":{"isOpen":true,"start":"09:00","end":"18:00"},"thursday":{"isOpen":true,"start":"09:00","end":"20:00"},"friday":{"isOpen":true,"start":"09:00","end":"20:00"},"saturday":{"isOpen":true,"start":"10:00","end":"16:00"},"sunday":{"isOpen":false,"start":"","end":""}}',
	"bookingSettings" jsonb DEFAULT '{"minAdvanceHours":2,"maxAdvanceDays":30,"slotDurationMinutes":30,"allowCancellation":true,"cancellationDeadlineHours":24}',
	"socialLinks" jsonb DEFAULT '[{"platform":"instagram","url":"https://instagram.com/sharpcuts"},{"platform":"facebook","url":"https://facebook.com/sharpcuts"}]',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`);
    await db.execute(sql`CREATE TABLE "site_settings_i18n_versions" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"parent_id" text NOT NULL,
	"version_number" integer NOT NULL,
	"locale" text NOT NULL,
	"tagline" varchar(255) DEFAULT 'Your Style, Our Passion',
	"navigation" jsonb DEFAULT '[{"label":"Home","href":"/"},{"label":"Services","href":"/services"},{"label":"Our Team","href":"/barbers"},{"label":"Contact","href":"/contact"}]',
	"ctaButtonText" varchar(255) DEFAULT 'Book Now',
	"footerTagline" varchar(255) DEFAULT 'Your Style, Our Passion',
	"footerLinks" jsonb DEFAULT '[{"label":"Services","href":"/services"},{"label":"Our Team","href":"/barbers"},{"label":"Contact","href":"/contact"},{"label":"Privacy Policy","href":"/privacy"}]',
	"copyrightText" varchar(255) DEFAULT 'Sharp Cuts. All rights reserved.',
	"metaTitle" varchar(255) DEFAULT 'Sharp Cuts - Premium Barbershop',
	"metaDescription" text DEFAULT 'Professional barbershop services - haircuts, beard grooming, and more.'
);`);
    await db.execute(sql`CREATE TABLE "questpie_realtime_log" (
	"seq" bigserial PRIMARY KEY,
	"resource_type" text NOT NULL,
	"resource" text NOT NULL,
	"operation" text NOT NULL,
	"record_id" text,
	"locale" text,
	"payload" jsonb DEFAULT '{}',
	"created_at" timestamp DEFAULT now() NOT NULL
);`);
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
);`);
    await db.execute(sql`CREATE TABLE "questpie_search_facets" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"search_id" text NOT NULL,
	"collection_name" text NOT NULL,
	"locale" text NOT NULL,
	"facet_name" text NOT NULL,
	"facet_value" text NOT NULL,
	"numeric_value" numeric,
	"created_at" timestamp DEFAULT now() NOT NULL
);`);
    await db.execute(
      sql`CREATE UNIQUE INDEX "admin_preferences_user_key_idx" ON "admin_preferences" ("userId","key");`,
    );
    await db.execute(
      sql`CREATE UNIQUE INDEX "barbers_slug_unique" ON "barbers" ("slug");`,
    );
    await db.execute(
      sql`CREATE UNIQUE INDEX "barbers_email_unique" ON "barbers" ("email");`,
    );
    await db.execute(
      sql`CREATE UNIQUE INDEX "barbers_i18n_parent_id_locale_index" ON "barbers_i18n" ("parent_id","locale");`,
    );
    await db.execute(
      sql`CREATE UNIQUE INDEX "services_i18n_parent_id_locale_index" ON "services_i18n" ("parent_id","locale");`,
    );
    await db.execute(
      sql`CREATE UNIQUE INDEX "reviews_i18n_parent_id_locale_index" ON "reviews_i18n" ("parent_id","locale");`,
    );
    await db.execute(
      sql`CREATE UNIQUE INDEX "pages_slug_unique" ON "pages" ("slug");`,
    );
    await db.execute(
      sql`CREATE UNIQUE INDEX "pages_i18n_parent_id_locale_index" ON "pages_i18n" ("parent_id","locale");`,
    );
    await db.execute(
      sql`CREATE UNIQUE INDEX "site_settings_i18n_parent_id_locale_index" ON "site_settings_i18n" ("parent_id","locale");`,
    );
    await db.execute(
      sql`CREATE INDEX "site_settings_versions_id_version_number_index" ON "site_settings_versions" ("id","version_number");`,
    );
    await db.execute(
      sql`CREATE INDEX "site_settings_versions_version_created_at_index" ON "site_settings_versions" ("version_created_at");`,
    );
    await db.execute(
      sql`CREATE UNIQUE INDEX "site_settings_i18n_versions_parent_id_version_number_locale_index" ON "site_settings_i18n_versions" ("parent_id","version_number","locale");`,
    );
    await db.execute(
      sql`CREATE INDEX "site_settings_i18n_versions_parent_id_version_number_index" ON "site_settings_i18n_versions" ("parent_id","version_number");`,
    );
    await db.execute(
      sql`CREATE INDEX "idx_realtime_log_seq" ON "questpie_realtime_log" ("seq");`,
    );
    await db.execute(
      sql`CREATE INDEX "idx_realtime_log_resource" ON "questpie_realtime_log" ("resource_type","resource");`,
    );
    await db.execute(
      sql`CREATE INDEX "idx_realtime_log_created_at" ON "questpie_realtime_log" ("created_at");`,
    );
    await db.execute(
      sql`CREATE INDEX "idx_search_fts" ON "questpie_search" USING gin ("fts_vector");`,
    );
    await db.execute(
      sql`CREATE INDEX "idx_search_trigram" ON "questpie_search" USING gin ("title" gin_trgm_ops);`,
    );
    await db.execute(
      sql`CREATE INDEX "idx_search_collection_locale" ON "questpie_search" ("collection_name","locale");`,
    );
    await db.execute(
      sql`CREATE INDEX "idx_search_record_id" ON "questpie_search" ("record_id");`,
    );
    await db.execute(
      sql`CREATE INDEX "idx_facets_agg" ON "questpie_search_facets" ("collection_name","locale","facet_name","facet_value");`,
    );
    await db.execute(
      sql`CREATE INDEX "idx_facets_search_id" ON "questpie_search_facets" ("search_id");`,
    );
    await db.execute(
      sql`CREATE INDEX "idx_facets_collection" ON "questpie_search_facets" ("collection_name");`,
    );
    await db.execute(
      sql`ALTER TABLE "barbers_i18n" ADD CONSTRAINT "barbers_i18n_parent_id_barbers_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "barbers"("id") ON DELETE CASCADE;`,
    );
    await db.execute(
      sql`ALTER TABLE "services_i18n" ADD CONSTRAINT "services_i18n_parent_id_services_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "services"("id") ON DELETE CASCADE;`,
    );
    await db.execute(
      sql`ALTER TABLE "barber_services" ADD CONSTRAINT "barber_services_barber_barbers_id_fkey" FOREIGN KEY ("barber") REFERENCES "barbers"("id") ON DELETE CASCADE;`,
    );
    await db.execute(
      sql`ALTER TABLE "barber_services" ADD CONSTRAINT "barber_services_service_services_id_fkey" FOREIGN KEY ("service") REFERENCES "services"("id") ON DELETE CASCADE;`,
    );
    await db.execute(
      sql`ALTER TABLE "reviews_i18n" ADD CONSTRAINT "reviews_i18n_parent_id_reviews_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "reviews"("id") ON DELETE CASCADE;`,
    );
    await db.execute(
      sql`ALTER TABLE "pages_i18n" ADD CONSTRAINT "pages_i18n_parent_id_pages_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "pages"("id") ON DELETE CASCADE;`,
    );
    await db.execute(
      sql`ALTER TABLE "site_settings_i18n" ADD CONSTRAINT "site_settings_i18n_parent_id_site_settings_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "site_settings"("id") ON DELETE CASCADE;`,
    );
  },
  async down({ db }) {
    await db.execute(
      sql`ALTER TABLE "barbers_i18n" DROP CONSTRAINT IF EXISTS "barbers_i18n_parent_id_barbers_id_fkey";`,
    );
    await db.execute(
      sql`ALTER TABLE "services_i18n" DROP CONSTRAINT IF EXISTS "services_i18n_parent_id_services_id_fkey";`,
    );
    await db.execute(
      sql`ALTER TABLE "barber_services" DROP CONSTRAINT IF EXISTS "barber_services_barber_barbers_id_fkey";`,
    );
    await db.execute(
      sql`ALTER TABLE "barber_services" DROP CONSTRAINT IF EXISTS "barber_services_service_services_id_fkey";`,
    );
    await db.execute(
      sql`ALTER TABLE "reviews_i18n" DROP CONSTRAINT IF EXISTS "reviews_i18n_parent_id_reviews_id_fkey";`,
    );
    await db.execute(
      sql`ALTER TABLE "pages_i18n" DROP CONSTRAINT IF EXISTS "pages_i18n_parent_id_pages_id_fkey";`,
    );
    await db.execute(
      sql`ALTER TABLE "site_settings_i18n" DROP CONSTRAINT IF EXISTS "site_settings_i18n_parent_id_site_settings_id_fkey";`,
    );
    await db.execute(sql`DROP TABLE "assets";`);
    await db.execute(sql`DROP TABLE "user";`);
    await db.execute(sql`DROP TABLE "session";`);
    await db.execute(sql`DROP TABLE "account";`);
    await db.execute(sql`DROP TABLE "verification";`);
    await db.execute(sql`DROP TABLE "apikey";`);
    await db.execute(sql`DROP TABLE "admin_saved_views";`);
    await db.execute(sql`DROP TABLE "admin_preferences";`);
    await db.execute(sql`DROP TABLE "barbers";`);
    await db.execute(sql`DROP TABLE "barbers_i18n";`);
    await db.execute(sql`DROP TABLE "services";`);
    await db.execute(sql`DROP TABLE "services_i18n";`);
    await db.execute(sql`DROP TABLE "barber_services";`);
    await db.execute(sql`DROP TABLE "appointments";`);
    await db.execute(sql`DROP TABLE "reviews";`);
    await db.execute(sql`DROP TABLE "reviews_i18n";`);
    await db.execute(sql`DROP TABLE "pages";`);
    await db.execute(sql`DROP TABLE "pages_i18n";`);
    await db.execute(sql`DROP TABLE "site_settings";`);
    await db.execute(sql`DROP TABLE "site_settings_i18n";`);
    await db.execute(sql`DROP TABLE "site_settings_versions";`);
    await db.execute(sql`DROP TABLE "site_settings_i18n_versions";`);
    await db.execute(sql`DROP TABLE "questpie_realtime_log";`);
    await db.execute(sql`DROP TABLE "questpie_search";`);
    await db.execute(sql`DROP TABLE "questpie_search_facets";`);
  },
  snapshot,
};
