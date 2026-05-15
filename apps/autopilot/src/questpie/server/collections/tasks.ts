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
				{ value: "pending", label: { en: "Pending" } },
				{ value: "running", label: { en: "Running" } },
				{ value: "waiting", label: { en: "Waiting" } },
				{ value: "review", label: { en: "Review" } },
				{ value: "approved", label: { en: "Approved" } },
				{ value: "done", label: { en: "Done" } },
				{ value: "failed", label: { en: "Failed" } },
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
		workflowConfig: f
			.relation("workflow_configs")
			.label({ en: "Automation Plan" }),
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
		label: { en: "Work" },
		icon: c.icon("ph:list-checks"),
	}))
	.list(({ v, f }) =>
		v.listView({
			columns: [f.title, f.status, f.priority, f.type, f.project, f.startAfter],
			searchable: [f.title, f.description],
			filterable: [f.status, f.priority, f.type, f.project],
			outline: {
				defaultExpanded: "roots",
				showCounts: true,
				levels: [
					{ kind: "field", field: f.status },
					{
						kind: "edge",
						collection: "task_relations",
						parentField: "sourceTask",
						childField: "targetTask",
						where: { relationType: "parent_of" },
						repeat: { maxDepth: 8 },
					},
				],
			},
			layout: {
				density: "compact",
				titleField: f.title,
				leadingFields: [f.priority],
				badgeFields: [f.type, f.status],
				metaFields: [f.project, f.startAfter],
			},
		}),
	)
	.form(({ v, f }) =>
		v.taskDetail({
			timeline: true,
			relatedTasks: true,
			artifacts: true,
			sidebar: {
				position: "right",
				fields: [f.status, f.priority, f.type],
			},
			fields: [
				{
					type: "section",
					label: { en: "Request" },
					fields: [f.title, f.description, f.project, f.scopeType],
				},
				{
					type: "section",
					label: { en: "How Autopilot Runs It" },
					fields: [f.workflowConfig, f.capability, f.model, f.startAfter],
				},
				{
					type: "section",
					label: { en: "Internal Details" },
					fields: [f.workflowStep, f.queue, f.scheduledBy, f.createdBy],
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
