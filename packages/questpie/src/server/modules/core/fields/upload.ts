/**
 * Upload Field Factory
 *
 * File upload field that references an assets/media collection.
 * Supports single uploads (belongsTo) and many-to-many via junction table.
 */

import { jsonb, type PgVarcharBuilder, varchar } from "drizzle-orm/pg-core";
import { z } from "zod";

import type { DefaultFieldState } from "../../../fields/field-class-types.js";
import { type Field, field } from "../../../fields/field-class.js";
import { fieldType, wrapFieldComplete } from "../../../fields/field-type.js";
import type { FieldWithMethods } from "../../../fields/field-with-methods.js";
import {
	belongsToOps,
	multipleOps,
	toManyOps,
} from "../../../fields/operators/builtin.js";
import type {
	ReferentialAction,
	RelationFieldMetadata,
} from "../../../fields/types.js";

declare global {
	namespace Questpie {
		interface UploadFieldMeta {}
	}
}

export interface UploadFieldMeta extends Questpie.UploadFieldMeta {
	_?: never;
}

// ============================================================================
// Types
// ============================================================================

export type UploadFieldState<TTo extends string = "assets"> = Omit<
	DefaultFieldState,
	"operators"
> & {
	type: "upload";
	data: string;
	column: PgVarcharBuilder<[string, ...string[]]>;
	operators: typeof belongsToOps;
	relationTo: TTo;
	relationKind: "one";
};

export interface UploadFieldMethods {
	multiple(): any;
}

interface UploadConfig {
	/** Target upload collection. @default "assets" */
	to?: string;
	/**
	 * MIME types this field's picker offers, e.g. `["image/*"]`.
	 *
	 * This narrows the admin file picker for one field. The hard limit that the
	 * server enforces on upload belongs to the target collection, as
	 * `.upload({ allowedTypes })`, and a field cannot widen past it.
	 */
	mimeTypes?: string[];
	/**
	 * Largest file in bytes this field's picker offers.
	 *
	 * Same boundary as `mimeTypes`. The server-enforced limit is the target
	 * collection's `.upload({ maxSize })`.
	 */
	maxSize?: number;
	/** Junction collection for M2M uploads. */
	through?: string;
	/** Source field on junction. */
	sourceField?: string;
	/** Target field on junction. */
	targetField?: string;
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create an upload field.
 *
 * @param config - Optional upload configuration
 *
 * @example
 * ```ts
 * // Single upload (belongsTo assets)
 * avatar: f.upload({ mimeTypes: ["image/*"] }).required()
 *
 * // M2M upload gallery
 * gallery: f.upload({ through: "post_assets" })
 *
 * // Custom media collection
 * document: f.upload({ to: "media", mimeTypes: ["application/pdf"] })
 * ```
 */
export function upload<TTo extends string = "assets">(
	config?: UploadConfig & { to?: TTo },
): FieldWithMethods<UploadFieldState<TTo>, UploadFieldMethods> {
	const {
		to = "assets" as TTo,
		through,
		mimeTypes,
		maxSize,
		sourceField,
		targetField,
	} = config ?? ({} as UploadConfig & { to?: TTo });

	const isM2M = !!through;

	return wrapFieldComplete(
		field<UploadFieldState<TTo>>({
			type: "upload",
			columnFactory: isM2M ? null : (name) => varchar(name, { length: 36 }),
			schemaFactory: () =>
				isM2M ? z.array(z.string().uuid()) : z.string().uuid(),
			operatorSet: isM2M ? toManyOps : belongsToOps,
			notNull: false,
			hasDefault: false,
			localized: false,
			virtual: isM2M,
			input: true,
			output: true,
			isArray: false,
			to,
			through,
			sourceField,
			targetField,
			mimeTypes,
			maxSize,
			metadataFactory: (state) =>
				({
					type: "relation",
					label: state.label,
					description: state.description,
					required: state.notNull ?? false,
					localized: state.localized ?? false,
					readOnly: state.input === false,
					writeOnly: state.output === false,
					targetCollection: (state.to as string) ?? "assets",
					relationType: state.through ? "manyToMany" : "belongsTo",
					through: state.through as string | undefined,
					sourceField: state.sourceField,
					targetField: state.targetField,
					isUpload: true,
					/* `mimeTypes` and `maxSize` used to be destructured and dropped
					   here, so every restriction written with them did nothing at
					   all. They reach the admin control as its `accept` and
					   `maxSize` props, which is what narrows the file picker. An
					   explicit `.set("admin", { ... })` still wins, because it is
					   the more specific instruction. */
					meta: {
						...(state.mimeTypes ? { accept: state.mimeTypes } : {}),
						...(state.maxSize ? { maxSize: state.maxSize } : {}),
						...state.extensions?.admin,
					},
				}) as RelationFieldMetadata,
		}),
		uploadFieldType.methods,
		{},
	) as any;
}

// ---- fieldType() definition (QUE-265) ----

export const uploadFieldType = fieldType("upload", {
	methods: {
		/**
		 * Switch this upload to an inline-array (multiple) relationship.
		 * Stores an array of asset IDs as JSONB instead of a single FK.
		 *
		 * This owns a column, so it is not virtual. Pass `through` to `upload()`
		 * for the junction-table form, which is the one with no column of its
		 * own. `relation().multiple()` and `relation().hasMany()` draw the same
		 * line, and this used to sit on the wrong side of it: it declared
		 * `virtual: true, columnFactory: null`, so the array had nowhere to go
		 * and `.localized()` silently did nothing, because `_inferLocation()`
		 * tests `virtual` before `localized`.
		 */
		multiple: (f: Field<any>) =>
			field({
				// `_state`, not `_`. `Field._` is `declare readonly _: TState` — a
				// type-only phantom with no runtime property — so spreading it
				// yields nothing and the returned field loses its type, metadata
				// and target collection. See relation.ts, which spreads `_state`.
				...f._state,
				multiple: true,
				columnFactory: (name: string) => jsonb(name),
				schemaFactory: () => z.array(z.string().uuid()),
				operatorSet: multipleOps,
			}),
	},
	create: (config?: UploadConfig) => {
		const {
			to = "assets",
			through,
			mimeTypes,
			maxSize,
			sourceField,
			targetField,
		} = config ?? ({} as UploadConfig);

		const isM2M = !!through;

		return {
			type: "upload",
			columnFactory: isM2M
				? (null as any)
				: (name: string) => varchar(name, { length: 36 }),
			schemaFactory: () =>
				isM2M ? z.array(z.string().uuid()) : z.string().uuid(),
			operatorSet: isM2M ? toManyOps : belongsToOps,
			notNull: false,
			hasDefault: false,
			localized: false,
			virtual: isM2M,
			input: true,
			output: true,
			isArray: false,
			to,
			through,
			sourceField,
			targetField,
			mimeTypes,
			maxSize,
			metadataFactory: (state: any) =>
				({
					type: "relation",
					label: state.label,
					description: state.description,
					required: state.notNull ?? false,
					localized: state.localized ?? false,
					readOnly: state.input === false,
					writeOnly: state.output === false,
					targetCollection: (state.to as string) ?? "assets",
					relationType: state.through ? "manyToMany" : "belongsTo",
					through: state.through as string | undefined,
					sourceField: state.sourceField,
					targetField: state.targetField,
					isUpload: true,
					// Same wiring as the factory above. Keep the two in step.
					meta: {
						...(state.mimeTypes ? { accept: state.mimeTypes } : {}),
						...(state.maxSize ? { maxSize: state.maxSize } : {}),
						...state.extensions?.admin,
					},
				}) as RelationFieldMetadata,
		};
	},
});
