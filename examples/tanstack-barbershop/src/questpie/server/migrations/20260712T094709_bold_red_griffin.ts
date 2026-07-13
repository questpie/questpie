import { sql } from "drizzle-orm";
import type { OperationSnapshot } from "questpie/migration";
import { migration } from "questpie/services";

import snapshotJson from "./snapshots/20260712T094709_bold_red_griffin.json";

const snapshot = snapshotJson as OperationSnapshot;

export default migration({
	id: "boldRedGriffin20260712T094709",
	async up({ db }) {
		await db.execute(sql`CREATE TABLE "jwks" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"publicKey" text NOT NULL,
	"privateKey" text NOT NULL,
	"createdAt" timestamp(3) with time zone NOT NULL,
	"expiresAt" timestamp(3) with time zone
);`);
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
);`);
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
);`);
		await db.execute(sql`CREATE TABLE "oauthConsent" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"clientId" varchar(255) NOT NULL,
	"userId" varchar(255),
	"referenceId" varchar(255),
	"scopes" jsonb NOT NULL,
	"createdAt" timestamp(3) with time zone,
	"updatedAt" timestamp(3) with time zone
);`);
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
);`);
		// IF NOT EXISTS: swiftOrangeEagle20260615T084209 already adds this column;
		// the generator re-emitted it because snapshot replay loses the op (see
		// framework issue: snapshot replay vs internal module chain ordering).
		await db.execute(
			sql`ALTER TABLE "apikey" ADD COLUMN IF NOT EXISTS "configId" varchar(255) DEFAULT 'default' NOT NULL;`,
		);
		await db.execute(
			sql`ALTER TABLE "assets" ALTER COLUMN "key" DROP NOT NULL;`,
		);
		await db.execute(
			sql`ALTER TABLE "assets" ALTER COLUMN "filename" DROP NOT NULL;`,
		);
		await db.execute(
			sql`ALTER TABLE "assets" ALTER COLUMN "mime_type" DROP NOT NULL;`,
		);
		await db.execute(
			sql`ALTER TABLE "assets" ALTER COLUMN "size" DROP NOT NULL;`,
		);
		await db.execute(
			sql`ALTER TABLE "assets" ALTER COLUMN "created_at" SET DATA TYPE timestamp(3) USING "created_at"::timestamp(3);`,
		);
		await db.execute(
			sql`ALTER TABLE "assets" ALTER COLUMN "updated_at" SET DATA TYPE timestamp(3) USING "updated_at"::timestamp(3);`,
		);
		await db.execute(
			sql`ALTER TABLE "user" ALTER COLUMN "created_at" SET DATA TYPE timestamp(3) USING "created_at"::timestamp(3);`,
		);
		await db.execute(
			sql`ALTER TABLE "user" ALTER COLUMN "updated_at" SET DATA TYPE timestamp(3) USING "updated_at"::timestamp(3);`,
		);
		await db.execute(
			sql`ALTER TABLE "verification" ALTER COLUMN "value" SET DATA TYPE text USING "value"::text;`,
		);
		await db.execute(
			sql`ALTER TABLE "apikey" ALTER COLUMN "created_at" SET DATA TYPE timestamp(3) USING "created_at"::timestamp(3);`,
		);
		await db.execute(
			sql`ALTER TABLE "apikey" ALTER COLUMN "updated_at" SET DATA TYPE timestamp(3) USING "updated_at"::timestamp(3);`,
		);
		await db.execute(
			sql`ALTER TABLE "admin_saved_views" ALTER COLUMN "created_at" SET DATA TYPE timestamp(3) USING "created_at"::timestamp(3);`,
		);
		await db.execute(
			sql`ALTER TABLE "admin_saved_views" ALTER COLUMN "updated_at" SET DATA TYPE timestamp(3) USING "updated_at"::timestamp(3);`,
		);
		await db.execute(
			sql`ALTER TABLE "admin_preferences" ALTER COLUMN "created_at" SET DATA TYPE timestamp(3) USING "created_at"::timestamp(3);`,
		);
		await db.execute(
			sql`ALTER TABLE "admin_preferences" ALTER COLUMN "updated_at" SET DATA TYPE timestamp(3) USING "updated_at"::timestamp(3);`,
		);
		await db.execute(
			sql`ALTER TABLE "barbers" ALTER COLUMN "created_at" SET DATA TYPE timestamp(3) USING "created_at"::timestamp(3);`,
		);
		await db.execute(
			sql`ALTER TABLE "barbers" ALTER COLUMN "updated_at" SET DATA TYPE timestamp(3) USING "updated_at"::timestamp(3);`,
		);
		await db.execute(
			sql`ALTER TABLE "services" ALTER COLUMN "created_at" SET DATA TYPE timestamp(3) USING "created_at"::timestamp(3);`,
		);
		await db.execute(
			sql`ALTER TABLE "services" ALTER COLUMN "updated_at" SET DATA TYPE timestamp(3) USING "updated_at"::timestamp(3);`,
		);
		await db.execute(
			sql`ALTER TABLE "barber_services" ALTER COLUMN "created_at" SET DATA TYPE timestamp(3) USING "created_at"::timestamp(3);`,
		);
		await db.execute(
			sql`ALTER TABLE "barber_services" ALTER COLUMN "updated_at" SET DATA TYPE timestamp(3) USING "updated_at"::timestamp(3);`,
		);
		await db.execute(
			sql`ALTER TABLE "appointments" ALTER COLUMN "created_at" SET DATA TYPE timestamp(3) USING "created_at"::timestamp(3);`,
		);
		await db.execute(
			sql`ALTER TABLE "appointments" ALTER COLUMN "updated_at" SET DATA TYPE timestamp(3) USING "updated_at"::timestamp(3);`,
		);
		await db.execute(
			sql`ALTER TABLE "reviews" ALTER COLUMN "created_at" SET DATA TYPE timestamp(3) USING "created_at"::timestamp(3);`,
		);
		await db.execute(
			sql`ALTER TABLE "reviews" ALTER COLUMN "updated_at" SET DATA TYPE timestamp(3) USING "updated_at"::timestamp(3);`,
		);
		await db.execute(
			sql`ALTER TABLE "pages" ALTER COLUMN "created_at" SET DATA TYPE timestamp(3) USING "created_at"::timestamp(3);`,
		);
		await db.execute(
			sql`ALTER TABLE "pages" ALTER COLUMN "updated_at" SET DATA TYPE timestamp(3) USING "updated_at"::timestamp(3);`,
		);
		await db.execute(
			sql`ALTER TABLE "site_settings" ALTER COLUMN "created_at" SET DATA TYPE timestamp(3) USING "created_at"::timestamp(3);`,
		);
		await db.execute(
			sql`ALTER TABLE "site_settings" ALTER COLUMN "updated_at" SET DATA TYPE timestamp(3) USING "updated_at"::timestamp(3);`,
		);
		await db.execute(
			sql`ALTER TABLE "site_settings_i18n" ALTER COLUMN "footerLinks" SET DEFAULT '[{"label":"Services","href":"/services","isExternal":false},{"label":"Our Team","href":"/barbers","isExternal":false},{"label":"Contact","href":"/contact","isExternal":false},{"label":"Privacy Policy","href":"/privacy","isExternal":false}]';`,
		);
		await db.execute(
			sql`ALTER TABLE "site_settings_versions" ALTER COLUMN "version_created_at" SET DATA TYPE timestamp(3) USING "version_created_at"::timestamp(3);`,
		);
		await db.execute(
			sql`ALTER TABLE "site_settings_versions" ALTER COLUMN "created_at" SET DATA TYPE timestamp(3) USING "created_at"::timestamp(3);`,
		);
		await db.execute(
			sql`ALTER TABLE "site_settings_versions" ALTER COLUMN "updated_at" SET DATA TYPE timestamp(3) USING "updated_at"::timestamp(3);`,
		);
		await db.execute(
			sql`ALTER TABLE "site_settings_i18n_versions" ALTER COLUMN "footerLinks" SET DEFAULT '[{"label":"Services","href":"/services","isExternal":false},{"label":"Our Team","href":"/barbers","isExternal":false},{"label":"Contact","href":"/contact","isExternal":false},{"label":"Privacy Policy","href":"/privacy","isExternal":false}]';`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_realtime_log" ALTER COLUMN "created_at" SET DATA TYPE timestamp(3) USING "created_at"::timestamp(3);`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_search" ALTER COLUMN "created_at" SET DATA TYPE timestamp(3) USING "created_at"::timestamp(3);`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_search" ALTER COLUMN "updated_at" SET DATA TYPE timestamp(3) USING "updated_at"::timestamp(3);`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_search_facets" ALTER COLUMN "created_at" SET DATA TYPE timestamp(3) USING "created_at"::timestamp(3);`,
		);
		await db.execute(
			sql`ALTER TABLE "session" ALTER COLUMN "created_at" SET DATA TYPE timestamp(3) USING "created_at"::timestamp(3);`,
		);
		await db.execute(
			sql`ALTER TABLE "session" ALTER COLUMN "updated_at" SET DATA TYPE timestamp(3) USING "updated_at"::timestamp(3);`,
		);
		await db.execute(
			sql`ALTER TABLE "account" ALTER COLUMN "created_at" SET DATA TYPE timestamp(3) USING "created_at"::timestamp(3);`,
		);
		await db.execute(
			sql`ALTER TABLE "account" ALTER COLUMN "updated_at" SET DATA TYPE timestamp(3) USING "updated_at"::timestamp(3);`,
		);
		await db.execute(
			sql`ALTER TABLE "verification" ALTER COLUMN "created_at" SET DATA TYPE timestamp(3) USING "created_at"::timestamp(3);`,
		);
		await db.execute(
			sql`ALTER TABLE "verification" ALTER COLUMN "updated_at" SET DATA TYPE timestamp(3) USING "updated_at"::timestamp(3);`,
		);
		await db.execute(
			sql`ALTER TABLE "admin_locks" ALTER COLUMN "created_at" SET DATA TYPE timestamp(3) USING "created_at"::timestamp(3);`,
		);
		await db.execute(
			sql`ALTER TABLE "admin_locks" ALTER COLUMN "updated_at" SET DATA TYPE timestamp(3) USING "updated_at"::timestamp(3);`,
		);
		await db.execute(
			sql`ALTER TABLE "admin_audit_log" ALTER COLUMN "created_at" SET DATA TYPE timestamp(3) USING "created_at"::timestamp(3);`,
		);
		await db.execute(
			sql`ALTER TABLE "admin_audit_log" ALTER COLUMN "updated_at" SET DATA TYPE timestamp(3) USING "updated_at"::timestamp(3);`,
		);
		await db.execute(
			sql`ALTER TABLE "user" ALTER COLUMN "image" SET DATA TYPE varchar(500) USING "image"::varchar(500);`,
		);
		await db.execute(
			sql`ALTER TABLE "blog_posts" ALTER COLUMN "created_at" SET DATA TYPE timestamp(3) USING "created_at"::timestamp(3);`,
		);
		await db.execute(
			sql`ALTER TABLE "blog_posts" ALTER COLUMN "updated_at" SET DATA TYPE timestamp(3) USING "updated_at"::timestamp(3);`,
		);
		await db.execute(
			sql`ALTER TABLE "site_settings_i18n" ALTER COLUMN "navigation" SET DEFAULT '[{"label":"Home","href":"/","isExternal":false},{"label":"Services","href":"/services","isExternal":false},{"label":"Our Team","href":"/barbers","isExternal":false},{"label":"Contact","href":"/contact","isExternal":false}]';`,
		);
		await db.execute(
			sql`ALTER TABLE "site_settings_i18n_versions" ALTER COLUMN "navigation" SET DEFAULT '[{"label":"Home","href":"/","isExternal":false},{"label":"Services","href":"/services","isExternal":false},{"label":"Our Team","href":"/barbers","isExternal":false},{"label":"Contact","href":"/contact","isExternal":false}]';`,
		);
		await db.execute(
			sql`ALTER TABLE "pages_versions" ALTER COLUMN "version_created_at" SET DATA TYPE timestamp(3) USING "version_created_at"::timestamp(3);`,
		);
		await db.execute(
			sql`ALTER TABLE "pages_versions" ALTER COLUMN "created_at" SET DATA TYPE timestamp(3) USING "created_at"::timestamp(3);`,
		);
		await db.execute(
			sql`ALTER TABLE "pages_versions" ALTER COLUMN "updated_at" SET DATA TYPE timestamp(3) USING "updated_at"::timestamp(3);`,
		);
	},
	async down({ db }) {
		await db.execute(sql`DROP TABLE "jwks";`);
		await db.execute(sql`DROP TABLE "oauthAccessToken";`);
		await db.execute(sql`DROP TABLE "oauthClient";`);
		await db.execute(sql`DROP TABLE "oauthConsent";`);
		await db.execute(sql`DROP TABLE "oauthRefreshToken";`);
		// Mirror of the guarded up(): the column belongs to swiftOrangeEagle's
		// history, so this down must not remove it from under that migration.
		await db.execute(
			sql`ALTER TABLE "apikey" DROP COLUMN IF EXISTS "configId";`,
		);
		await db.execute(
			sql`ALTER TABLE "account" ALTER COLUMN "created_at" SET DATA TYPE timestamp USING "created_at"::timestamp;`,
		);
		await db.execute(
			sql`ALTER TABLE "account" ALTER COLUMN "updated_at" SET DATA TYPE timestamp USING "updated_at"::timestamp;`,
		);
		await db.execute(
			sql`ALTER TABLE "apikey" ALTER COLUMN "created_at" SET DATA TYPE timestamp USING "created_at"::timestamp;`,
		);
		await db.execute(
			sql`ALTER TABLE "apikey" ALTER COLUMN "updated_at" SET DATA TYPE timestamp USING "updated_at"::timestamp;`,
		);
		await db.execute(
			sql`ALTER TABLE "assets" ALTER COLUMN "key" SET NOT NULL;`,
		);
		await db.execute(
			sql`ALTER TABLE "assets" ALTER COLUMN "filename" SET NOT NULL;`,
		);
		await db.execute(
			sql`ALTER TABLE "assets" ALTER COLUMN "mime_type" SET NOT NULL;`,
		);
		await db.execute(
			sql`ALTER TABLE "assets" ALTER COLUMN "size" SET NOT NULL;`,
		);
		await db.execute(
			sql`ALTER TABLE "assets" ALTER COLUMN "created_at" SET DATA TYPE timestamp USING "created_at"::timestamp;`,
		);
		await db.execute(
			sql`ALTER TABLE "assets" ALTER COLUMN "updated_at" SET DATA TYPE timestamp USING "updated_at"::timestamp;`,
		);
		await db.execute(
			sql`ALTER TABLE "session" ALTER COLUMN "created_at" SET DATA TYPE timestamp USING "created_at"::timestamp;`,
		);
		await db.execute(
			sql`ALTER TABLE "session" ALTER COLUMN "updated_at" SET DATA TYPE timestamp USING "updated_at"::timestamp;`,
		);
		await db.execute(
			sql`ALTER TABLE "user" ALTER COLUMN "image" SET DATA TYPE varchar(2048) USING "image"::varchar(2048);`,
		);
		await db.execute(
			sql`ALTER TABLE "user" ALTER COLUMN "created_at" SET DATA TYPE timestamp USING "created_at"::timestamp;`,
		);
		await db.execute(
			sql`ALTER TABLE "user" ALTER COLUMN "updated_at" SET DATA TYPE timestamp USING "updated_at"::timestamp;`,
		);
		await db.execute(
			sql`ALTER TABLE "verification" ALTER COLUMN "value" SET DATA TYPE varchar(255) USING "value"::varchar(255);`,
		);
		await db.execute(
			sql`ALTER TABLE "verification" ALTER COLUMN "created_at" SET DATA TYPE timestamp USING "created_at"::timestamp;`,
		);
		await db.execute(
			sql`ALTER TABLE "verification" ALTER COLUMN "updated_at" SET DATA TYPE timestamp USING "updated_at"::timestamp;`,
		);
		await db.execute(
			sql`ALTER TABLE "admin_locks" ALTER COLUMN "created_at" SET DATA TYPE timestamp USING "created_at"::timestamp;`,
		);
		await db.execute(
			sql`ALTER TABLE "admin_locks" ALTER COLUMN "updated_at" SET DATA TYPE timestamp USING "updated_at"::timestamp;`,
		);
		await db.execute(
			sql`ALTER TABLE "admin_preferences" ALTER COLUMN "created_at" SET DATA TYPE timestamp USING "created_at"::timestamp;`,
		);
		await db.execute(
			sql`ALTER TABLE "admin_preferences" ALTER COLUMN "updated_at" SET DATA TYPE timestamp USING "updated_at"::timestamp;`,
		);
		await db.execute(
			sql`ALTER TABLE "admin_saved_views" ALTER COLUMN "created_at" SET DATA TYPE timestamp USING "created_at"::timestamp;`,
		);
		await db.execute(
			sql`ALTER TABLE "admin_saved_views" ALTER COLUMN "updated_at" SET DATA TYPE timestamp USING "updated_at"::timestamp;`,
		);
		await db.execute(
			sql`ALTER TABLE "admin_audit_log" ALTER COLUMN "created_at" SET DATA TYPE timestamp USING "created_at"::timestamp;`,
		);
		await db.execute(
			sql`ALTER TABLE "admin_audit_log" ALTER COLUMN "updated_at" SET DATA TYPE timestamp USING "updated_at"::timestamp;`,
		);
		await db.execute(
			sql`ALTER TABLE "appointments" ALTER COLUMN "created_at" SET DATA TYPE timestamp USING "created_at"::timestamp;`,
		);
		await db.execute(
			sql`ALTER TABLE "appointments" ALTER COLUMN "updated_at" SET DATA TYPE timestamp USING "updated_at"::timestamp;`,
		);
		await db.execute(
			sql`ALTER TABLE "barber_services" ALTER COLUMN "created_at" SET DATA TYPE timestamp USING "created_at"::timestamp;`,
		);
		await db.execute(
			sql`ALTER TABLE "barber_services" ALTER COLUMN "updated_at" SET DATA TYPE timestamp USING "updated_at"::timestamp;`,
		);
		await db.execute(
			sql`ALTER TABLE "barbers" ALTER COLUMN "created_at" SET DATA TYPE timestamp USING "created_at"::timestamp;`,
		);
		await db.execute(
			sql`ALTER TABLE "barbers" ALTER COLUMN "updated_at" SET DATA TYPE timestamp USING "updated_at"::timestamp;`,
		);
		await db.execute(
			sql`ALTER TABLE "blog_posts" ALTER COLUMN "created_at" SET DATA TYPE timestamp USING "created_at"::timestamp;`,
		);
		await db.execute(
			sql`ALTER TABLE "blog_posts" ALTER COLUMN "updated_at" SET DATA TYPE timestamp USING "updated_at"::timestamp;`,
		);
		await db.execute(
			sql`ALTER TABLE "pages" ALTER COLUMN "created_at" SET DATA TYPE timestamp USING "created_at"::timestamp;`,
		);
		await db.execute(
			sql`ALTER TABLE "pages" ALTER COLUMN "updated_at" SET DATA TYPE timestamp USING "updated_at"::timestamp;`,
		);
		await db.execute(
			sql`ALTER TABLE "pages_versions" ALTER COLUMN "version_created_at" SET DATA TYPE timestamp USING "version_created_at"::timestamp;`,
		);
		await db.execute(
			sql`ALTER TABLE "pages_versions" ALTER COLUMN "created_at" SET DATA TYPE timestamp USING "created_at"::timestamp;`,
		);
		await db.execute(
			sql`ALTER TABLE "pages_versions" ALTER COLUMN "updated_at" SET DATA TYPE timestamp USING "updated_at"::timestamp;`,
		);
		await db.execute(
			sql`ALTER TABLE "reviews" ALTER COLUMN "created_at" SET DATA TYPE timestamp USING "created_at"::timestamp;`,
		);
		await db.execute(
			sql`ALTER TABLE "reviews" ALTER COLUMN "updated_at" SET DATA TYPE timestamp USING "updated_at"::timestamp;`,
		);
		await db.execute(
			sql`ALTER TABLE "services" ALTER COLUMN "created_at" SET DATA TYPE timestamp USING "created_at"::timestamp;`,
		);
		await db.execute(
			sql`ALTER TABLE "services" ALTER COLUMN "updated_at" SET DATA TYPE timestamp USING "updated_at"::timestamp;`,
		);
		await db.execute(
			sql`ALTER TABLE "site_settings" ALTER COLUMN "created_at" SET DATA TYPE timestamp USING "created_at"::timestamp;`,
		);
		await db.execute(
			sql`ALTER TABLE "site_settings" ALTER COLUMN "updated_at" SET DATA TYPE timestamp USING "updated_at"::timestamp;`,
		);
		await db.execute(
			sql`ALTER TABLE "site_settings_i18n" ALTER COLUMN "navigation" SET DEFAULT '[{"label":"Home","href":"/"},{"label":"Services","href":"/services"},{"label":"Our Team","href":"/barbers"},{"label":"Blog","href":"/blog"},{"label":"Contact","href":"/contact"}]';`,
		);
		await db.execute(
			sql`ALTER TABLE "site_settings_i18n" ALTER COLUMN "footerLinks" SET DEFAULT '[{"label":"Services","href":"/services"},{"label":"Our Team","href":"/barbers"},{"label":"Contact","href":"/contact"},{"label":"Privacy Policy","href":"/privacy"}]';`,
		);
		await db.execute(
			sql`ALTER TABLE "site_settings_versions" ALTER COLUMN "version_created_at" SET DATA TYPE timestamp USING "version_created_at"::timestamp;`,
		);
		await db.execute(
			sql`ALTER TABLE "site_settings_versions" ALTER COLUMN "created_at" SET DATA TYPE timestamp USING "created_at"::timestamp;`,
		);
		await db.execute(
			sql`ALTER TABLE "site_settings_versions" ALTER COLUMN "updated_at" SET DATA TYPE timestamp USING "updated_at"::timestamp;`,
		);
		await db.execute(
			sql`ALTER TABLE "site_settings_i18n_versions" ALTER COLUMN "navigation" SET DEFAULT '[{"label":"Home","href":"/"},{"label":"Services","href":"/services"},{"label":"Our Team","href":"/barbers"},{"label":"Blog","href":"/blog"},{"label":"Contact","href":"/contact"}]';`,
		);
		await db.execute(
			sql`ALTER TABLE "site_settings_i18n_versions" ALTER COLUMN "footerLinks" SET DEFAULT '[{"label":"Services","href":"/services"},{"label":"Our Team","href":"/barbers"},{"label":"Contact","href":"/contact"},{"label":"Privacy Policy","href":"/privacy"}]';`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_realtime_log" ALTER COLUMN "created_at" SET DATA TYPE timestamp USING "created_at"::timestamp;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_search" ALTER COLUMN "created_at" SET DATA TYPE timestamp USING "created_at"::timestamp;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_search" ALTER COLUMN "updated_at" SET DATA TYPE timestamp USING "updated_at"::timestamp;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_search_facets" ALTER COLUMN "created_at" SET DATA TYPE timestamp USING "created_at"::timestamp;`,
		);
	},
	snapshot,
});
