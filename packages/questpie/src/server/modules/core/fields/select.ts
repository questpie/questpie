/**
 * Select Field Factory
 */

import { type PgVarcharBuilder, pgEnum, varchar } from "drizzle-orm/pg-core";
import { z } from "zod";

import type { ComponentReference } from "#questpie/shared/component-ref.js";
import type { I18nText } from "#questpie/shared/i18n/types.js";

import type { DefaultFieldState } from "../../../fields/field-class-types.js";
import { field, Field } from "../../../fields/field-class.js";
import { fieldType, wrapFieldComplete } from "../../../fields/field-type.js";
import type { FieldWithMethods } from "../../../fields/field-with-methods.js";
import { selectSingleOps } from "../../../fields/operators/builtin.js";
import type { ScalarWhereInput } from "../../../fields/operators/builtin.js";
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

/** Infer stored select value union from static option literals. */
export type SelectValuesFromOptions<T extends readonly SelectOption[]> =
	T[number] extends { value: infer V }
		? V extends string
			? V
			: V extends number
				? `${V}`
				: string
		: string;

export type SelectFieldState<TValue extends string = string> = Omit<
	DefaultFieldState,
	"operators"
> & {
	type: "select";
	data: TValue;
	column: PgVarcharBuilder<[string, ...string[]]>;
	operators: typeof selectSingleOps;
	// WHERE-input value tracks the literal union (eq/ne = TValue, in/notIn =
	// TValue[]) — decoupled from the runtime `selectSingleOps` singleton, whose
	// hardcoded `string` value types only drive SQL (CL-07).
	whereInput: ScalarWhereInput<TValue>;
};

export interface SelectFieldMethods {
	enum(enumName: string): any;
}

/**
 * Option definition for select field.
 *
 * Visual metadata (`icon`, `description`, `className`) is serialized to the
 * admin client via introspection so the admin UI renders consistently
 * without per-project cell overrides.
 *
 * @example
 * ```ts
 * f.select([
 *   {
 *     value: "ready",
 *     label: "Ready",
 *     description: "Runtime is healthy",
 *     icon: c.icon("ph:check-circle"),
 *     className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700",
 *   },
 * ])
 * ```
 */
export interface SelectOption {
	value: string | number;
	label: I18nText;
	description?: I18nText;
	disabled?: boolean;
	/** Icon shown next to the option in dropdowns and cells. */
	icon?: ComponentReference;
	/**
	 * Tailwind/utility classes applied to the option's visual chrome
	 * (badge in cells, row in dropdowns). Use for tonal styling.
	 */
	className?: string;
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
 * Serialize a select option for introspection metadata.
 * Drops `undefined` keys so the client receives only set fields.
 */
function serializeOption(option: SelectOption): SelectOption {
	const out: SelectOption = { value: option.value, label: option.label };
	if (option.description !== undefined) out.description = option.description;
	if (option.disabled !== undefined) out.disabled = option.disabled;
	if (option.icon !== undefined) out.icon = option.icon;
	if (option.className !== undefined) out.className = option.className;
	return out;
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
export function select<const T extends readonly SelectOption[]>(
	options: T,
): FieldWithMethods<
	SelectFieldState<SelectValuesFromOptions<T>>,
	SelectFieldMethods
>;
export function select(
	options: readonly SelectOption[] | OptionsConfig,
): FieldWithMethods<SelectFieldState, SelectFieldMethods>;
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
		field<SelectFieldState<string>>({
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
					options: hasDynamic ? [] : staticOptions.map(serializeOption),
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
					options: hasDynamic ? [] : staticOptions.map(serializeOption),
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
