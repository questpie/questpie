/**
 * `f.rating()` — a 1–5 star rating field.
 *
 * App-land custom field type: this file lives in `server/fields/`, so codegen
 * discovers it (`fieldType()` factory) and wires it into the generated `f.*`
 * surface. The admin renders it with the matching client definition in
 * `../../admin/fields/rating.tsx` (same `"rating"` name = registry match).
 *
 * Stored exactly like a select (varchar) — swapping an existing 1–5 select
 * field for `f.rating()` needs no migration.
 */

import { fieldType, selectSingleOps } from "questpie/builders";
import { varchar } from "questpie/drizzle-pg-core";
import { z } from "zod";

export const RATING_VALUES = ["1", "2", "3", "4", "5"] as const;

export const ratingFieldType = fieldType("rating", {
	create: () => ({
		type: "rating",
		// length 50 matches the select field's column exactly — swapping a 1–5
		// select for f.rating() is a pure metadata change, no migration.
		columnFactory: (name: string) => varchar(name, { length: 50 }),
		schemaFactory: () => z.enum(RATING_VALUES),
		operatorSet: selectSingleOps,
		notNull: false,
		hasDefault: false,
		localized: false,
		virtual: false,
		input: true,
		output: true,
		isArray: false,
	}),
});
