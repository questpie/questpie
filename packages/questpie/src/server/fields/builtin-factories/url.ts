/**
 * URL Field Factory
 */

import { type PgVarcharBuilder, varchar } from "drizzle-orm/pg-core";
import { z } from "zod";
import { field } from "../field-class.js";
import type { DefaultFieldState } from "../field-class-types.js";
import { urlOps } from "../operators/builtin.js";

declare global {
	namespace Questpie {
		// biome-ignore lint/suspicious/noEmptyInterface: Augmentation point
		interface UrlFieldMeta {}
	}
}

export interface UrlFieldMeta extends Questpie.UrlFieldMeta {
	_?: never;
}

export type UrlFieldState = DefaultFieldState & {
	type: "url";
	data: string;
	column: PgVarcharBuilder<[string, ...string[]]>;
	operators: typeof urlOps;
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
	return field<UrlFieldState>({
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

import type { Field } from "../field-class.js";
