import { collection } from "#questpie/factories";
import { index, uniqueIndex } from "drizzle-orm/pg-core";

export const taskRelations = collection("task_relations")
	.fields(({ f }) => ({
		sourceTask: f.relation("tasks").required().label({ en: "Source Task" }),
		targetTask: f.relation("tasks").required().label({ en: "Target Task" }),
		relationType: f
			.select([
				{ value: "depends_on", label: { en: "Depends On" } },
				{ value: "parent_of", label: { en: "Parent Of" } },
				{ value: "related_to", label: { en: "Related To" } },
				{ value: "blocks", label: { en: "Blocks" } },
				{ value: "spawned_by", label: { en: "Spawned By" } },
			])
			.required()
			.label({ en: "Relation Type" }),
		dedupeKey: f.text().label({ en: "Dedupe Key" }),
		originRun: f.relation("runs").label({ en: "Origin Run" }),
		createdBy: f.text().label({ en: "Created By" }),
		metadata: f.json().label({ en: "Metadata" }),
	}))
	.title(({ f }) => f.dedupeKey)
	.indexes(({ table }) => [
		uniqueIndex("task_relations_unique").on(
			table.sourceTask as any,
			table.targetTask as any,
			table.relationType as any,
		),
		index("task_relations_source_task_idx").on(table.sourceTask as any),
		index("task_relations_target_task_idx").on(table.targetTask as any),
	]);
