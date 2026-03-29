/**
 * Upload Field Factory
 *
 * File upload field that references an assets/media collection.
 * Supports single uploads (belongsTo) and many-to-many via junction table.
 */

import { type PgVarcharBuilder, varchar } from "drizzle-orm/pg-core";
import { z } from "zod";

import type { KnownCollectionNames } from "../../../config/app-context.js";
import type { DefaultFieldState } from "../../../fields/field-class-types.js";
import { field } from "../../../fields/field-class.js";
import { fieldType, wrapFieldComplete } from "../../../fields/field-type.js";
import { belongsToOps, multipleOps, toManyOps } from "../../../fields/operators/builtin.js";
import type { ReferentialAction, RelationFieldMetadata } from "../../../fields/types.js";

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

export type UploadFieldState<TTo extends string = "assets"> =
	DefaultFieldState & {
		type: "upload";
		data: string;
		column: PgVarcharBuilder<[string, ...string[]]>;
		operators: typeof belongsToOps;
		relationTo: TTo;
		relationKind: "one";
	};

interface UploadConfig {
	/** Target upload collection. @default "assets" */
	to?: KnownCollectionNames;
	/** Allowed MIME types. */
	mimeTypes?: string[];
	/** Max file size in bytes. */
	maxSize?: number;
	/** Junction collection for M2M uploads. */
	through?: KnownCollectionNames;
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
): Field<UploadFieldState<TTo>> {
	const {
		to = "assets" as TTo,
		through,
		mimeTypes,
		maxSize,
		sourceField,
		targetField,
	} = config ?? ({} as UploadConfig & { to?: TTo });

	const isM2M = !!through;

	return wrapFieldComplete(field<UploadFieldState<TTo>>({
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
				meta: state.extensions?.admin,
			}) as RelationFieldMetadata,
	}), uploadFieldType.methods, {}) as any;
}

import type { Field } from "../../../fields/field-class.js";

// ---- fieldType() definition (QUE-265) ----

export const uploadFieldType = fieldType("upload", {
	methods: {
		/**
		 * Switch this upload to an inline-array (multiple) relationship.
		 * Stores an array of asset IDs as JSONB instead of a single FK.
		 */
		multiple: (f: Field<any>) =>
			field({
				...f._,
				multiple: true,
				virtual: true,
				columnFactory: null as any,
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
					meta: state.extensions?.admin,
				}) as RelationFieldMetadata,
		};
	},
});
