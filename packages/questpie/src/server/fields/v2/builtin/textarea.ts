/**
 * Textarea Field Factory (V2)
 */

import { text as pgText } from "drizzle-orm/pg-core";
import { z } from "zod";
import { stringOps } from "../../operators/builtin.js";
import { createField } from "../field.js";
import type { DefaultFieldState } from "../types.js";

export type TextareaFieldState = DefaultFieldState & {
	type: "textarea";
	data: string;
};

/**
 * Create a textarea field (long text, stored as `text` in PostgreSQL).
 *
 * @example
 * ```ts
 * bio: f.textarea().label({ en: "Biography" })
 * ```
 */
export function textarea(): Field<TextareaFieldState> {
	return createField<TextareaFieldState>({
		type: "textarea",
		columnFactory: (name) => pgText(name),
		schemaFactory: () => z.string(),
		operatorSet: stringOps,
		notNull: false,
		hasDefault: false,
		localized: false,
		virtual: false,
		input: true,
		output: true,
		isArray: false,
	});
}

// Re-export Field to avoid missing import in return type
import type { Field } from "../field.js";
