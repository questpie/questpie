import { index } from "drizzle-orm/pg-core";

import { collection } from "#questpie/factories";

export const schedules = collection("schedules")
	.fields(({ f }) => ({
		name: f.text().label({ en: "Name" }).required(),
		description: f.textarea().label({ en: "Description" }),
		cron: f
			.text()
			.label({ en: "Run Schedule" })
			.description({
				en: "Cron expression, for example 0 9 * * 1 for Monday 9:00.",
			})
			.required(),
		timezone: f.text().label({ en: "Timezone" }).default("UTC"),
		mode: f
			.select([
				{ value: "task", label: { en: "Create issue" } },
				{ value: "chat", label: { en: "Run workflow directly" } },
			])
			.label({ en: "Action" }),
		workflowConfig: f.relation("workflow_configs").label({ en: "Workflow" }),
		taskTemplate: f.json().label({ en: "Issue Template" }),
		chatPrompt: f.textarea().label({ en: "Chat Prompt" }),
		concurrencyPolicy: f
			.select([
				{ value: "allow", label: { en: "Allow Overlap" } },
				{ value: "skip", label: { en: "Skip If Running" } },
				{ value: "replace", label: { en: "Replace Current Run" } },
			])
			.label({ en: "When Already Running" })
			.default("allow"),
		enabled: f.boolean().label({ en: "Enabled" }).default(true),
		lastRunAt: f.datetime().label({ en: "Last Run At" }),
		nextRunAt: f.datetime().label({ en: "Next Run At" }),
		createdBy: f.text().label({ en: "Created By" }),
	}))
	.title(({ f }) => f.name)
	.admin(({ c }) => ({
		label: { en: "Schedules" },
		icon: c.icon("ph:calendar-check"),
	}))
	.list(({ v, f }) =>
		v.collectionTable({
			columns: [
				f.name,
				f.description,
				f.enabled,
				f.mode,
				f.workflowConfig,
				f.nextRunAt,
				f.lastRunAt,
			],
			searchable: [f.name, f.description, f.chatPrompt],
			filterable: [f.enabled, f.mode, f.workflowConfig],
			defaultSort: { field: f.nextRunAt, direction: "asc" },
		}),
	)
	.form(({ v, f }) =>
		v.collectionForm({
			sidebar: {
				position: "right",
				fields: [f.enabled, f.mode, f.concurrencyPolicy],
			},
			fields: [
				{
					type: "tabs",
					tabs: [
						{
							id: "schedule",
							label: { en: "Schedule" },
							fields: [
								{
									type: "section",
									fields: [f.name, f.description, f.cron, f.timezone],
								},
							],
						},
						{
							id: "action",
							label: { en: "Action" },
							fields: [
								{
									type: "section",
									fields: [f.mode, f.workflowConfig],
								},
							],
						},
						{
							id: "template",
							label: { en: "Template" },
							fields: [
								{
									type: "section",
									fields: [f.taskTemplate, f.chatPrompt],
								},
							],
						},
						{
							id: "advanced",
							label: { en: "Advanced" },
							fields: [
								{
									type: "section",
									fields: [
										f.concurrencyPolicy,
										f.lastRunAt,
										f.nextRunAt,
										f.createdBy,
									],
								},
							],
						},
					],
				},
			],
		}),
	)
	.indexes(({ table }) => [
		index("schedules_enabled_next_run_idx").on(
			table.enabled as any,
			table.nextRunAt as any,
		),
		index("schedules_mode_idx").on(table.mode as any),
	]);
