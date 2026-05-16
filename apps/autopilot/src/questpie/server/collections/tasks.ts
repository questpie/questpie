import { index } from "drizzle-orm/pg-core";

import { collection } from "#questpie/factories";

export const tasks = collection("tasks")
	.fields(({ f }) => ({
		title: f.text().required().label({ en: "Title" }),
		description: f.textarea().label({ en: "Description" }),
		type: f
			.select([
				{ value: "task", label: { en: "Task" } },
				{ value: "feature", label: { en: "Feature" } },
				{ value: "bug", label: { en: "Bug" } },
				{ value: "research", label: { en: "Research" } },
				{ value: "review", label: { en: "Review" } },
				{ value: "approval", label: { en: "Approval" } },
			])
			.label({ en: "Type" }),
		status: f
			.select([
				{ value: "backlog", label: { en: "Backlog" } },
				{ value: "pending", label: { en: "Todo" } },
				{ value: "running", label: { en: "In progress" } },
				{ value: "waiting", label: { en: "Waiting" } },
				{ value: "review", label: { en: "In review" } },
				{ value: "approved", label: { en: "Approved" } },
				{ value: "done", label: { en: "Done" } },
				{ value: "failed", label: { en: "Needs attention" } },
				{ value: "cancelled", label: { en: "Cancelled" } },
			])
			.default("backlog")
			.label({ en: "Status" }),
		priority: f
			.select([
				{ value: "low", label: { en: "Low" } },
				{ value: "medium", label: { en: "Medium" } },
				{ value: "high", label: { en: "High" } },
				{ value: "urgent", label: { en: "Urgent" } },
			])
			.default("medium")
			.label({ en: "Priority" }),
		project: f.relation("projects").label({ en: "Project" }),
		scopeType: f
			.select([
				{ value: "company", label: { en: "Company" } },
				{ value: "project", label: { en: "Project" } },
			])
			.default("company")
			.label({ en: "Applies To" }),
		workflowConfig: f.relation("workflow_configs").label({ en: "Workflow" }),
		workflowStep: f.text().label({ en: "Current Step" }),
		capability: f.relation("capabilities").label({ en: "Skill" }),
		model: f.relation("models").label({ en: "AI Model" }),
		queue: f.text().label({ en: "Work Queue" }),
		startAfter: f.datetime().label({ en: "Start After" }),
		scheduledBy: f.text().label({ en: "Scheduled By" }),
		createdBy: f.text().label({ en: "Created By" }),
		context: f.json().label({ en: "Context" }),
		metadata: f.json().label({ en: "Metadata" }),
	}))
	.title(({ f }) => f.title)
	.admin(({ c }) => ({
		label: { en: "Issues" },
		icon: c.icon("ph:list-checks"),
	}))
	.list(({ v, f }) =>
		v.listView({
			columns: [
				f.title,
				f.status,
				f.priority,
				f.project,
				f.workflowConfig,
				"updatedAt",
			],
			searchable: [f.title, f.description],
			filterable: [f.status, f.priority, f.project, f.workflowConfig],
			defaultSort: { field: "updatedAt", direction: "desc" },
			defaultFilters: [
				{
					id: "issues-open",
					field: f.status,
					operator: "not_in",
					value: ["done", "cancelled"],
				},
			],
			quickFilters: [
				{
					id: "open",
					label: { en: "Open" },
					icon: { type: "icon", props: { name: "ph:circle-dashed" } },
					filters: [
						{
							id: "issues-open",
							field: f.status,
							operator: "not_in",
							value: ["done", "cancelled"],
						},
					],
				},
				{
					id: "needs-review",
					label: { en: "Needs review" },
					icon: { type: "icon", props: { name: "ph:seal-check" } },
					filters: [
						{
							id: "issues-needs-review",
							field: f.status,
							operator: "equals",
							value: "review",
						},
					],
				},
				{
					id: "needs-attention",
					label: { en: "Needs attention" },
					icon: { type: "icon", props: { name: "ph:warning-circle" } },
					filters: [
						{
							id: "issues-needs-attention",
							field: f.status,
							operator: "equals",
							value: "failed",
						},
					],
				},
				{
					id: "done",
					label: { en: "Done" },
					icon: { type: "icon", props: { name: "ph:check-circle" } },
					filters: [
						{
							id: "issues-done",
							field: f.status,
							operator: "equals",
							value: "done",
						},
					],
				},
				{
					id: "scheduled",
					label: { en: "Scheduled" },
					icon: { type: "icon", props: { name: "ph:calendar-dots" } },
					filters: [
						{
							id: "issues-scheduled",
							field: f.startAfter,
							operator: "is_not_empty",
							value: null,
						},
					],
				},
			],
			layout: {
				density: "compact",
				titleField: f.title,
				leadingFields: [f.priority],
				badgeFields: [f.status],
				metaFields: [f.project, f.workflowConfig, "updatedAt"],
			},
			outline: {
				defaultExpanded: "roots",
				levels: [
					{
						kind: "edge",
						collection: "task_relations",
						parentField: "sourceTask",
						childField: "targetTask",
						where: { relationType: "parent_of" },
						repeat: true,
					},
				],
			},
		}),
	)
	.form(({ v, f }) =>
		v.collectionForm({
			sidebar: {
				position: "right",
				fields: [f.status, f.priority, f.project],
			},
			fields: [
				{
					type: "tabs",
					tabs: [
						{
							id: "issue",
							label: { en: "Issue" },
							fields: [
								{
									type: "section",
									fields: [f.title, f.description, f.priority],
								},
							],
						},
						{
							id: "context",
							label: { en: "Context" },
							fields: [
								{
									type: "section",
									fields: [f.project, f.scopeType, f.context],
								},
							],
						},
						{
							id: "automation",
							label: { en: "Automation" },
							fields: [
								{
									type: "section",
									fields: [
										f.workflowConfig,
										f.startAfter,
										f.capability,
										f.model,
									],
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
										f.type,
										f.workflowStep,
										f.queue,
										f.scheduledBy,
										f.createdBy,
										f.metadata,
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
		index("tasks_status_idx").on(table.status as any),
		index("tasks_project_idx").on(table.project as any),
		index("tasks_priority_idx").on(table.priority as any),
		index("tasks_start_after_idx").on(table.startAfter as any),
	]);
