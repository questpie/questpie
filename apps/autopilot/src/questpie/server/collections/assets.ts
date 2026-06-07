import { index } from "drizzle-orm/pg-core";

import { collection } from "#questpie/factories";

import { parseSkillFrontmatter } from "../lib/skill-frontmatter";

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
 * was collection-level private; `assets` mixes PRIVATE-by-default content (docs,
 * mini-app sources, artifacts, AND every Drive/folder upload) with the rare PUBLIC
 * field-upload that explicitly opts in. A private mini-app source or a confidential
 * file dragged into a folder must NEVER be publicly served. We resolve this PER-ROW
 * via the `.upload()` `visibility` field:
 *   - secure-by-default applies to BOTH write paths, via TWO complementary stamps:
 *     (a) BLOB uploads -- `.upload({ visibility: "private" })` makes the upload route
 *     stamp every uploaded row PRIVATE (an explicit `visibility:"public"` opt-in is
 *     the only way out); (b) TEXT-body rows -- the synthetic `visibility` column is
 *     `create.allowed:false`, so `knowledgeResource.createTextResource`/`writeByPath`
 *     cannot supply it and a bare `.create()` would otherwise fall through to the DB
 *     default `'public'`; the `beforeChange` hook (below) stamps `'private'` on create
 *     when unset, so a doc / mini-app source / skill / artifact also lands PRIVATE;
 *   - an explicit `.access({ read })` rule (below) gates reads PER-ROW on
 *     `visibility`: an anonymous caller sees ONLY `visibility:"public"` rows (e.g.
 *     a profile photo explicitly published), an authenticated session sees the full
 *     library. This replaces the framework's implicit "public upload ⇒ public read";
 *   - a field-upload that genuinely needs anonymous serving (a published profile
 *     photo) must opt in explicitly by passing `visibility:"public"` in the upload's
 *     additionalData — it is never implicitly public. The storage blob-serving route
 *     keys on the per-row `visibility`, so a private blob is never served without a
 *     signed token, and the admin detail view renders private blobs through the
 *     framework's signed `url` (the upload `afterRead` hook).
 *   - the mini-app G1 own-subtree dispatch runs `accessMode:"system"`, which bypasses
 *     access entirely (`crud-generator` line ~3068) — preserved exactly, so an app
 *     still reads/writes its own clamped subtree regardless of `visibility`.
 *
 * The binding `questpie.knowledge.*` is renamed to `questpie.files.*` (guest API +
 * capability axis); the host file-as-DB service is `knowledgeResource` (unchanged
 * name) reading/writing THIS collection.
 */
export default collection("assets")
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
				// A mini-app `.app` bundle file (server.ts/index.html/*.jsx). The
				// `renderer:"miniapp"` row mounts the KnowledgeHost iframe (M7).
				{ value: "miniapp", label: { en: "Mini-app" } },
				// An autopilot SKILL.md file (progressive-disclosure procedural
				// knowledge). `renderer:"markdown"`; the YAML frontmatter is parsed to
				// a `metadata.skill` mirror by the write-time validator hook below
				// (§8.2) so discovery never re-parses bodies.
				{ value: "skill", label: { en: "Skill" } },
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
	// `.upload()` MUST come AFTER `.fields()`: `.fields()` REPLACES the field map
	// (it does not merge), so the synthetic upload columns (`key`/`filename`/
	// `mimeType`/`size`/`visibility`) only survive when `.upload()` is the later
	// call. With the reverse order the upload columns are dropped from the table —
	// a blob upload stores its object but records no `key`, leaving the row
	// unservable AND the blob orphaned, and `visibility` never persists. Mirrors
	// the starter/admin `assets` collections, which both declare fields first.
	.upload({ visibility: "private" })
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
		 * Secure-by-default visibility stamp + write-time SKILL.md validator.
		 *
		 * BLOB uploads carry `visibility` in their create input already (the upload route
		 * stamps the collection's `private` default, or an explicit `'public'` opt-in for
		 * a published profile photo), so for them the stamp below is a no-op. TEXT-body
		 * rows go through a bare `.create()` that CANNOT carry `visibility` (the synthetic
		 * column is `create.allowed:false`) and would otherwise inherit the DB default
		 * `'public'`; the stamp closes that gap so they land PRIVATE too.
		 */
		beforeChange: ({ data, operation }) => {
			const row = data as {
				kind?: unknown;
				path?: unknown;
				body?: unknown;
				metadata?: unknown;
				visibility?: unknown;
			};

			// Secure-by-default visibility stamp. The synthetic `visibility` column is
			// `NOT NULL DEFAULT 'public'` AND `create.allowed:false`, so a normal
			// `.create()` (e.g. `knowledgeResource.createTextResource` / `writeByPath`)
			// neither does nor can supply it; without this stamp every TEXT-body row
			// (docs, mini-app sources, skills, artifacts, run summaries/results/logs/
			// diffs) would fall through to the DB default `'public'` and become
			// anonymously readable via the per-row `read` rule above. This hook runs
			// AFTER field-write-access validation (crud-generator: validate ->
			// beforeChange -> insert), so writing the `create.allowed:false` column here
			// is sound and overrides the DB default before insert. Gated to create so an
			// admin editing visibility on UPDATE is never clobbered, and skipped when
			// already set so the blob-upload route's explicit `'public'` opt-in (a
			// published profile photo) survives.
			if (operation === "create" && row.visibility == null) {
				row.visibility = "private";
			}

			// Write-time SKILL.md validator (§8.2): a `kind:"skill"` row (or any write
			// of a `.../SKILL.md` body) MUST carry valid YAML frontmatter. Parse it to a
			// MIRROR in `metadata.skill` so DISCOVERY never re-parses bodies, and ENFORCE
			// the Anthropic limits — a malformed/over-budget skill is rejected fail-closed
			// (`parseSkillFrontmatter` throws). Runs on create AND on a body-changing
			// update so the mirror always reflects the stored body.
			const isSkillKind = row.kind === "skill";
			const isSkillPath =
				typeof row.path === "string" && row.path.endsWith("/SKILL.md");
			const hasBody = typeof row.body === "string";
			if ((isSkillKind || isSkillPath) && hasBody) {
				const mirror = parseSkillFrontmatter(row.body as string);
				const prior =
					row.metadata && typeof row.metadata === "object"
						? (row.metadata as Record<string, unknown>)
						: {};
				row.metadata = { ...prior, skill: mirror };
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
