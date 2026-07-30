/**
 * A builder must not lose the app's field-type map when it is derived.
 *
 * `CollectionBuilder` carries two pieces of private state: `_indexesFn` and
 * `_fieldDefs`. The second is the runtime map of field factories — builtins,
 * plus module-contributed types like `richText` and `blocks`, plus the app's own
 * `fieldType()`s — and `.fields()` reads it to resolve `f.<type>()`.
 *
 * Every builder method is immutable: it constructs a new `CollectionBuilder`
 * from new state. `_indexesFn` was carried across all thirteen of those
 * construction sites; `_fieldDefs` was carried across none. It was assigned once
 * in `create()` and dropped by the first derivation.
 *
 * That matters because every extension method — `.admin()`, `.list()`,
 * `.form()`, `.actions()` — routes through `.set()`. So
 *
 *     collection("posts").admin({ … }).fields(({ f }) => f.richText())
 *
 * silently fell back to `builtinFields`, `f.richText` was undefined, and the
 * call threw — while the TYPE still advertised `richText`, because `~fieldTypes`
 * is a separate rail that survives derivation. Putting `.fields()` first worked.
 * Order-dependent divergence between what the type promises and what the runtime
 * has, which is the same shape as the shipped `Field<TState, {}>` truncation.
 *
 * These tests assert the invariant on the *derived* builder rather than on any
 * one method, so a future method that forgets to carry private state fails here
 * regardless of what it is called.
 */
import { describe, expect, it } from "bun:test";

import { CollectionBuilder } from "../../src/server/collection/builder/collection-builder.js";
import { GlobalBuilder } from "../../src/server/global/builder/global-builder.js";

/** Stands in for a module-contributed field type; only its presence matters. */
const APP_FIELDS = {
	appOnlyField: () => ({ __marker: "app-only" }),
} as any;

/** The keys `.fields()` actually sees on the builder it is called on. */
function fieldKeysSeenBy(builder: unknown): string[] {
	let keys: string[] = [];
	(builder as any).fields(({ f }: any) => {
		keys = Object.keys(f);
		return {};
	});
	return keys;
}

describe("CollectionBuilder carries private state across derivations", () => {
	it("sees the app field map on a freshly created builder", () => {
		const base = CollectionBuilder.create("bps_base", APP_FIELDS);
		expect(fieldKeysSeenBy(base)).toContain("appOnlyField");
	});

	it("keeps it across .set() — the path every extension method takes", () => {
		// `.admin()`, `.list()`, `.form()` and `.actions()` all resolve through
		// `builder.set(stateKey, config)`, so this one covers all of them.
		const derived = (
			CollectionBuilder.create("bps_set", APP_FIELDS) as any
		).set("admin", {});
		expect(fieldKeysSeenBy(derived)).toContain("appOnlyField");
	});

	it("keeps it across .options()", () => {
		const derived = (
			CollectionBuilder.create("bps_options", APP_FIELDS) as any
		).options({ softDelete: true });
		expect(fieldKeysSeenBy(derived)).toContain("appOnlyField");
	});

	it("keeps it across .merge()", () => {
		const other = CollectionBuilder.create("bps_other", APP_FIELDS);
		const derived = (
			CollectionBuilder.create("bps_merge", APP_FIELDS) as any
		).merge(other);
		expect(fieldKeysSeenBy(derived)).toContain("appOnlyField");
	});

	it("keeps it across a chain of derivations", () => {
		// The realistic authoring order: configure, then declare fields.
		const derived = (CollectionBuilder.create("bps_chain", APP_FIELDS) as any)
			.options({ timestamps: true })
			.set("admin", {})
			.set("adminList", {});
		expect(fieldKeysSeenBy(derived)).toContain("appOnlyField");
	});

	it("still carries _indexesFn, which was already correct", () => {
		// Guard against the fix trading one carried field for another.
		const fn = () => [];
		const derived = (CollectionBuilder.create("bps_idx", APP_FIELDS) as any)
			.indexes(fn)
			.set("admin", {});
		expect((derived as any)._indexesFn).toBe(fn);
	});
});

describe("GlobalBuilder carries private state across derivations", () => {
	// Globals had the same defect in a purer form: `_fieldDefs` is their ONLY
	// private state, assigned once and carried by none of the six derivations.
	it("sees the app field map on a freshly created builder", () => {
		const base = GlobalBuilder.create("bps_g_base", APP_FIELDS);
		expect(fieldKeysSeenBy(base)).toContain("appOnlyField");
	});

	it("keeps it across .set()", () => {
		const derived = (GlobalBuilder.create("bps_g_set", APP_FIELDS) as any).set(
			"admin",
			{},
		);
		expect(fieldKeysSeenBy(derived)).toContain("appOnlyField");
	});

	it("keeps it across a chain of derivations", () => {
		const derived = (GlobalBuilder.create("bps_g_chain", APP_FIELDS) as any)
			.set("admin", {})
			.set("adminForm", {});
		expect(fieldKeysSeenBy(derived)).toContain("appOnlyField");
	});
});
