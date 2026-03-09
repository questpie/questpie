/**
 * Select Field Factory (V2)
 */

import { jsonb, pgEnum, varchar } from "drizzle-orm/pg-core";
import { z } from "zod";
import type { I18nText } from "#questpie/shared/i18n/types.js";
import { selectMultiOps, selectSingleOps } from "../operators/builtin.js";
import { createField, Field } from "../field-class.js";
import type { OptionsConfig } from "../reactive.js";
import type { DefaultFieldState } from "../field-class-types.js";
import type { SelectFieldMetadata } from "../types.js";

export type SelectFieldState = DefaultFieldState & {
	type: "select";
	data: string;
};

/**
 * Option definition for select field.
 */
export interface SelectOption {
	value: string | number;
	label: I18nText;
	description?: I18nText;
	disabled?: boolean;
}

// Cache for dynamically created enum types
const enumCache = new Map<string, any>();

function isStaticOptions(
	options: readonly SelectOption[] | OptionsConfig,
): options is readonly SelectOption[] {
	return Array.isArray(options);
}

function getStaticOptions(
	options: readonly SelectOption[] | OptionsConfig,
): readonly SelectOption[] {
	return isStaticOptions(options) ? options : [];
}

/**
 * Create a select field.
 *
 * @param options - Static options array or dynamic OptionsConfig
 *
 * @example
 * ```ts
 * status: f.select([
 *   { value: "draft", label: { en: "Draft" } },
 *   { value: "published", label: { en: "Published" } },
 * ]).required()
 *
 * // Multi-select via .array()
 * tags: f.select([...]).array()
 *
 * // With enum type
 * priority: f.select([...]).enum("priority_enum")
 * ```
 */
export function select(
	options: readonly SelectOption[] | OptionsConfig,
): Field<SelectFieldState> {
	const staticOpts = getStaticOptions(options);

	// Compute varchar length from options
	const maxLength =
		staticOpts.length > 0
			? Math.max(...staticOpts.map((o) => String(o.value).length), 50)
			: 255;

	return createField<SelectFieldState>({
		type: "select",
		columnFactory: (name) => varchar(name, { length: maxLength }),
		schemaFactory: () => {
			if (!isStaticOptions(options)) {
				return z.string();
			}
			const values = staticOpts.map((o) => String(o.value));
			if (values.length > 0) {
				return z.enum(values as [string, ...string[]]);
			}
			return z.string();
		},
		operatorSet: selectSingleOps,
		notNull: false,
		hasDefault: false,
		localized: false,
		virtual: false,
		input: true,
		output: true,
		isArray: false,
		options,
		metadataFactory: (state) => {
			const opts = state.options as readonly SelectOption[] | OptionsConfig;
			const staticOptions = getStaticOptions(opts);
			const hasDynamic = !isStaticOptions(opts);

			return {
				type: "select",
				label: state.label,
				description: state.description,
				required: state.notNull ?? false,
				localized: state.localized ?? false,
				readOnly: state.input === false,
				writeOnly: state.output === false,
				options: hasDynamic
					? []
					: staticOptions.map((o) => ({ value: o.value, label: o.label })),
				multiple: state.isArray || state.multiple,
				meta: state.admin,
			} as SelectFieldMetadata;
		},
	});
}

/**
 * Add select-specific chain methods to Field.
 */
declare module "../field-class.js" {
	interface Field<TState> {
		/** Use PostgreSQL enum type for storage. */
		enum(enumName: string): Field<TState>;
	}
}

Field.prototype.enum = function (enumName: string) {
	const state = this._state;
	const staticOpts = getStaticOptions(
		(state.options ?? []) as readonly SelectOption[] | OptionsConfig,
	);

	if (staticOpts.length === 0) {
		// Can't use enum with dynamic options
		return new Field({ ...state, enumType: true, enumName });
	}

	const enumValues = staticOpts.map((o) => String(o.value)) as [string, ...string[]];

	// Create or get cached enum
	let enumDef = enumCache.get(enumName);
	if (!enumDef) {
		enumDef = pgEnum(enumName, enumValues);
		enumCache.set(enumName, enumDef);
	}

	return new Field({
		...state,
		enumType: true,
		enumName,
		columnFactory: (name: string) => (enumDef as any)(name),
	});
};
