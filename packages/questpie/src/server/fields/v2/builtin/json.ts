/**
 * JSON Field Factory (V2)
 */

import { json as pgJson, jsonb } from "drizzle-orm/pg-core";
import { z } from "zod";
import { basicOps } from "../../operators/builtin.js";
import { createField } from "../field.js";
import type { DefaultFieldState } from "../types.js";

export type JsonValue =
	| string
	| number
	| boolean
	| null
	| JsonValue[]
	| { [key: string]: JsonValue };

export type JsonFieldState = DefaultFieldState & {
	type: "json";
	data: JsonValue;
};

/**
 * Create a schema-less JSON field (stored as JSONB by default).
 *
 * For typed objects, prefer `f.object()`.
 *
 * @param config - Optional configuration
 *
 * @example
 * ```ts
 * metadata: f.json()
 * rawData: f.json({ mode: "json" })
 * ```
 */
export function json(config?: { mode?: "jsonb" | "json" }): Field<JsonFieldState> {
	const mode = config?.mode ?? "jsonb";

	return createField<JsonFieldState>({
		type: "json",
		columnFactory: (name) => (mode === "json" ? pgJson(name) : jsonb(name)),
		schemaFactory: () => z.any(),
		operatorSet: basicOps,
		notNull: false,
		hasDefault: false,
		localized: false,
		virtual: false,
		input: true,
		output: true,
		isArray: false,
	});
}

import type { Field } from "../field.js";
