import { sql } from "drizzle-orm";
import type { OperationSnapshot } from "questpie/migration";
import { migration } from "questpie/services";

import snapshotJson from "./snapshots/20260712T195414_eager_red_tiger.json";

const snapshot = snapshotJson as OperationSnapshot;

export default migration({
	id: "eagerRedTiger20260712T195414",
	async up({ db }) {
		await db.execute(
			sql`ALTER TABLE "services" ADD COLUMN "color" varchar(9);`,
		);
	},
	async down({ db }) {
		await db.execute(sql`ALTER TABLE "services" DROP COLUMN "color";`);
	},
	snapshot,
});
