import { index } from "drizzle-orm/pg-core";

import { collection } from "#questpie/factories";

export const tasks = collection("tasks")
	.fields(({ f }) => ({
		title: f.text().required().label({ en: "Title" }),
		description: f.richText({ mode: "markdown" }).label({ en: "Description" }),
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
				{
					value: "backlog",
					label: { en: "Backlog" },
					icon: {
						type: "icon",
						props: {
							name: "ph:circle-dashed",
							className: "text-muted-foreground",
						},
					},
				},
				{
					value: "pending",
					label: { en: "Pending" },
					icon: {
						type: "icon",
						props: { name: "ph:circle", className: "text-muted-foreground" },
					},
				},
				{
					value: "running",
					label: { en: "Running" },
					icon: {
						type: "icon",
						props: {
							name: "ph:circle-half-fill",
							className: "text-yellow-500",
						},
					},
				},
				{
					value: "waiting",
					label: { en: "Waiting" },
					icon: {
						type: "icon",
						props: { name: "ph:clock", className: "text-muted-foreground" },
					},
				},
				{
					value: "review",
					label: { en: "Review" },
					icon: {
						type: "icon",
						props: { name: "ph:check-circle", className: "text-green-500" },
					},
				},
				{
					value: "approved",
					label: { en: "Approved" },
					icon: {
						type: "icon",
						props: { name: "ph:thumbs-up", className: "text-green-500" },
					},
				},
				{
					value: "done",
					label: { en: "Done" },
					icon: {
						type: "icon",
						props: {
							name: "ph:check-circle-fill",
							className: "text-indigo-500",
						},
					},
				},
				{
					value: "failed",
					label: { en: "Failed" },
					icon: {
						type: "icon",
						props: { name: "ph:x-circle", className: "text-red-500" },
					},
				},
				{
					value: "cancelled",
					label: { en: "Cancelled" },
					icon: {
						type: "icon",
						props: {
							name: "ph:x-circle-fill",
							className: "text-muted-foreground",
						},
					},
				},
			])
			.default("backlog")
			.label({ en: "Status" }),
		priority: f
			.select([
				{
					value: "low",
					label: { en: "Low" },
					icon: {
						type: "icon",
						props: {
							name: "ph:cell-signal-low-fill",
							className: "text-muted-foreground",
						},
					},
				},
				{
					value: "medium",
					label: { en: "Medium" },
					icon: {
						type: "icon",
						props: {
							name: "ph:cell-signal-medium-fill",
							className: "text-muted-foreground",
						},
					},
				},
				{
					value: "high",
					label: { en: "High" },
					icon: {
						type: "icon",
						props: {
							name: "ph:cell-signal-full-fill",
							className: "text-muted-foreground",
						},
					},
				},
				{
					value: "urgent",
					label: { en: "Urgent" },
					icon: {
						type: "icon",
						props: {
							name: "ph:warning-fill",
							className: "text-red-500",
						},
					},
				},
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
			columns: [f.title, f.status, f.priority, f.project, "updatedAt"],
			searchable: [f.title, f.description],
			filterable: [f.status, f.priority, f.project],
			defaultSort: { field: "updatedAt", direction: "desc" },
			defaultFilters: [
				{
					id: "issues-active",
					field: f.status,
					operator: "not_in",
					value: ["done", "cancelled"],
				},
			],
			quickFilters: [
				{
					id: "active",
					label: { en: "Active" },
					icon: { type: "icon", props: { name: "ph:circle-dashed" } },
					filters: [
						{
							id: "issues-active",
							field: f.status,
							operator: "not_in",
							value: ["done", "cancelled"],
						},
					],
				},
				{
					id: "backlog",
					label: { en: "Backlog" },
					icon: { type: "icon", props: { name: "ph:circle-dashed" } },
					filters: [
						{
							id: "issues-backlog",
							field: f.status,
							operator: "equals",
							value: "backlog",
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
			],
			layout: {
				density: "compact",
				titleField: f.title,
				leadingFields: [f.priority, f.status],
				metaFields: [f.project, "updatedAt"],
			},
			outline: {
				defaultExpanded: "roots",
				levels: [
					{
						kind: "field",
						field: f.status,
						order: [
							"backlog",
							"pending",
							"running",
							"waiting",
							"review",
							"approved",
							"done",
							"failed",
							"cancelled",
						],
					},
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
		v.taskDetail({
			sidebar: {
				position: "right",
				fields: [f.status, f.priority, f.project, f.type, f.scopeType, f.model],
			},
			fields: [
				{
					type: "section",
					fields: [f.title, f.description],
				},
				{
					type: "section",
					label: { en: "Context" },
					wrapper: "collapsible",
					defaultCollapsed: true,
					fields: [f.context],
				},
				{
					type: "section",
					label: { en: "Automation" },
					wrapper: "collapsible",
					defaultCollapsed: true,
					fields: [f.startAfter],
				},
				{
					type: "section",
					label: { en: "Advanced" },
					wrapper: "collapsible",
					defaultCollapsed: true,
					fields: [f.queue, f.scheduledBy, f.createdBy, f.metadata],
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
