/**
 * JSON Field Factory
 */

import {
	jsonb,
	type PgJsonbBuilder,
	json as pgJson,
} from "drizzle-orm/pg-core";
import { z } from "zod";
import { field } from "../field-class.js";
import type { DefaultFieldState } from "../field-class-types.js";
import { basicOps } from "../operators/builtin.js";

declare global {
	namespace Questpie {
		// biome-ignore lint/suspicious/noEmptyInterface: Augmentation point
		interface JsonFieldMeta {}
	}
}

export interface JsonFieldMeta extends Questpie.JsonFieldMeta {
	_?: never;
}

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
	column: PgJsonbBuilder;
	operators: typeof basicOps;
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
export function json(config?: {
	mode?: "jsonb" | "json";
}): Field<JsonFieldState> {
	const mode = config?.mode ?? "jsonb";

	return field<JsonFieldState>({
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

import type { Field } from "../field-class.js";
