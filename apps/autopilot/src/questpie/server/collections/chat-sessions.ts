import { index } from "drizzle-orm/pg-core";

import { collection } from "#questpie/factories";

export const chatSessions = collection("chat_sessions")
	.fields(({ f }) => ({
		title: f.text().label({ en: "Title" }),
		status: f
			.select([
				{ value: "active", label: { en: "Active" } },
				{ value: "closed", label: { en: "Closed" } },
				{ value: "archived", label: { en: "Archived" } },
			])
			.default("active")
			.label({ en: "Status" }),
		scopeType: f
			.select([
				{ value: "company", label: { en: "Company" } },
				{ value: "project", label: { en: "Project" } },
			])
			.default("company")
			.label({ en: "Scope Type" }),
		project: f.relation("projects").label({ en: "Project" }),
		task: f.relation("tasks").label({ en: "Task" }),
		runtimeSessionRef: f.text().label({ en: "Runtime Session Ref" }),
		metadata: f.json().label({ en: "Metadata" }),
	}))
	.title(({ f }) => f.title)
	.admin(({ c }) => ({
		label: { en: "Chat Sessions" },
		icon: c.icon("ph:chat-circle"),
		hidden: true,
		audit: false,
	}))
	.list(({ v }) => v.collectionTable({}))
	.indexes(({ table }) => [
		index("chat_sessions_status_idx").on(table.status as any),
		index("chat_sessions_project_idx").on(table.project as any),
	]);
