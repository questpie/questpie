/**
 * URL Field Factory (V2)
 */

import { varchar } from "drizzle-orm/pg-core";
import { z } from "zod";
import { urlOps } from "../../operators/builtin.js";
import { createField } from "../field.js";
import type { DefaultFieldState } from "../types.js";

export type UrlFieldState = DefaultFieldState & {
	type: "url";
	data: string;
};

/**
 * Create a URL field with built-in URL validation.
 *
 * @param maxLength - Max character length (default: 2048)
 *
 * @example
 * ```ts
 * website: f.url().required()
 * link: f.url(500)
 * ```
 */
export function url(maxLength = 2048): Field<UrlFieldState> {
	return createField<UrlFieldState>({
		type: "url",
		columnFactory: (name) => varchar(name, { length: maxLength }),
		schemaFactory: () => z.string().url().max(maxLength),
		operatorSet: urlOps,
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
