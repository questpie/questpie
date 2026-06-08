import { index } from "drizzle-orm/pg-core";

import { collection } from "#questpie/factories";

/**
 * `agent_memory` — the autopilot self-learning store (memory slice 1).
 *
 * Design: `.private/miniapps-v2-design.md` §9 + research (d). The self-learning
 * loop: the agent OPERATES, OBSERVES the outcome, and WRITES a lesson it RECALLS
 * next time. This collection is the durable store for those lessons.
 *
 * WHY A DEDICATED COLLECTION (not `kind:"memory"` rows in `assets`, not
 * `document_store`):
 *   - `assets` is the Drive FILE store (files + SKILL.md). A memory is not a file:
 *     it has no `path`, it is vector-scored, it has a lifecycle (`active`→`stale`→
 *     `superseded`) and per-scope governance — a different shape and a different
 *     hot path (semantic recall, not path lookup). Overloading `assets` would muddy
 *     both the file UI and the recall query.
 *   - `document_store` is the mini-app jsonb store keyed by a `store` namespace +
 *     guest-write boundary (§7). Memory is host-authored (the reflection step), not
 *     guest-CRUD, and needs first-class structured columns (importance/status/scope)
 *     for the recall WHERE + re-rank — jsonb-in-a-namespace would lose that.
 *   So a purpose-built collection: structured, searchable (→ embedding via the
 *   pgvector adapter), with its own admin governance view.
 *
 * EMBEDDING: stored NOT as a column here but in the framework search index
 * (`questpie_search.embedding`) via `.searchable()` + the pgvector adapter (which
 * generates the embedding from title+content on `index()`) — ONE embedding home
 * (the task's "generate+store an embedding on memory write"). RECALL uses semantic
 * search ONLY for cosine candidates + then JOINS to the authoritative columns below
 * (status/scope/importance) — it does NOT trust the search index's metadata mirror,
 * because the async `index-records` job populates that differently from the sync
 * path (`lib/memory-recall.ts` file header explains the two-source join).
 *
 * Schema (research (d) rec 8 + CoALA): `{ type, scopeType+scopeRef, content,
 * importance, confidence, status, supersedes, sourceRun, source, contentHash,
 * lastAccessedAt, accessCount, metadata }`. The `embedding` vector lives in the
 * search index (above). `supersedes` is a self-relation for the audit chain
 * (write-side adjudication is slice 2 — the column exists now so the chain is
 * never lost, but nothing WRITES `superseded` yet).
 */
