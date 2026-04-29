import { sql } from "drizzle-orm";
import { migration } from "questpie";
import type { OperationSnapshot } from "questpie";

import snapshotJson from "./snapshots/20260424T221327_bold_yellow_phoenix.json";

const snapshot = snapshotJson as OperationSnapshot;

export default migration({
	id: "boldYellowPhoenix20260424T221327",
	async up({ db }) {
		await db.execute(
			sql`ALTER TABLE "services" ADD COLUMN "order" integer DEFAULT 0 NOT NULL;`,
		);
		await db.execute(sql`
			UPDATE "services"
			SET "order" = ranked.row_order * 10
			FROM (
				SELECT "id", row_number() OVER (ORDER BY "price" ASC, "id" ASC) AS row_order
				FROM "services"
			) ranked
			WHERE "services"."id" = ranked."id";
		`);
	},
	async down({ db }) {
		await db.execute(sql`ALTER TABLE "services" DROP COLUMN "order";`);
	},
	snapshot,
});
