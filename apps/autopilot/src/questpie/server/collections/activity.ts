import { index } from "drizzle-orm/pg-core";

import { collection } from "#questpie/factories";

export const activity = collection("activity")
	.fields(({ f }) => ({
		actor: f.text().label({ en: "Actor" }),
		type: f.text().required().label({ en: "Type" }),
		summary: f.text().label({ en: "Summary" }),
		task: f.relation("tasks").label({ en: "Task" }),
		run: f.relation("run_links").label({ en: "Run" }),
		project: f.relation("projects").label({ en: "Project" }),
		details: f.json().label({ en: "Details" }),
	}))
	.admin(({ c }) => ({
		label: { en: "Activity" },
		icon: c.icon("ph:clock-counter-clockwise"),
		hidden: true,
		audit: false,
	}))
	.list(({ v }) => v.collectionTable({}))
	.indexes(({ table }) => [
		index("activity_task_idx").on(table.task),
		index("activity_run_idx").on(table.run),
		index("activity_type_idx").on(table.type),
		index("activity_project_idx").on(table.project),
	]);
