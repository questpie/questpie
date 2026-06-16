/* oxlint-disable */
// FIXTURE leaf layer — mirrors the EXISTING `factories.ts` proof-of-pattern
// ("Separate file to avoid circular refs"). It augments `Questpie.CollectionKeys`/
// `GlobalKeys`/`JobKeys` with the USER literal names and `FieldTypesMap extends
// BuiltinFields`, and references NEITHER `typeof _modules` NOR `AppContext` NOR
// `app` — the acyclicity is a property of this file's import graph (it cannot
// reach the composition layer). MODULE names are contributed separately by
// index.ts's distributive-keyof (Invariant-3 two-file split). Imported by the
// fixture's type-test so the leaf participates in the gate.
import type { BuiltinFields } from "#questpie/server/fields/builder.js";

// ── Entity key registry (names only — acyclic by construction) ─────
// USER-literal half — one interface per keyed-entity category the app
// discovered on disk (collections/globals/services here). FILE-derived keys
// (static strings, no import) keep this leaf acyclic. MODULE entity names are
// contributed separately by names.gen.ts's distributive-keyof.
declare global {
	namespace Questpie {
		interface CollectionKeys {
			articles: unknown;
			categories: unknown;
		}
		interface GlobalKeys {
			siteSettings: unknown;
		}
		interface ServiceKeys {
			reporting: unknown;
		}
	}
}

// ── Field types (core leaf baseline) ───────────────────────────────
declare global {
	namespace Questpie {
		interface FieldTypesMap extends BuiltinFields {}
	}
}

export {};
