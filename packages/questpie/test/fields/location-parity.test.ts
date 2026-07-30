/**
 * The runtime and type-level field-location classifiers are declared twins and
 * are not twins.
 *
 * `Field.getLocation()` (field-class.ts:561, via `_inferLocation`) and
 * `InferLocationFromFieldState` (fields/types.ts:519) answer the same question —
 * which table does this field live in — and field-extraction.ts:17 calls the
 * runtime one "Runtime version of ExtractFieldsByLocation type". They check in
 * different orders, so for two field shapes they disagree:
 *
 *   state                              type says     runtime says
 *   { localized: true, virtual: true }  "i18n"        "virtual"
 *   { virtual: true, type: "relation" } "relation"    "virtual"
 *
 * The type puts `localized` first; the runtime puts `virtual` first. And the
 * runtime never inspects `type: "relation"` at all — it reaches "relation" only
 * through `hasMany && !multiple` or a `through`, which the type never mentions.
 *
 * This file does NOT assert they agree, because they do not, and location drives
 * table generation — changing either one moves columns between the main and
 * i18n tables. It pins what each actually does, so the divergence is enforced
 * knowledge rather than a comment, and any change to either side has to come
 * here and say what it meant.
 *
 * This is the same class of defect as upload().multiple() losing its state: the
 * types said one thing, the runtime did another, and nothing compared them.
 */
import { describe, expect, it } from "bun:test";

import { field } from "../../src/server/fields/field-class.js";

const locationOf = (state: Record<string, unknown>) =>
	(field(state as never) as { getLocation(): string }).getLocation();

describe("runtime field-location classifier", () => {
	it("plain state is main", () => {
		expect(locationOf({ type: "text" })).toBe("main");
	});

	it("localized is i18n", () => {
		expect(locationOf({ type: "text", localized: true })).toBe("i18n");
	});

	it("virtual is virtual", () => {
		expect(locationOf({ type: "text", virtual: true })).toBe("virtual");
	});

	it("an SQL virtual (object, not true) is still virtual", () => {
		expect(locationOf({ type: "text", virtual: { sql: "1" } })).toBe("virtual");
	});

	it("hasMany without multiple is a relation", () => {
		expect(locationOf({ type: "relation", hasMany: true })).toBe("relation");
	});

	it("hasMany WITH multiple is not — multiple owns a column", () => {
		expect(
			locationOf({ type: "relation", hasMany: true, multiple: true }),
		).toBe("main");
	});

	it("a through table makes it a relation", () => {
		expect(locationOf({ type: "relation", through: "post_tags" })).toBe(
			"relation",
		);
	});
});

describe("where the two classifiers disagree", () => {
	/**
	 * Pinned, not endorsed. If either side is changed to agree with the other,
	 * these break and the change has to be deliberate — which is the point.
	 */
	it("localized + virtual: type says i18n, runtime says virtual", () => {
		expect(locationOf({ type: "text", localized: true, virtual: true })).toBe(
			"virtual",
		);
	});

	it("virtual + type:relation: type says relation, runtime says virtual", () => {
		expect(locationOf({ type: "relation", virtual: true })).toBe("virtual");
	});

	it("the runtime reaches relation only via hasMany or through, never via type", () => {
		// The type-level classifier's `{ virtual: true; type: "relation" }` branch
		// has no runtime counterpart at all.
		expect(locationOf({ type: "relation" })).toBe("main");
		expect(locationOf({ type: "relation", virtual: true })).not.toBe(
			"relation",
		);
	});
});
