/**
 * Textarea Field Factory
 */

import { type PgTextBuilder, text as pgText } from "drizzle-orm/pg-core";
import { z } from "zod";
import { field } from "../field-class.js";
import type { DefaultFieldState } from "../field-class-types.js";
import { stringOps } from "../operators/builtin.js";

declare global {
	namespace Questpie {
		// biome-ignore lint/suspicious/noEmptyInterface: Augmentation point
		interface TextareaFieldMeta {}
	}
}

export interface TextareaFieldMeta extends Questpie.TextareaFieldMeta {
	_?: never;
}

export type TextareaFieldState = DefaultFieldState & {
	type: "textarea";
	data: string;
	column: PgTextBuilder;
	operators: typeof stringOps;
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
	return field<TextareaFieldState>({
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
import type { Field } from "../field-class.js";
