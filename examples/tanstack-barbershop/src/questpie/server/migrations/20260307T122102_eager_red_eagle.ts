import { sql } from "drizzle-orm";
import { migration } from "questpie";
import type { OperationSnapshot } from "questpie";

import snapshotJson from "./snapshots/20260307T122102_eager_red_eagle.json";

const snapshot = snapshotJson as OperationSnapshot;

export default migration({
	id: "eagerRedEagle20260307T122102",
	async up({ db }) {
		await db.execute(sql`CREATE TABLE "blog_posts" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"title" varchar(255) NOT NULL,
	"slug" varchar(255),
	"content" jsonb,
	"excerpt" text,
	"readingTime" integer,
	"status" varchar(50) DEFAULT 'draft' NOT NULL,
	"publishedAt" timestamp(3) with time zone,
	"author" varchar(36),
	"coverImage" varchar(36),
	"tags" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`);
		await db.execute(
			sql`ALTER TABLE "barber_services" DROP CONSTRAINT IF EXISTS "barber_services_barber_barbers_id_fkey";`,
		);
		await db.execute(
			sql`ALTER TABLE "barber_services" DROP CONSTRAINT IF EXISTS "barber_services_service_services_id_fkey";`,
		);
		await db.execute(
			sql`ALTER TABLE "appointments" ADD COLUMN "displayTitle" varchar(255);`,
		);
		await db.execute(
			sql`ALTER TABLE "user" ALTER COLUMN "image" SET DATA TYPE varchar(2048) USING "image"::varchar(2048);`,
		);
	},
	async down({ db }) {
		await db.execute(sql`DROP TABLE "blog_posts";`);
		await db.execute(
			sql`ALTER TABLE "appointments" DROP COLUMN "displayTitle";`,
		);
		await db.execute(
			sql`ALTER TABLE "user" ALTER COLUMN "image" SET DATA TYPE varchar(500) USING "image"::varchar(500);`,
		);
		await db.execute(
			sql`ALTER TABLE "barber_services" ADD CONSTRAINT "barber_services_barber_barbers_id_fkey" FOREIGN KEY ("barber") REFERENCES "barbers"("id") ON DELETE CASCADE;`,
		);
		await db.execute(
			sql`ALTER TABLE "barber_services" ADD CONSTRAINT "barber_services_service_services_id_fkey" FOREIGN KEY ("service") REFERENCES "services"("id") ON DELETE CASCADE;`,
		);
	},
	snapshot,
});
