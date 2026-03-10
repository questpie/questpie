/**
 * Email Field Factory
 */

import { type PgVarcharBuilder, varchar } from "drizzle-orm/pg-core";
import { z } from "zod";
import { field } from "../field-class.js";
import type { DefaultFieldState } from "../field-class-types.js";
import { emailOps } from "../operators/builtin.js";

declare global {
	namespace Questpie {
		// biome-ignore lint/suspicious/noEmptyInterface: Augmentation point
		interface EmailFieldMeta {}
	}
}

export interface EmailFieldMeta extends Questpie.EmailFieldMeta {
	_?: never;
}

export type EmailFieldState = DefaultFieldState & {
	type: "email";
	data: string;
	column: PgVarcharBuilder<[string, ...string[]]>;
	operators: typeof emailOps;
};

/**
 * Create an email field with built-in email validation.
 *
 * @param maxLength - Max character length (default: 255)
 *
 * @example
 * ```ts
 * email: f.email().required()
 * ```
 */
export function email(maxLength = 255): Field<EmailFieldState> {
	return field<EmailFieldState>({
		type: "email",
		columnFactory: (name) => varchar(name, { length: maxLength }),
		schemaFactory: () => z.string().email().max(maxLength),
		operatorSet: emailOps,
		notNull: false,
		hasDefault: false,
		localized: false,
		virtual: false,
		input: true,
		output: true,
		isArray: false,
		maxLength,
	});
}

import type { Field } from "../field-class.js";
