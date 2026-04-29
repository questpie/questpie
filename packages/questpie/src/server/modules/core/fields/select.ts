/**
 * Select Field Factory
 */

import { type PgVarcharBuilder, pgEnum, varchar } from "drizzle-orm/pg-core";
import { z } from "zod";

import type { I18nText } from "#questpie/shared/i18n/types.js";

import type { DefaultFieldState } from "../../../fields/field-class-types.js";
import { field, Field } from "../../../fields/field-class.js";
import { fieldType, wrapFieldComplete } from "../../../fields/field-type.js";
import type { FieldWithMethods } from "../../../fields/field-with-methods.js";
import {
	selectMultiOps,
	selectSingleOps,
} from "../../../fields/operators/builtin.js";
import type { OptionsConfig } from "../../../fields/reactive.js";
import type { SelectFieldMetadata } from "../../../fields/types.js";

declare global {
	namespace Questpie {
		interface SelectFieldMeta {}
	}
}

export interface SelectFieldMeta extends Questpie.SelectFieldMeta {
	_?: never;
}

export type SelectFieldState = DefaultFieldState & {
	type: "select";
	data: string;
	column: PgVarcharBuilder<[string, ...string[]]>;
	operators: typeof selectSingleOps;
};

export interface SelectFieldMethods {
	enum(enumName: string): any;
}

/**
 * Option definition for select field.
 */
export interface SelectOption {
	value: string | number;
	label: I18nText;
	description?: I18nText;
	disabled?: boolean;
}

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
): FieldWithMethods<SelectFieldState, SelectFieldMethods> {
	const staticOpts = getStaticOptions(options);

	// Compute varchar length from options
	const maxLength =
		staticOpts.length > 0
			? Math.max(...staticOpts.map((o) => String(o.value).length), 50)
			: 255;

	return wrapFieldComplete(
		field<SelectFieldState>({
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
					meta: state.extensions?.admin,
				} as SelectFieldMetadata;
			},
		}),
		selectFieldType.methods,
		{},
	) as any;
}

// ---- fieldType() definition (QUE-265) ----

export const selectFieldType = fieldType("select", {
	create: (options: readonly SelectOption[] | OptionsConfig) => {
		const staticOpts = getStaticOptions(options);

		const maxLength =
			staticOpts.length > 0
				? Math.max(...staticOpts.map((o) => String(o.value).length), 50)
				: 255;

		return {
			type: "select",
			columnFactory: (name: string) => varchar(name, { length: maxLength }),
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
			metadataFactory: (state: any) => {
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
					meta: state.extensions?.admin,
				} as SelectFieldMetadata;
			},
		};
	},
	methods: {
		enum: (f: Field<any>, enumName: string) => {
			const state = f._state;
			const staticOpts = getStaticOptions(
				(state.options ?? []) as readonly SelectOption[] | OptionsConfig,
			);

			if (staticOpts.length === 0) {
				return f.derive({ enumType: true, enumName } as any);
			}

			const enumValues = staticOpts.map((o) => String(o.value)) as [
				string,
				...string[],
			];

			// Create fresh pgEnum per .enum() call — no module-level cache
			const enumDef = pgEnum(enumName, enumValues);

			return new Field({
				...state,
				enumType: true,
				enumName,
				// enumDef is captured in columnFactory closure — not stored in FieldRuntimeState
				columnFactory: (name: string) => (enumDef as any)(name),
			});
		},
	},
});
