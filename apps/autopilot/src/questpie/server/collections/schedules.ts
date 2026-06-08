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
				{ value: "chat", label: { en: "Run chat prompt" } },
				{ value: "app", label: { en: "Run mini-app" } },
			])
			.label({ en: "Action" }),
		taskTemplate: f
			.object({
				title: f.text().label({ en: "Title" }),
				description: f.textarea().label({ en: "Description" }),
				type: f.text().label({ en: "Type" }),
				priority: f.text().label({ en: "Priority" }),
				projectId: f.text().label({ en: "Project ID" }),
				project_id: f.text().label({ en: "Project ID (legacy)" }),
				scopeType: f.text().label({ en: "Scope Type" }),
			})
			.label({ en: "Issue Template" }),
		chatPrompt: f.textarea().label({ en: "Chat Prompt" }),
		appId: f
			.text()
			.label({ en: "Mini-app ID" })
			.description({
				en: "Knowledge mini-app to run (the {appId} under company/apps/).",
			}),
		appFn: f
			.text()
			.label({ en: "Cron Export" })
			.description({
				en: "Name of the cron export to invoke. Optional when the app declares exactly one.",
			}),
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
			columns: [f.name, f.mode, f.enabled, f.nextRunAt, f.lastRunAt],
			searchable: [f.name, f.description, f.chatPrompt],
			filterable: [f.enabled, f.mode],
			defaultSort: { field: f.nextRunAt, direction: "asc" },
			quickFilters: [
				{
					id: "active",
					label: { en: "Active" },
					icon: { type: "icon", props: { name: "ph:check-circle" } },
					filters: [
						{
							id: "schedules-active",
							field: f.enabled,
							operator: "equals",
							value: true,
						},
					],
				},
				{
					id: "disabled",
					label: { en: "Disabled" },
					icon: { type: "icon", props: { name: "ph:prohibit" } },
					filters: [
						{
							id: "schedules-disabled",
							field: f.enabled,
							operator: "equals",
							value: false,
						},
					],
				},
				{
					id: "create-issue",
					label: { en: "Create Issue" },
					icon: { type: "icon", props: { name: "ph:ticket" } },
					filters: [
						{
							id: "schedules-task-mode",
							field: f.mode,
							operator: "equals",
							value: "task",
						},
					],
				},
				{
					id: "run-chat",
					label: { en: "Run Chat" },
					icon: { type: "icon", props: { name: "ph:chat-circle" } },
					filters: [
						{
							id: "schedules-chat-mode",
							field: f.mode,
							operator: "equals",
							value: "chat",
						},
					],
				},
				{
					id: "run-app",
					label: { en: "Run Mini-app" },
					icon: { type: "icon", props: { name: "ph:cube" } },
					filters: [
						{
							id: "schedules-app-mode",
							field: f.mode,
							operator: "equals",
							value: "app",
						},
					],
				},
			],
		}),
	)
	.form(({ v, f }) =>
		v.collectionForm({
			sidebar: {
				position: "right",
				fields: [f.enabled, f.mode],
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
									label: { en: "Schedule" },
									fields: [f.name, f.description],
								},
								{
									type: "section",
									label: { en: "Timing" },
									fields: [f.cron, f.timezone],
								},
							],
						},
						{
							id: "action",
							label: { en: "Action" },
							fields: [
								{
									type: "section",
									label: { en: "Issue Template" },
									fields: [f.taskTemplate],
								},
								{
									type: "section",
									label: { en: "Chat Prompt" },
									fields: [f.chatPrompt],
								},
								{
									type: "section",
									label: { en: "Mini-app" },
									fields: [f.appId, f.appFn],
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
