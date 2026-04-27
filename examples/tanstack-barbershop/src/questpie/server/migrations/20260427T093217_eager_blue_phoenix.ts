import { sql } from "drizzle-orm";
import { migration } from "questpie";
import type { OperationSnapshot } from "questpie";

import snapshotJson from "./snapshots/20260427T093217_eager_blue_phoenix.json";

const snapshot = snapshotJson as OperationSnapshot;

export default migration({
	id: "eagerBluePhoenix20260427T093217",
	async up({ db }) {
		await db.execute(sql`ALTER TABLE "user" ADD COLUMN "avatar" varchar(36);`);
	},
	async down({ db }) {
		await db.execute(sql`ALTER TABLE "user" DROP COLUMN "avatar";`);
	},
	snapshot,
});
