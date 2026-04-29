import { sql } from "drizzle-orm";
import { migration } from "questpie";
import type { OperationSnapshot } from "questpie";

import snapshotJson from "./snapshots/20260307T135142_fancy_orange_tiger.json";

const snapshot = snapshotJson as OperationSnapshot;

export default migration({
	id: "fancyOrangeTiger20260307T135142",
	async up({ db }) {
		await db.execute(
			sql`ALTER TABLE "appointments" DROP COLUMN "displayTitle";`,
		);
		await db.execute(
			sql`ALTER TABLE "site_settings_i18n" ALTER COLUMN "navigation" SET DEFAULT '[{"label":"Home","href":"/"},{"label":"Services","href":"/services"},{"label":"Our Team","href":"/barbers"},{"label":"Blog","href":"/blog"},{"label":"Contact","href":"/contact"}]';`,
		);
		await db.execute(
			sql`ALTER TABLE "site_settings_i18n_versions" ALTER COLUMN "navigation" SET DEFAULT '[{"label":"Home","href":"/"},{"label":"Services","href":"/services"},{"label":"Our Team","href":"/barbers"},{"label":"Blog","href":"/blog"},{"label":"Contact","href":"/contact"}]';`,
		);
	},
	async down({ db }) {
		await db.execute(
			sql`ALTER TABLE "appointments" ADD COLUMN "displayTitle" varchar(255);`,
		);
		await db.execute(
			sql`ALTER TABLE "site_settings_i18n" ALTER COLUMN "navigation" SET DEFAULT '[{"label":"Home","href":"/"},{"label":"Services","href":"/services"},{"label":"Our Team","href":"/barbers"},{"label":"Contact","href":"/contact"}]';`,
		);
		await db.execute(
			sql`ALTER TABLE "site_settings_i18n_versions" ALTER COLUMN "navigation" SET DEFAULT '[{"label":"Home","href":"/"},{"label":"Services","href":"/services"},{"label":"Our Team","href":"/barbers"},{"label":"Contact","href":"/contact"}]';`,
		);
	},
	snapshot,
});
