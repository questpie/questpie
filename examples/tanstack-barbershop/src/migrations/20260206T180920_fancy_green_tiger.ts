import type { Migration, OperationSnapshot } from "questpie";
import { sql } from "drizzle-orm";
import snapshotJson from "./snapshots/20260206T180920_fancy_green_tiger.json";

const snapshot = snapshotJson as OperationSnapshot;

export const fancyGreenTiger20260206T180920: Migration = {
  id: "fancyGreenTiger20260206T180920",
  async up({ db }) {
    await db.execute(
      sql`ALTER TABLE "session" ADD COLUMN "created_at" timestamp DEFAULT now() NOT NULL;`,
    );
    await db.execute(
      sql`ALTER TABLE "session" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;`,
    );
    await db.execute(
      sql`ALTER TABLE "account" ADD COLUMN "created_at" timestamp DEFAULT now() NOT NULL;`,
    );
    await db.execute(
      sql`ALTER TABLE "account" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;`,
    );
    await db.execute(
      sql`ALTER TABLE "verification" ADD COLUMN "created_at" timestamp DEFAULT now() NOT NULL;`,
    );
    await db.execute(
      sql`ALTER TABLE "verification" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;`,
    );
  },
  async down({ db }) {
    await db.execute(sql`ALTER TABLE "session" DROP COLUMN "created_at";`);
    await db.execute(sql`ALTER TABLE "session" DROP COLUMN "updated_at";`);
    await db.execute(sql`ALTER TABLE "account" DROP COLUMN "created_at";`);
    await db.execute(sql`ALTER TABLE "account" DROP COLUMN "updated_at";`);
    await db.execute(sql`ALTER TABLE "verification" DROP COLUMN "created_at";`);
    await db.execute(sql`ALTER TABLE "verification" DROP COLUMN "updated_at";`);
  },
  snapshot,
};
