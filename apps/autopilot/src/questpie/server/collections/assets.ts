import { index } from "drizzle-orm/pg-core";

import { collection } from "#questpie/factories";

/**
 * Unified `assets` collection — the Google-Drive-like company FILE STORE.
 *
 * v2 Decision 7 (`.private/miniapps-v2-design.md` ★ RESOLVED + `knowledge-miniapps-v2-plan.md`
 * §1/§8.7): the former `knowledge` collection collapses INTO `assets`. This ONE
 * `.upload()` collection now serves THREE roles, distinguished by `kind`/folder:
 *   1. generic upload-FIELD target — every `f.upload()` across collections writes
 *      an `assets` row (the field's target is resolved by the collection NAME
 *      `"assets"`); profile photos and other record uploads (storage-adapter blobs);
 *   2. the Drive document store — markdown/pdf docs + mini-app source bundles
 *      (TEXT `body` rows under `company/...`);
 *   3. the autopilot artifact/provenance store (run results/summaries/logs/diffs).
 *
 * **Why this is built standalone (NOT `collection.merge(adminModule.collections.assets)`).**
 * Decision 7 suggested merging the admin `assets` collection to inherit its upload
 * fields. In practice that merge is INCOMPATIBLE with this unified store: the merged
 * admin collection bakes the synthetic upload fields (`key`/`filename`/`mimeType`/
 * `size`) into the create-validation as REQUIRED, so a TEXT-body row written by
 * `knowledgeResource.createTextResource` (no blob → no `key`/`filename`) fails zod
 * validation. The former `knowledge` collection worked precisely because it was a
 * STANDALONE `.upload()` collection (upload applied first → server-managed fields
 * stay optional on a direct `.create()`). So we mirror that: a standalone `.upload()`
 * collection named `assets`, which still satisfies role (1) — the upload-FIELD
 * target is keyed by the collection NAME, not by the admin collection's identity —
 * and re-declares the admin display fields (`width`/`height`/`alt`/`caption`) inline.
 *
 * PER-FILE VISIBILITY (the unification's real design point): the former `knowledge`
 * was collection-level private; `assets` mixes PUBLIC field-uploads (profile photos
 * served anonymously) with PRIVATE docs/mini-app sources/artifacts (a private
 * mini-app source must NEVER be publicly served). We resolve this PER-ROW via the
 * `.upload()` `visibility` field:
 *   - the collection default is `.upload({ visibility: "private" })` — secure by
 *     default for the dominant content (docs, mini-app sources, artifacts);
 *   - an explicit `.access({ read })` rule (below) gates reads PER-ROW on
 *     `visibility`: an anonymous caller sees ONLY `visibility:"public"` rows (e.g.
 *     a profile photo explicitly published), an authenticated session sees the full
 *     library. This replaces the framework's implicit "public upload ⇒ public read";
 *   - a `beforeChange` hook stamps `visibility:"public"` on field-UPLOAD rows (rows
 *     that carry a blob `key` but no explicit visibility) so profile photos stay
 *     publicly servable, while text-`body` docs/artifacts/mini-app sources keep the
 *     private default. The storage blob-serving route already keys on the per-row
 *     `visibility`, so a private source blob is never served without a signed token.
 *   - the mini-app G1 own-subtree dispatch runs `accessMode:"system"`, which bypasses
 *     access entirely (`crud-generator` line ~3068) — preserved exactly, so an app
 *     still reads/writes its own clamped subtree regardless of `visibility`.
 *
 * The binding `questpie.knowledge.*` is renamed to `questpie.files.*` (guest API +
 * capability axis); the host file-as-DB service is `knowledgeResource` (unchanged
 * name) reading/writing THIS collection.
 */
export default collection("assets")
	.upload({ visibility: "private" })
	.fields(({ f }) => ({
		// Admin asset display fields (formerly contributed by the admin `assets`
		// collection) — kept inline so the photo-upload use case is unchanged.
		width: f.number().label({ en: "Width" }),
		height: f.number().label({ en: "Height" }),
		alt: f.text(500).label({ en: "Alt Text" }),
		caption: f.textarea().label({ en: "Caption" }),
		// Drive / document-store + provenance fields (formerly `knowledge`).
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
	.access({
		/**
		 * Per-file read visibility. Authenticated callers see the whole library;
		 * anonymous callers see ONLY `visibility:"public"` rows (e.g. a published
		 * profile photo). This replaces the implicit "public upload ⇒ public read"
		 * shortcut so a private doc / mini-app source / artifact is never anonymously
		 * readable. The mini-app own-subtree dispatch runs `accessMode:"system"` and
		 * so bypasses this rule entirely (the G1 clamp is the authorization there).
		 */
		read: ({ session }) => (session ? true : { visibility: "public" }),
	})
	.hooks({
		/**
		 * Stamp field-UPLOAD rows public; leave text/doc rows private. The
		 * collection default is `private`; a blob upload (a row carrying a storage
		 * `key`) that does not explicitly set `visibility` should be publicly
		 * servable (profile photos), while text-`body` docs/artifacts/mini-app
		 * sources (no `key`) keep the private default.
		 */
		beforeChange: ({ data, operation }) => {
			if (operation !== "create") return;
			const row = data as { key?: unknown; visibility?: unknown };
			if (
				(row.visibility === undefined || row.visibility === null) &&
				typeof row.key === "string" &&
				row.key.length > 0
			) {
				row.visibility = "public";
			}
		},
	})
	.title(({ f }) => f.title)
	.admin(({ c }) => ({
		label: { en: "Files" },
		icon: c.icon("ph:folders"),
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
		v.fileDetail({
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
		index("assets_path_idx").on(table.path as any),
		index("assets_scope_type_idx").on(table.scopeType as any),
		index("assets_project_idx").on(table.project as any),
		index("assets_task_idx").on(table.task as any),
		index("assets_run_idx").on(table.run as any),
		index("assets_kind_idx").on(table.kind as any),
		index("assets_content_hash_idx").on(table.contentHash as any),
	]);
