/**
 * Email Field Factory (V2)
 */

import { varchar } from "drizzle-orm/pg-core";
import { z } from "zod";
import { emailOps } from "../../operators/builtin.js";
import { createField } from "../field.js";
import type { DefaultFieldState } from "../types.js";

export type EmailFieldState = DefaultFieldState & {
	type: "email";
	data: string;
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
	return createField<EmailFieldState>({
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

import type { Field } from "../field.js";