export default collection("agent_memory")
	.fields(({ f }) => ({
		/** CoALA memory type: what KIND of knowledge this is. */
		type: f
			.select([
				// what happened on a specific task/run (the Reflexion trace lesson)
				{ value: "episodic", label: { en: "Episodic" } },
				// durable fact / preference (e.g. "Twitter rate-limits bursts >5/min")
				{ value: "semantic", label: { en: "Semantic" } },
				// a how-to / procedure (a step recipe; skills are the richer form)
				{ value: "procedural", label: { en: "Procedural" } },
			])
			.required()
			.default("episodic")
			.label({ en: "Type" }),
		/** Which scope tier this memory applies to (the recall filter axis). */
		scopeType: f
			.select([
				{ value: "company", label: { en: "Company" } },
				{ value: "project", label: { en: "Project" } },
				{ value: "task", label: { en: "Task" } },
			])
			.required()
			.default("company")
			.label({ en: "Applies To" }),
		/**
		 * The scope's id when `scopeType` is project/task (the project/task id);
		 * NULL for company scope. A plain text ref (NOT a relation) so a memory
		 * survives the deletion of its originating task/project — the lesson is
		 * durable, the entity may be ephemeral. Recall filters on `scopeType` +
		 * `scopeRef` together.
		 */
		scopeRef: f.text().label({ en: "Scope Ref" }),
		/** The lesson text — the thing recalled + (separately) embedded. */
		content: f.textarea().required().label({ en: "Content" }),
		/**
		 * LLM-rated 1-10 at write time (Reflexion). The reflection step GATES writes
		 * by this (trivial runs write nothing) and recall scoring adds `importance/10`.
		 */
		importance: f.number().required().default(5).label({ en: "Importance" }),
		/** Optional 0-1 confidence the writing model assigned to the lesson. */
		confidence: f.number().label({ en: "Confidence" }),
		/**
		 * Lifecycle. ONLY `active` rows ever enter context (`lib/memory-recall.ts`);
		 * `stale`/`superseded` are retained for the audit trail but never recalled.
		 * Write-side adjudication that TRANSITIONS these is slice 2 — for now every
		 * written memory is `active`.
		 */
		status: f
			.select([
				{ value: "active", label: { en: "Active" } },
				{ value: "stale", label: { en: "Stale" } },
				{ value: "superseded", label: { en: "Superseded" } },
			])
			.required()
			.default("active")
			.label({ en: "Status" }),
		/** Self-relation: the older memory this one REPLACES (audit chain; slice 2). */
		supersedes: f.relation("agent_memory").label({ en: "Supersedes" }),
		/** Provenance: the run whose reflection authored this memory. */
		sourceRun: f.relation("run_links").label({ en: "Source Run" }),
		/** How the memory was authored (reflection = the async run-end step). */
		source: f
			.select([
				{ value: "reflection", label: { en: "Reflection" } },
				{ value: "human", label: { en: "Human" } },
				{ value: "import", label: { en: "Import" } },
			])
			.required()
			.default("reflection")
			.label({ en: "Source" }),
		/**
		 * Stable hash of the normalized `content` (+ scope). The DEDUPE key: the
		 * reflection step skips a candidate whose `contentHash` already exists in the
		 * same scope, so an identical lesson is never written twice.
		 */
		contentHash: f.text().label({ en: "Content Hash" }),
		/** Bumped by recall when a memory is actually injected into a run. */
		lastAccessedAt: f.datetime().label({ en: "Last Accessed At" }),
		/** Incremented alongside `lastAccessedAt` (recency·decay uses the former). */
		accessCount: f.number().default(0).label({ en: "Access Count" }),
		/** Free-form structured extras (e.g. the originating mini-app, tags). */
		metadata: f.json().label({ en: "Metadata" }),
	}))
	.access({
		/**
		 * Memory is host-authored + admin-governed; it is NEVER anonymously
		 * readable or writable. The reflection write step runs with the system
		 * context (it is an internal async job), and the admin governance view runs
		 * under an authenticated session. Written explicitly (not the framework's
		 * rule-less fallback) so the intent is auditable.
		 */
		read: ({ session }) => !!session,
		create: ({ session }) => !!session,
		update: ({ session }) => !!session,
		delete: ({ session }) => !!session,
	})
	.searchable({
		/**
		 * Embed the lesson text (the pgvector adapter generates the embedding from
		 * title+content → `questpie_search.embedding`). `content` = the lesson itself
		 * so the embedding captures the lesson, not an auto-generated field dump. No
		 * `metadata` mirror is declared: recall does NOT filter on the search index's
		 * metadata (it joins to the authoritative columns — see the file header), and
		 * the async `index-records` job would not carry a custom mirror anyway.
		 */
		content: (record) =>
			typeof record.content === "string" ? record.content : null,
	})
	.title(({ f }) => f.content)
	.admin(({ c }) => ({
		label: { en: "Memories" },
		icon: c.icon("ph:brain"),
	}))
	.list(({ v, f }) =>
		v.collectionTable({
			columns: [
				f.content,
				f.type,
				f.scopeType,
				f.importance,
				f.status,
				f.sourceRun,
			],
			searchable: [f.content],
			filterable: [f.type, f.scopeType, f.status, f.source],
			defaultSort: { field: f.importance, direction: "desc" },
		}),
	)
	.form(({ v, f }) =>
		v.collectionForm({
			fields: [
				{
					type: "section",
					label: { en: "Lesson" },
					fields: [f.content, f.type, f.importance, f.confidence],
				},
				{
					type: "section",
					label: { en: "Scope" },
					fields: [f.scopeType, f.scopeRef],
				},
				{
					type: "section",
					label: { en: "Lifecycle & Provenance" },
					fields: [f.status, f.supersedes, f.source, f.sourceRun, f.contentHash],
				},
				{
					type: "section",
					label: { en: "Access" },
					fields: [f.lastAccessedAt, f.accessCount],
				},
			],
		}),
	)
	.indexes(({ table }) => [
		// Recall scans `status:"active"` filtered to a scope — index that path.
		index("agent_memory_status_idx").on(table.status as any),
		index("agent_memory_scope_idx").on(
			table.scopeType as any,
			table.scopeRef as any,
		),
		index("agent_memory_type_idx").on(table.type as any),
		// Dedupe lookup on (scope, contentHash).
		index("agent_memory_content_hash_idx").on(table.contentHash as any),
		index("agent_memory_source_run_idx").on(table.sourceRun as any),
		index("agent_memory_supersedes_idx").on(table.supersedes as any),
	]);
