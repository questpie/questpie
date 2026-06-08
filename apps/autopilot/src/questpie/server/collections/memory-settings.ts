import { index, uniqueIndex } from "drizzle-orm/pg-core";

import { collection } from "#questpie/factories";

/**
 * `memory_settings` — per-scope governance for the self-learning loop (§9.7).
 *
 * The "agent may write memory" toggle, per scope. A row keys a (scopeType, scopeRef)
 * to an `agentMayWrite` flag; the reflection write step (`lib/memory-gate.ts`)
 * checks it BEFORE persisting any candidate. This is the human backstop for the
 * untrusted-write channel: an operator can disable agent-authored memory for a
 * sensitive project/task (or company-wide) without touching code.
 *
 * DEFAULT-ON, with an explicit-opt-out model: ABSENCE of a row means "allowed"
 * (the recall+reflect loop works out of the box). A row with `agentMayWrite:false`
 * DISABLES writes for that scope. The gate resolves most-specific-first
 * (task → project → company), so a company-wide disable can be overridden by a
 * project/task row, and vice-versa.
 *
 * Schema: `{ scopeType, scopeRef, agentMayWrite }`, `unique(scopeType, scopeRef)`.
 */
export default collection("memory_settings")
	.fields(({ f }) => ({
		/** Which tier this setting governs. */
		scopeType: f
			.select([
				{ value: "company", label: { en: "Company" } },
				{ value: "project", label: { en: "Project" } },
				{ value: "task", label: { en: "Task" } },
			])
			.required()
			.default("company")
			.label({ en: "Applies To" }),
		/** The project/task id for project/task scope; empty for company. */
		scopeRef: f.text().label({ en: "Scope Ref" }),
		/** Whether the reflection step may WRITE agent-authored memory in this scope. */
		agentMayWrite: f.boolean().default(true).label({ en: "Agent May Write Memory" }),
	}))
	.access({
		// Governance is admin-only; never anonymously readable or writable.
		read: ({ session }) => !!session,
		create: ({ session }) => !!session,
		update: ({ session }) => !!session,
		delete: ({ session }) => !!session,
	})
	.title(({ f }) => f.scopeType)
	.admin(({ c }) => ({
		label: { en: "Memory Settings" },
		icon: c.icon("ph:sliders"),
		hidden: true,
	}))
	.list(({ v, f }) =>
		v.collectionTable({
			columns: [f.scopeType, f.scopeRef, f.agentMayWrite],
			filterable: [f.scopeType, f.agentMayWrite],
		}),
	)
	.indexes(({ table }) => [
		uniqueIndex("memory_settings_scope_idx").on(
			table.scopeType as any,
			table.scopeRef as any,
		),
		index("memory_settings_scope_type_idx").on(table.scopeType as any),
	]);
