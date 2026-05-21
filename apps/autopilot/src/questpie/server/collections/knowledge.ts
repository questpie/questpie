import { index } from "drizzle-orm/pg-core";

import { collection } from "#questpie/factories";

export const knowledge = collection("knowledge")
	.upload({ visibility: "private" })
	.fields(({ f }) => ({
		title: f.text().label({ en: "Title" }),
		path: f.text().required().label({ en: "Path" }),
		scopeType: f
			.select([
				{ value: "company", label: { en: "Company" } },
				{ value: "project", label: { en: "Project" } },
				{ value: "task", label: { en: "Task" } },
			])
			.default("company")
			.label({ en: "Applies To" }),
		project: f.relation("projects").label({ en: "Project" }),
		task: f.relation("tasks").label({ en: "Task" }),
		run: f.relation("run_links").label({ en: "Run" }),
		kind: f
			.select([
				{ value: "document", label: { en: "Document" } },
				{ value: "upload", label: { en: "Upload" } },
				{ value: "artifact", label: { en: "Artifact" } },
				{ value: "result", label: { en: "Result" } },
				{ value: "summary", label: { en: "Summary" } },
				{ value: "preview", label: { en: "Preview" } },
				{ value: "log", label: { en: "Log" } },
				{ value: "diff", label: { en: "Diff" } },
			])
			.label({ en: "Kind" }),
		contentType: f.text().label({ en: "Content Type" }),
		body: f.textarea().label({ en: "Body" }),
		renderer: f.text().label({ en: "Renderer" }),
		source: f
			.select([
				{ value: "human", label: { en: "Human" } },
				{ value: "assistant", label: { en: "Assistant" } },
				{ value: "worker", label: { en: "Worker" } },
				{ value: "mcp", label: { en: "MCP" } },
				{ value: "import", label: { en: "Import" } },
				{ value: "system", label: { en: "System" } },
			])
			.label({ en: "Source" }),
		sourceRef: f.text().label({ en: "Source Reference" }),
		contentHash: f.text().label({ en: "Content Hash" }),
		metadata: f.json().label({ en: "Metadata" }),
	}))
	.title(({ f }) => f.title)
	.admin(({ c }) => ({
		label: { en: "Knowledge" },
		icon: c.icon("ph:brain"),
	}))
	.list(({ v, f }) =>
		v.filesView({
			pathField: f.path,
			nameField: f.title,
			contentField: f.body,
			contentTypeField: f.contentType,
			kindField: f.kind,
			searchable: [f.title, f.path, f.body],
			filterable: [f.scopeType, f.kind, f.project, f.source],
			defaultSort: { field: f.path, direction: "asc" },
			defaultLayout: "list",
			showPreview: true,
		}),
	)
	.form(({ v, f }) =>
		v.knowledgeDetail({
			preview: true,
			provenance: true,
			relatedResources: true,
			sidebar: {
				position: "right",
				fields: [f.scopeType, f.kind, f.source],
			},
			fields: [
				{
					type: "section",
					label: { en: "Resource" },
					fields: [f.title, f.path, f.contentType, f.renderer],
				},
				{
					type: "section",
					label: { en: "Content" },
					fields: [f.body],
				},
				{
					type: "section",
					label: { en: "Provenance" },
					fields: [f.project, f.task, f.run, f.sourceRef],
				},
			],
		}),
	)
	.indexes(({ table }) => [
		index("knowledge_scope_type_idx").on(table.scopeType as any),
		index("knowledge_project_idx").on(table.project as any),
		index("knowledge_task_idx").on(table.task as any),
		index("knowledge_run_idx").on(table.run as any),
		index("knowledge_kind_idx").on(table.kind as any),
		index("knowledge_content_hash_idx").on(table.contentHash as any),
	]);
