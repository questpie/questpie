import { migration } from "questpie/services"
import type { OperationSnapshot } from "questpie/migration"
import { sql } from "drizzle-orm"
import snapshotJson from "./snapshots/20260915T042709_realtime-idempotency-1.json"

const snapshot = snapshotJson as OperationSnapshot

export default migration({
	id: "realtimeIdempotency120260915T042709",
	async up({ db }) {
		await db.execute(sql`CREATE TABLE "oauthClientAssertion" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"expiresAt" timestamp(3) with time zone NOT NULL
);`)
		await db.execute(sql`CREATE TABLE "oauthClientResource" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"clientId" varchar(255) NOT NULL,
	"resourceId" varchar(500) NOT NULL,
	"metadata" jsonb,
	"createdAt" timestamp(3) with time zone
);`)
		await db.execute(sql`CREATE TABLE "oauthResource" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"identifier" varchar(500) NOT NULL,
	"name" varchar(255) NOT NULL,
	"accessTokenTtl" integer,
	"refreshTokenTtl" integer,
	"signingAlgorithm" varchar(50),
	"signingKeyId" varchar(255),
	"allowedScopes" jsonb,
	"customClaims" jsonb,
	"dpopBoundAccessTokensRequired" boolean DEFAULT false,
	"disabled" boolean DEFAULT false,
	"createdAt" timestamp(3) with time zone,
	"updatedAt" timestamp(3) with time zone,
	"policyVersion" integer DEFAULT 1,
	"metadata" jsonb
);`)
		await db.execute(sql`ALTER TABLE "jwks" ADD COLUMN "alg" varchar(50);`)
		await db.execute(sql`ALTER TABLE "jwks" ADD COLUMN "crv" varchar(50);`)
		await db.execute(sql`ALTER TABLE "oauthAccessToken" ADD COLUMN "authorizationCodeId" varchar(255);`)
		await db.execute(sql`ALTER TABLE "oauthAccessToken" ADD COLUMN "revoked" timestamp(3) with time zone;`)
		await db.execute(sql`ALTER TABLE "oauthAccessToken" ADD COLUMN "resources" jsonb;`)
		await db.execute(sql`ALTER TABLE "oauthAccessToken" ADD COLUMN "requestedUserInfoClaims" jsonb;`)
		await db.execute(sql`ALTER TABLE "oauthAccessToken" ADD COLUMN "confirmation" jsonb;`)
		await db.execute(sql`ALTER TABLE "oauthClient" ADD COLUMN "clientDiscoveryId" varchar(255);`)
		await db.execute(sql`ALTER TABLE "oauthClient" ADD COLUMN "clientCredentialsScopes" jsonb;`)
		await db.execute(sql`ALTER TABLE "oauthClient" ADD COLUMN "backchannelLogoutUri" varchar(2048);`)
		await db.execute(sql`ALTER TABLE "oauthClient" ADD COLUMN "backchannelLogoutSessionRequired" boolean;`)
		await db.execute(sql`ALTER TABLE "oauthClient" ADD COLUMN "applicationType" varchar(255);`)
		await db.execute(sql`ALTER TABLE "oauthClient" ADD COLUMN "jwks" text;`)
		await db.execute(sql`ALTER TABLE "oauthClient" ADD COLUMN "jwksUri" varchar(2048);`)
		await db.execute(sql`ALTER TABLE "oauthClient" ADD COLUMN "dpopBoundAccessTokens" boolean DEFAULT false;`)
		await db.execute(sql`ALTER TABLE "oauthConsent" ADD COLUMN "resources" jsonb;`)
		await db.execute(sql`ALTER TABLE "oauthConsent" ADD COLUMN "requestedUserInfoClaims" jsonb;`)
		await db.execute(sql`ALTER TABLE "oauthRefreshToken" ADD COLUMN "authorizationCodeId" varchar(255);`)
		await db.execute(sql`ALTER TABLE "oauthRefreshToken" ADD COLUMN "rotatedAt" timestamp(3) with time zone;`)
		await db.execute(sql`ALTER TABLE "oauthRefreshToken" ADD COLUMN "rotationReplayResponse" text;`)
		await db.execute(sql`ALTER TABLE "oauthRefreshToken" ADD COLUMN "rotationReplayExpiresAt" timestamp(3) with time zone;`)
		await db.execute(sql`ALTER TABLE "oauthRefreshToken" ADD COLUMN "resources" jsonb;`)
		await db.execute(sql`ALTER TABLE "oauthRefreshToken" ADD COLUMN "requestedUserInfoClaims" jsonb;`)
		await db.execute(sql`ALTER TABLE "oauthRefreshToken" ADD COLUMN "confirmation" jsonb;`)
		await db.execute(sql`CREATE UNIQUE INDEX "oauthClientResource_clientId_resourceId_index" ON "oauthClientResource" ("clientId","resourceId");`)
		await db.execute(sql`CREATE UNIQUE INDEX "oauthResource_identifier_index" ON "oauthResource" ("identifier");`)
	},
	async down({ db }) {
		await db.execute(sql`DROP TABLE "oauthClientAssertion";`)
		await db.execute(sql`DROP TABLE "oauthClientResource";`)
		await db.execute(sql`DROP TABLE "oauthResource";`)
		await db.execute(sql`ALTER TABLE "jwks" DROP COLUMN "alg";`)
		await db.execute(sql`ALTER TABLE "jwks" DROP COLUMN "crv";`)
		await db.execute(sql`ALTER TABLE "oauthAccessToken" DROP COLUMN "authorizationCodeId";`)
		await db.execute(sql`ALTER TABLE "oauthAccessToken" DROP COLUMN "revoked";`)
		await db.execute(sql`ALTER TABLE "oauthAccessToken" DROP COLUMN "resources";`)
		await db.execute(sql`ALTER TABLE "oauthAccessToken" DROP COLUMN "requestedUserInfoClaims";`)
		await db.execute(sql`ALTER TABLE "oauthAccessToken" DROP COLUMN "confirmation";`)
		await db.execute(sql`ALTER TABLE "oauthClient" DROP COLUMN "clientDiscoveryId";`)
		await db.execute(sql`ALTER TABLE "oauthClient" DROP COLUMN "clientCredentialsScopes";`)
		await db.execute(sql`ALTER TABLE "oauthClient" DROP COLUMN "backchannelLogoutUri";`)
		await db.execute(sql`ALTER TABLE "oauthClient" DROP COLUMN "backchannelLogoutSessionRequired";`)
		await db.execute(sql`ALTER TABLE "oauthClient" DROP COLUMN "applicationType";`)
		await db.execute(sql`ALTER TABLE "oauthClient" DROP COLUMN "jwks";`)
		await db.execute(sql`ALTER TABLE "oauthClient" DROP COLUMN "jwksUri";`)
		await db.execute(sql`ALTER TABLE "oauthClient" DROP COLUMN "dpopBoundAccessTokens";`)
		await db.execute(sql`ALTER TABLE "oauthConsent" DROP COLUMN "resources";`)
		await db.execute(sql`ALTER TABLE "oauthConsent" DROP COLUMN "requestedUserInfoClaims";`)
		await db.execute(sql`ALTER TABLE "oauthRefreshToken" DROP COLUMN "authorizationCodeId";`)
		await db.execute(sql`ALTER TABLE "oauthRefreshToken" DROP COLUMN "rotatedAt";`)
		await db.execute(sql`ALTER TABLE "oauthRefreshToken" DROP COLUMN "rotationReplayResponse";`)
		await db.execute(sql`ALTER TABLE "oauthRefreshToken" DROP COLUMN "rotationReplayExpiresAt";`)
		await db.execute(sql`ALTER TABLE "oauthRefreshToken" DROP COLUMN "resources";`)
		await db.execute(sql`ALTER TABLE "oauthRefreshToken" DROP COLUMN "requestedUserInfoClaims";`)
		await db.execute(sql`ALTER TABLE "oauthRefreshToken" DROP COLUMN "confirmation";`)
	},
	snapshot,
})
