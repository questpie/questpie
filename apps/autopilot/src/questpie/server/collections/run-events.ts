import { index } from "drizzle-orm/pg-core";

import { collection } from "#questpie/factories";

export const runEvents = collection("run_events")
	.fields(({ f }) => ({
		run: f.relation("runs").required().label({ en: "Run" }),
		type: f.text().required().label({ en: "Type" }),
		level: f
			.select([
				{ value: "debug", label: { en: "Debug" } },
				{ value: "info", label: { en: "Info" } },
				{ value: "warn", label: { en: "Warn" } },
				{ value: "error", label: { en: "Error" } },
				{ value: "system", label: { en: "System" } },
			])
			.default("info")
			.label({ en: "Level" }),
		summary: f.text().label({ en: "Summary" }),
		sequence: f.number().label({ en: "Sequence" }),
		metadata: f.json().label({ en: "Metadata" }),
	}))
	.admin(({ c }) => ({
		label: { en: "Run Events" },
		icon: c.icon("ph:list-bullets"),
		hidden: true,
		audit: false,
	}))
	.indexes(({ table }) => [
		index("run_events_run_idx").on(table.run as any),
		index("run_events_run_sequence_idx").on(
			table.run as any,
			table.sequence as any,
		),
	]);
