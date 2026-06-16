/**
 * Relation-string validation tripwire (CL-06 / REL-STR-01..06) — REAL surface.
 *
 * The package-level cluster test (questpie/test/types/clusters/CL-06-…) proves
 * the `StrictCollectionKey` MECHANISM over a fake registry, because the questpie
 * package's own build keeps `Questpie.CollectionKeys` EMPTY (→ `string`
 * fallback). THIS file proves the mechanism on the REAL generated surface of a
 * concrete app: codegen populated `Questpie.CollectionKeys` for toy-factory with
 *   - USER collection names (factories.ts: inventoryMovements, machines, toys, …)
 *   - MODULE collection names (index.ts distributive `keyof`: user, assets, …)
 * so `relation()` / `manyToMany({ through })` here are genuinely STRICT: a valid
 * target compiles, a typo is a COMPILE error.
 *
 * If module-name contribution regresses (REL-STR-03), the `relation("user")`
 * line below turns red. If strictness regresses (the `(string & {})` arm leaks
 * back into the relation surface), the `@ts-expect-error` typo lines go unused
 * (TS2578) and this file fails. Both directions are guarded.
 */
import { collection } from "#questpie/factories";

type Expect<T extends true> = T;
type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
		? true
		: false;

// ── Valid targets compile, and the literal target is preserved ──────────────

const validRelations = collection("audit_probe").fields(({ f }) => ({
	// USER collection name (emitted by factories.ts from file discovery).
	machine: f.relation("machines").required(),
	// MODULE collection name (emitted by index.ts via distributive `keyof` over
	// the module tuple) — proves cross-module REL-STR-03: relation("user") is a
	// VALID strict key for an app that pulls the admin/starter modules.
	createdBy: f.relation("user"),
	// manyToMany junction via a real USER collection name (REL-STR-04).
	materials: f
		.relation("materials")
		.manyToMany({ through: "toyMaterials", sourceField: "a", targetField: "b" }),
}));

type ProbeFields = (typeof validRelations)["state"]["fieldDefinitions"];
// Literal target inference survives the strict constraint (positive companions).
type _machineLiteral = Expect<
	Equal<ProbeFields["machine"]["_"]["relationTo"], "machines">
>;
type _userLiteral = Expect<
	Equal<ProbeFields["createdBy"]["_"]["relationTo"], "user">
>;

// ── Typos are REJECTED by the strict constraint (the whole point of CL-06) ───

collection("typo_probe").fields(({ f }) => ({
	// @ts-expect-error — "machinez_typo" is not a known collection key.
	bad: f.relation("machinez_typo"),
}));

collection("typo_probe_through").fields(({ f }) => ({
	// The relation itself is valid; only the junction name is a typo, so the
	// `@ts-expect-error` sits directly on the `.manyToMany({ through })` line
	// where the strict rejection lands (a multi-line chain would misplace it).
	bad: f.relation("materials").manyToMany({
		// @ts-expect-error — junction "toyMaterialz_typo" is not a known collection key.
		through: "toyMaterialz_typo",
	}),
}));
