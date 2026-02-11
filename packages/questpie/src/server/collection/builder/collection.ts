// builder/collection.ts

import type {
	Column,
	GetColumnData,
	InferInsertModel,
	InferSelectModel,
	SQL,
} from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import {
	bigint,
	bigserial,
	char,
	index,
	integer,
	jsonb,
	pgTable,
	serial,
	smallint,
	smallserial,
	text,
	timestamp,
	uniqueIndex,
	uuid,
	varchar,
} from "drizzle-orm/pg-core";
import type {
	CollectionBuilderIndexesFn,
	CollectionBuilderState,
	I18nFieldAccessor,
	InferI18nTableWithColumns,
	InferI18nVersionedTableWithColumns,
	InferMainTableWithColumns,
	InferSQLType,
	InferTableWithColumns,
	InferVersionedTableWithColumns,
	LocalizedTableName,
	RelationConfig,
	RelationType,
	TitleExpression,
} from "#questpie/server/collection/builder/types.js";
import { createCollectionValidationSchemas } from "#questpie/server/collection/builder/validation-helpers.js";
import { CRUDGenerator } from "#questpie/server/collection/crud/index.js";
import type { CRUD } from "#questpie/server/collection/crud/types.js";
import type { FieldSelect } from "#questpie/server/fields/field-types.js";
import { DEFAULT_LOCALE } from "#questpie/shared/constants.js";
import type { Prettify } from "#questpie/shared/type-utils.js";

// Re-export for convenience
export type { CollectionBuilder } from "./collection-builder.js";

// ============================================================================
// Legacy Helper Types (for fields/localized arrays)
// ============================================================================

/**
 * Extract non-localized fields from the fields record
 */
type NonLocalizedFields<
	TFields extends Record<string, any>,
	TLocalized extends ReadonlyArray<keyof TFields>,
> = {
	[K in keyof TFields as K extends TLocalized[number] ? never : K]: TFields[K];
};

/**
 * Extract localized fields from the fields record
 */
type LocalizedFields<
	TFields extends Record<string, any>,
	TLocalized extends ReadonlyArray<keyof TFields>,
> = {
	[K in keyof TFields as K extends TLocalized[number] ? K : never]: TFields[K];
};

// ============================================================================
// TState-based Type Inference (using fieldDefinitions)
// ============================================================================

import type {
	ExtractI18nFields,
	ExtractMainFields,
	ExtractVirtualFields,
	FieldDefinition,
	FieldDefinitionState,
} from "#questpie/server/fields/types.js";

/**
 * Extract input types from field definitions.
 * Maps each field to its input type from $types.input.
 */
type ExtractInputTypes<
	TFieldDefs extends Record<string, FieldDefinition<FieldDefinitionState>>,
> = {
	[K in keyof TFieldDefs]: TFieldDefs[K] extends FieldDefinition<infer TState>
		? TState extends FieldDefinitionState
			? TState["input"]
			: never
		: never;
};

type FieldInput<T> =
	T extends FieldDefinition<infer TState>
		? TState extends FieldDefinitionState
			? TState["input"]
			: never
		: never;

type RequiredInputKeys<
	TFieldDefs extends Record<string, FieldDefinition<FieldDefinitionState>>,
> = {
	[K in keyof TFieldDefs]: FieldInput<TFieldDefs[K]> extends never
		? never
		: undefined extends FieldInput<TFieldDefs[K]>
			? never
			: K;
}[keyof TFieldDefs];

type OptionalInputKeys<
	TFieldDefs extends Record<string, FieldDefinition<FieldDefinitionState>>,
> = {
	[K in keyof TFieldDefs]: FieldInput<TFieldDefs[K]> extends never
		? never
		: undefined extends FieldInput<TFieldDefs[K]>
			? K
			: never;
}[keyof TFieldDefs];

/**
 * Extract input object type from field definitions, using optional properties
 * when the field input type includes `undefined`.
 */
type ExtractInputObject<
	TFieldDefs extends Record<string, FieldDefinition<FieldDefinitionState>>,
> = Prettify<
	{
		[K in RequiredInputKeys<TFieldDefs>]: FieldInput<TFieldDefs[K]>;
	} & {
		[K in OptionalInputKeys<TFieldDefs>]?: Exclude<
			FieldInput<TFieldDefs[K]>,
			undefined
		>;
	}
>;

/**
 * Extract output types from field definitions.
 * Maps each field to its output type from $types.output.
 * For object/array/upload/relation fields, dispatches through FieldSelect to resolve nested/narrowed types.
 * Relation fields especially need FieldSelect because their TValue is a broad union (string | string[] | { type, id } | null)
 * but FieldSelect narrows based on actual config (belongsTo -> string, multiple -> string[], etc.)
 */
type ExtractOutputTypes<
	TFieldDefs extends Record<string, FieldDefinition<FieldDefinitionState>>,
> = {
	[K in keyof TFieldDefs]: TFieldDefs[K] extends FieldDefinition<infer TState>
		? TState extends FieldDefinitionState
			? TState["type"] extends "object" | "array" | "upload" | "relation"
				? FieldSelect<TFieldDefs[K]>
				: TState["output"]
			: never
		: never;
};

/**
 * Infer select type from Collection using TState-based fieldDefinitions.
 * Combines: Drizzle main table select + virtual fields output types + _title + i18n fields output types
 */
type InferCollectionSelect<
	TMainTable extends PgTable,
	TFieldDefs extends Record<string, FieldDefinition<FieldDefinitionState>>,
	TTitle extends TitleExpression | undefined,
> = Prettify<
	InferSelectModel<TMainTable> &
		ExtractOutputTypes<ExtractMainFields<TFieldDefs>> &
		ExtractOutputTypes<ExtractVirtualFields<TFieldDefs>> &
		ExtractOutputTypes<ExtractI18nFields<TFieldDefs>> & {
			_title: string;
		} & (TTitle extends string ? {} : Record<never, never>)
>;

/**
 * Infer insert type from Collection using TState-based fieldDefinitions.
 * Uses Drizzle's $inferInsert for main fields + input types for i18n fields.
 */
type InferCollectionInsert<
	TMainTable extends PgTable,
	TFieldDefs extends Record<string, FieldDefinition<FieldDefinitionState>>,
> = Prettify<
	Omit<InferInsertModel<TMainTable>, keyof ExtractMainFields<TFieldDefs>> &
		ExtractInputObject<ExtractMainFields<TFieldDefs>> &
		Partial<ExtractInputObject<ExtractI18nFields<TFieldDefs>>>
>;

/**
 * Infer update type from Collection using TState-based fieldDefinitions.
 * Partial of insert type.
 */
type InferCollectionUpdate<
	TMainTable extends PgTable,
	TFieldDefs extends Record<string, FieldDefinition<FieldDefinitionState>>,
> = Prettify<Partial<InferCollectionInsert<TMainTable, TFieldDefs>>>;

/**
 * Legacy select type for raw Drizzle columns (fieldDefinitions is undefined).
 */
type InferLegacySelect<
	TTable extends PgTable,
	TFields extends Record<string, any>,
	TLocalized extends ReadonlyArray<keyof TFields>,
	TVirtuals extends Record<string, SQL> | undefined,
	TTitle extends TitleExpression | undefined,
> = InferSelectModel<TTable> &
	(TVirtuals extends Record<string, SQL>
		? { [K in keyof TVirtuals]: InferSQLType<TVirtuals[K]> }
		: {}) & {
		[K in TLocalized[number]]?: GetColumnData<TFields[K]>;
	} & {
		_title: string;
	} & (TTitle extends string ? {} : Record<never, never>);

/**
 * Legacy insert type for raw Drizzle columns (fieldDefinitions is undefined).
 */
type InferLegacyInsert<
	TTable extends PgTable,
	TFields extends Record<string, any>,
	TLocalized extends ReadonlyArray<keyof TFields>,
> = InferInsertModel<TTable> & {
	[K in TLocalized[number]]?: GetColumnData<TFields[K]>;
};

/**
 * Legacy update type for raw Drizzle columns (fieldDefinitions is undefined).
 */
type InferLegacyUpdate<
	TTable extends PgTable,
	TFields extends Record<string, any>,
	TLocalized extends ReadonlyArray<keyof TFields>,
> = Partial<InferInsertModel<TTable>> & {
	[K in TLocalized[number]]?: GetColumnData<TFields[K]>;
};

/**
 * CollectionSelect - works with both field builder and raw Drizzle columns.
 */
/** Extract output type extensions (for example, .upload() adds url) from state */
type OutputExtensions<TState extends CollectionBuilderState> =
	TState["output"] extends Record<string, any> ? TState["output"] : {};

export type CollectionSelect<TState extends CollectionBuilderState> =
	TState["fieldDefinitions"] extends Record<
		string,
		FieldDefinition<FieldDefinitionState>
	>
		? Prettify<
				InferCollectionSelect<
					InferMainTableWithColumns<
						TState["name"],
						TState["fieldDefinitions"],
						TState["options"],
						TState["upload"]
					>,
					TState["fieldDefinitions"],
					TState["title"]
				> &
					OutputExtensions<TState>
			>
		: InferLegacySelect<
				InferTableWithColumns<
					TState["name"],
					NonLocalizedFields<TState["fields"], TState["localized"]>,
					TState["title"],
					TState["options"]
				>,
				TState["fields"],
				TState["localized"],
				TState["virtuals"],
				TState["title"]
			>;

/**
 * CollectionInsert - works with both field builder and raw Drizzle columns.
 */
export type CollectionInsert<TState extends CollectionBuilderState> =
	TState["fieldDefinitions"] extends Record<
		string,
		FieldDefinition<FieldDefinitionState>
	>
		? InferCollectionInsert<
				InferMainTableWithColumns<
					TState["name"],
					TState["fieldDefinitions"],
					TState["options"],
					TState["upload"]
				>,
				TState["fieldDefinitions"]
			>
		: InferLegacyInsert<
				InferTableWithColumns<
					TState["name"],
					NonLocalizedFields<TState["fields"], TState["localized"]>,
					TState["title"],
					TState["options"]
				>,
				TState["fields"],
				TState["localized"]
			>;

/**
 * CollectionUpdate - works with both field builder and raw Drizzle columns.
 */
export type CollectionUpdate<TState extends CollectionBuilderState> =
	TState["fieldDefinitions"] extends Record<
		string,
		FieldDefinition<FieldDefinitionState>
	>
		? InferCollectionUpdate<
				InferMainTableWithColumns<
					TState["name"],
					TState["fieldDefinitions"],
					TState["options"],
					TState["upload"]
				>,
				TState["fieldDefinitions"]
			>
		: InferLegacyUpdate<
				InferTableWithColumns<
					TState["name"],
					NonLocalizedFields<TState["fields"], TState["localized"]>,
					TState["title"],
					TState["options"]
				>,
				TState["fields"],
				TState["localized"]
			>;

/**
 * Default ID column factory - creates a text column with gen_random_uuid() default
 */
const defaultIdColumn = () =>
	text("id").primaryKey().default(sql`gen_random_uuid()`);

/**
 * Helper to get column config from a Drizzle column
 */
function getColumnConfig(column: PgColumn): any {
	return (column as any).config || {};
}

/**
 * Creates a column of the same type as the source column but with a different name.
 * Used for creating foreign key columns that match the parent table's ID type.
 *
 * @param sourceColumn - The source column to clone the type from
 * @param newName - The name for the new column
 * @returns A new column with the same type but different name
 */
function cloneColumnType(sourceColumn: PgColumn, newName: string) {
	const config = getColumnConfig(sourceColumn);
	const columnType = config.columnType || sourceColumn.constructor.name;

	switch (columnType) {
		case "PgUUID":
			return uuid(newName);
		case "PgText":
			return text(newName);
		case "PgVarchar":
			return varchar(newName, { length: config.length });
		case "PgChar":
			return char(newName, { length: config.length });
		case "PgInteger":
			return integer(newName);
		case "PgSerial":
			// Serial becomes integer for FK (serial is just auto-increment integer)
			return integer(newName);
		case "PgSmallInt":
			return smallint(newName);
		case "PgSmallSerial":
			return smallint(newName);
		case "PgBigInt53":
		case "PgBigInt64":
			return bigint(newName, { mode: config.mode || "number" });
		case "PgBigSerial53":
		case "PgBigSerial64":
			return bigint(newName, { mode: config.mode || "number" });
		default:
			// Fallback to text if unknown type
			return text(newName);
	}
}

/**
 * Check if a column is a JSONB type
 * JSONB fields marked as localized don't get their own column in the i18n table.
 * Instead, their localized values (from $i18n wrappers) go to the _localized column.
 *
 * @param column - The column to check
 * @returns True if the column is a JSONB type
 */
function isJsonbColumn(column: any): boolean {
	const config = getColumnConfig(column);
	const columnType = config.columnType || column?.constructor?.name;
	return columnType === "PgJsonb" || columnType === "PgJson";
}

/**
 * Localization mode for fields
 * - 'whole': Entire value (or JSONB object) is stored per locale in i18n table
 * - 'nested': JSONB contains { $i18n: value } wrappers, values extracted to _localized column
 */
type LocalizationMode = "whole" | "nested";

/**
 * Parse a localized field name to extract field name and mode.
 * Supports syntax: "fieldName" (default whole) or "fieldName:nested"
 *
 * @param localizedField - Field name or field name with :nested suffix
 * @returns Object with field name and localization mode
 */
function parseLocalizedField(localizedField: string): {
	name: string;
	mode: LocalizationMode;
} {
	if (localizedField.endsWith(":nested")) {
		return {
			name: localizedField.slice(0, -7), // Remove ":nested"
			mode: "nested",
		};
	}
	return {
		name: localizedField,
		mode: "whole",
	};
}

/**
 * Get localization mode for a specific field name.
 * Searches the localized array for the field name with optional :nested suffix.
 *
 * @param localizedArray - Array of localized field names (possibly with :nested suffix)
 * @param fieldName - The field name to look up
 * @returns Localization mode ('whole' or 'nested') if field is localized, null otherwise
 */
function getLocalizedFieldMode(
	localizedArray: readonly string[],
	fieldName: string,
): LocalizationMode | null {
	for (const localizedField of localizedArray) {
		const parsed = parseLocalizedField(localizedField);
		if (parsed.name === fieldName) {
			return parsed.mode;
		}
	}
	return null;
}

/**
 * Final Collection class - the result of build()
 * Contains the generated tables, types, and CRUD operations
 * Uses single generic state pattern for better type performance
 */
export class Collection<TState extends CollectionBuilderState> {
	/**
	 * @deprecated Use defaultIdColumn() instead. This is kept for backwards compatibility.
	 */
	static readonly pkCols = () => ({
		id: defaultIdColumn(),
	});

	static readonly timestampsCols = () => ({
		createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
	});

	static readonly softDeleteCols = () => ({
		deletedAt: timestamp("deleted_at", { mode: "date" }),
	});

	/**
	 * Creates version table columns with ID type matching the parent table
	 * @param parentIdColumn - The ID column from the parent table to match type
	 */
	static readonly versionCols = (parentIdColumn?: PgColumn) => ({
		// primary key of a version table - always uses default ID type
		versionId: text("version_id")
			.primaryKey()
			.default(sql<string>`gen_random_uuid()`),
		// reference to the main record - matches parent ID type
		id: parentIdColumn
			? cloneColumnType(parentIdColumn, "id").notNull()
			: text("id").notNull(),
		versionNumber: integer("version_number").notNull(),
		versionOperation: text("version_operation").notNull(), // 'create' | 'update' | 'delete'
		versionUserId: text("version_user_id"), // Nullable if unknown
		versionCreatedAt: timestamp("version_created_at", { mode: "date" })
			.defaultNow()
			.notNull(),
	});

	/**
	 * Creates i18n version table columns with ID type matching the parent table
	 * @param parentIdColumn - The ID column from the parent table to match type
	 */
	static readonly i18nVersionCols = (parentIdColumn?: PgColumn) => ({
		id: text("id").primaryKey().default(sql`gen_random_uuid()`),
		parentId: parentIdColumn
			? cloneColumnType(parentIdColumn, "parent_id").notNull()
			: text("parent_id").notNull(),
		versionNumber: integer("version_number").notNull(),
		locale: text("locale").notNull(),
	});

	/**
	 * Creates i18n table columns with ID type matching the parent table
	 * @param parentIdColumn - The ID column from the parent table to match type
	 */
	static readonly i18nCols = (parentIdColumn?: PgColumn) => ({
		id: text("id").primaryKey().default(sql`gen_random_uuid()`),
		parentId: parentIdColumn
			? cloneColumnType(parentIdColumn, "parent_id").notNull()
			: text("parent_id").notNull(),
		locale: text("locale").notNull(),
		// Nested localized values from $i18n wrappers in any field
		_localized: jsonb("_localized"),
	});

	static readonly uploadCols = () => ({
		key: varchar("key", { length: 255 }).notNull(),
		filename: varchar("filename", { length: 255 }).notNull(),
		mimeType: varchar("mime_type", { length: 100 }).notNull(),
		size: integer("size").notNull(),
		visibility: varchar("visibility", {
			length: 20,
			enum: ["public", "private"] as const,
		})
			.notNull()
			.default("public"),
	});

	public readonly name: TState["name"];
	public readonly table: TState["fieldDefinitions"] extends Record<
		string,
		FieldDefinition<FieldDefinitionState>
	>
		? InferMainTableWithColumns<
				TState["name"],
				TState["fieldDefinitions"],
				TState["options"],
				TState["upload"]
			>
		: InferTableWithColumns<
				TState["name"],
				NonLocalizedFields<TState["fields"], TState["localized"]>,
				TState["title"],
				TState["options"]
			>;
	public readonly i18nTable: TState["localized"][number] extends never
		? null
		: TState["fieldDefinitions"] extends Record<string, any>
			? InferI18nTableWithColumns<TState["name"], TState["fieldDefinitions"]>
			: InferI18nTableWithColumns<
					TState["name"],
					LocalizedFields<TState["fields"], TState["localized"]>
				>;
	public readonly versionsTable: TState["options"]["versioning"] extends true
		? TState["fieldDefinitions"] extends Record<string, any>
			? InferVersionedTableWithColumns<
					TState["name"],
					TState["fieldDefinitions"],
					TState["title"]
				>
			: InferVersionedTableWithColumns<
					TState["name"],
					NonLocalizedFields<TState["fields"], TState["localized"]>,
					TState["title"]
				>
		: null;
	public readonly i18nVersionsTable: TState["localized"][number] extends never
		? null
		: TState["options"]["versioning"] extends true
			? TState["fieldDefinitions"] extends Record<string, any>
				? InferI18nVersionedTableWithColumns<
						TState["name"],
						TState["fieldDefinitions"],
						TState["title"]
					>
				: InferI18nVersionedTableWithColumns<
						TState["name"],
						LocalizedFields<TState["fields"], TState["localized"]>,
						TState["title"]
					>
			: null;

	public readonly state: TState;

	/**
	 * Type inference helper
	 * Access with: collection.$infer.select, collection.$infer.insert, etc.
	 */
	public readonly $infer!: {
		select: CollectionSelect<TState>;
		insert: CollectionInsert<TState>;
		update: CollectionUpdate<TState>;
	};

	constructor(
		state: TState,
		readonly indexesFn?: CollectionBuilderIndexesFn<TState, TState["indexes"]>,
	) {
		this.state = state;
		this.name = state.name;

		// Build the main table
		this.table = this.generateMainTable(indexesFn) as any;

		// Build the i18n table if there are localized fields
		this.i18nTable = this.generateI18nTable() as any;

		// Build the versions table
		this.versionsTable = this.generateVersionsTable() as any;
		this.i18nVersionsTable = this.generateI18nVersionsTable() as any;

		// Relations are defined in fields() using f.relation() and merged into state.relations

		// Auto-generate validation schemas if not explicitly provided
		// This ensures .notNull() fields are validated before database insert
		if (!state.validation) {
			const localizedFieldNames = new Set(state.localized as readonly string[]);
			const mainFields: Record<string, any> = {};
			const localizedFields: Record<string, any> = {};

			// Include auto-generated ID field if user didn't define one
			// This ensures the validation schema accepts custom IDs during create
			const hasUserDefinedId = "id" in state.fields;
			if (!hasUserDefinedId) {
				mainFields.id = defaultIdColumn();
			}

			for (const [key, column] of Object.entries(state.fields)) {
				if (localizedFieldNames.has(key)) {
					localizedFields[key] = column;
				} else {
					mainFields[key] = column;
				}
			}

			// Include system fields in validation schema so internal operations
			// (like restore) can update them
			if (state.options.timestamps !== false) {
				Object.assign(mainFields, Collection.timestampsCols());
			}
			if (state.options.softDelete) {
				Object.assign(mainFields, Collection.softDeleteCols());
			}

			state.validation = createCollectionValidationSchemas(
				state.name,
				mainFields,
				localizedFields,
				{
					// Pass field definitions for relation field name normalization
					// This allows users to use `author` instead of `authorId` in input
					fieldDefinitions: state.fieldDefinitions as any,
				},
			) as any;
		}

		// Ensure virtuals is always initialized
		if (!state.virtuals) {
			state.virtuals = {} as TState["virtuals"];
		}

		// Type inference helper (empty runtime object, types only)
		this.$infer = {} as any;
	}

	/**
	 * Get virtual fields with specific context
	 * This allows regenerating virtual field SQL with runtime context
	 */
	public getVirtuals(_context: any): TState["virtuals"] {
		return this.state.virtuals || ({} as TState["virtuals"]);
	}

	/**
	 * Get virtual fields with aliased i18n tables for use in queries.
	 * This creates COALESCE expressions using the aliased tables instead of subqueries.
	 *
	 * @param _context - CRUD context
	 * @param _i18nCurrentTable - Aliased i18n table for current locale
	 * @param _i18nFallbackTable - Aliased i18n table for fallback locale (null if no fallback)
	 */
	public getVirtualsWithAliases(
		_context: any,
		_i18nCurrentTable: any | null,
		_i18nFallbackTable: any | null,
	): TState["virtuals"] {
		return this.state.virtuals || ({} as TState["virtuals"]);
	}

	public getVirtualsForVersions(_context: any): TState["virtuals"] {
		return this.state.virtuals || ({} as TState["virtuals"]);
	}

	/**
	 * Get virtual fields for versions with aliased i18n tables.
	 * Creates COALESCE expressions using the aliased tables instead of subqueries.
	 *
	 * @param _context - CRUD context
	 * @param _i18nVersionsCurrentTable - Aliased i18n versions table for current locale
	 * @param _i18nVersionsFallbackTable - Aliased i18n versions table for fallback locale
	 */
	public getVirtualsForVersionsWithAliases(
		_context: any,
		_i18nVersionsCurrentTable: any | null,
		_i18nVersionsFallbackTable: any | null,
	): TState["virtuals"] {
		return this.state.virtuals || ({} as TState["virtuals"]);
	}

	/**
	 * Get title field name
	 */
	public getTitleFieldName(): string | undefined {
		return this.state.title;
	}

	/**
	 * Get title column/expression with specific context
	 * Resolves the title field name to the actual column or virtual SQL
	 */
	public getTitleExpression(context: any): SQL | Column | null {
		const titleField = this.state.title;
		if (!titleField) return null;

		// Check if it's a regular field (column on main table)
		if (titleField in this.state.fields) {
			// Check if it's a localized field (need to parse field names)
			const mode = getLocalizedFieldMode(
				this.state.localized as readonly string[],
				titleField,
			);
			if (mode !== null) {
				// Use i18n accessor for localized fields
				const i18nAccessor = this.createI18nAccessor(context);
				return (i18nAccessor as any)[titleField];
			}
			// Non-localized field - get from table
			return (this.table as any)[titleField];
		}

		// Check if it's a virtual field
		const virtuals = this.getVirtuals(context);
		if (virtuals && titleField in virtuals) {
			return (virtuals as any)[titleField];
		}

		return null;
	}

	/**
	 * Get title expression for versions table
	 */
	public getTitleExpressionForVersions(context: any): SQL | Column | null {
		const titleField = this.state.title;
		if (!titleField || !this.versionsTable) return null;

		// Check if it's a regular field
		if (titleField in this.state.fields) {
			// Check if it's a localized field (need to parse field names)
			const mode = getLocalizedFieldMode(
				this.state.localized as readonly string[],
				titleField,
			);
			if (mode !== null) {
				const i18nAccessor = this.createI18nAccessorForVersions(
					this.versionsTable,
					this.i18nVersionsTable,
					context,
				);
				return (i18nAccessor as any)[titleField];
			}
			// Non-localized field - get from versions table
			return (this.versionsTable as any)[titleField];
		}

		// Check if it's a virtual field
		const virtuals = this.getVirtualsForVersions(context);
		if (virtuals && titleField in virtuals) {
			return (virtuals as any)[titleField];
		}

		return null;
	}

	/**
	 * Get raw title expression (for UPDATE queries) without COALESCE
	 */
	public getRawTitleExpression(context: any): SQL | Column | null {
		const titleField = this.state.title;
		if (!titleField) return null;

		// Check if it's a regular field
		if (titleField in this.state.fields) {
			// Check if it's a localized field (need to parse field names)
			const mode = getLocalizedFieldMode(
				this.state.localized as readonly string[],
				titleField,
			);
			if (mode !== null) {
				const i18nAccessor = this.createRawI18nAccessor();
				return (i18nAccessor as any)[titleField];
			}
			// Non-localized field - get from table
			return (this.table as any)[titleField];
		}

		// Check if it's a virtual field
		const virtuals = this.getVirtuals(context);
		if (virtuals && titleField in virtuals) {
			return (virtuals as any)[titleField];
		}

		return null;
	}

	/**
	 * Generate the main Drizzle table
	 */
	private generateMainTable(
		indexesFn?: CollectionBuilderIndexesFn<TState, TState["indexes"]>,
	): PgTable {
		const tableName = this.state.name;
		const columns: Record<string, any> = {};

		// Check if user defined 'id' in fields
		const hasUserDefinedId = "id" in this.state.fields;

		// Add default ID if user didn't provide one
		if (!hasUserDefinedId) {
			columns.id = defaultIdColumn();
		}

		// Add non-localized fields (including user-defined id if present)
		// Also include JSONB fields with nested localization (they store structure with $i18n markers)
		for (const [fieldName, column] of Object.entries(this.state.fields)) {
			const mode = getLocalizedFieldMode(
				this.state.localized as readonly string[],
				fieldName,
			);

			// Skip localized fields (they go to i18n table)
			if (mode !== null) {
				// Exception: JSONB nested-mode stays in main table (structure with $i18n markers)
				if (mode === "nested" && isJsonbColumn(column)) {
					columns[fieldName] = column;
				}
				continue;
			}

			columns[fieldName] = column;
		}

		// Add timestamps
		if (this.state.options.timestamps !== false) {
			Object.assign(columns, Collection.timestampsCols());
		}

		// Add soft delete
		if (this.state.options.softDelete) {
			Object.assign(columns, Collection.softDeleteCols());
		}

		// Create final table with constraints
		const table = pgTable(tableName, columns as any, (t) => {
			const constraints: Record<string, any> = {};

			// User-defined indexes
			if (indexesFn) {
				Object.assign(constraints, indexesFn({ table: t as any }));
			}

			// Auto-index on deletedAt for soft delete
			if (this.state.options.softDelete) {
				constraints[`${tableName}_deleted_at_idx`] = index().on(
					(t as any).deletedAt,
				);
			}

			return Object.values(constraints);
		});

		return table;
	}

	/**
	 * Generate the i18n table for localized fields
	 * Uses the same ID type as the parent table for parentId foreign key
	 *
	 * Includes:
	 * - Flat localized fields (non-JSONB) - entire column is localized
	 * - JSONB whole-mode localized fields - entire JSONB per locale
	 * - `_localized` JSONB column - stores nested localized values from $i18n wrappers
	 *
	 * Note: JSONB nested-mode fields do NOT get their own column in the i18n table.
	 * Instead, they stay in the main table (with $i18n markers) and their extracted
	 * localized values are stored in the `_localized` column.
	 */
	private generateI18nTable(): PgTable | null {
		const hasLocalizedFields = this.state.localized.length > 0;

		// Need i18n table if we have localized fields
		if (!hasLocalizedFields) return null;

		const tableName = `${this.state.name}_i18n`;

		// Get the parent table's ID column to match its type for parentId
		const parentIdColumn = (this.table as any).id as PgColumn;

		const columns: Record<string, any> = {
			// Own ID - uses default type
			id: text("id").primaryKey().default(sql`gen_random_uuid()`),
			// Parent ID - matches parent table's ID type
			parentId: cloneColumnType(parentIdColumn, "parent_id")
				.notNull()
				.references(() => (this.table as any).id, { onDelete: "cascade" }),
			locale: text("locale").notNull(),
			// Nested localized values from $i18n wrappers in nested-mode fields
			_localized: jsonb("_localized"),
		};

		// Add localized fields based on their mode
		for (const localizedField of this.state.localized) {
			const parsed = parseLocalizedField(localizedField as string);
			const column = this.state.fields[parsed.name];
			if (!column) continue;

			const isJsonb = isJsonbColumn(column);

			// Flat fields (non-JSONB) always get their own column
			if (!isJsonb) {
				columns[parsed.name] = column;
				continue;
			}

			// JSONB fields:
			// - whole mode: get their own column (entire JSONB per locale)
			// - nested mode: skip (values go to _localized column)
			if (parsed.mode === "whole") {
				columns[parsed.name] = column;
			}
			// nested mode: skip, uses _localized column
		}

		return pgTable(tableName, columns as any, (t) => ({
			parentLocaleIdx: uniqueIndex().on(t.parentId, t.locale),
		}));
	}

	/**
	 * Generate the versions table
	 * Uses the same ID type as the parent table for the id foreign key
	 */
	private generateVersionsTable(): InferVersionedTableWithColumns<
		TState["name"],
		NonLocalizedFields<TState["fields"], TState["localized"]>,
		TState["title"]
	> | null {
		const versioning = this.state.options.versioning;
		if (!versioning) return null;
		if (typeof versioning === "object" && !versioning.enabled) return null;

		const tableName = `${this.state.name}_versions`;

		// Get the parent table's ID column to match its type
		const parentIdColumn = (this.table as any).id as PgColumn;
		const columns: Record<string, any> = Collection.versionCols(parentIdColumn);

		for (const [fieldName, column] of Object.entries(this.state.fields)) {
			if (this.state.localized.includes(fieldName as any)) continue;
			// Skip id field as it's already included in versionCols
			if (fieldName === "id") continue;
			columns[fieldName as string] = column;
		}

		/*
		//  we don't want timestamps in versions table, they are represented by versionCreatedAt
		//  also no point of soft delete in versions table
		if (this.state.options.timestamps !== false) {
			Object.assign(columns, Collection.timestampsCols());
		}

		if (this.state.options.softDelete) {
			Object.assign(columns, Collection.softDeleteCols());
		}
		*/

		return pgTable(tableName, columns as any, (t) => [
			index().on(t.id, t.versionNumber),
			index().on(t.versionCreatedAt),
		]) as any;
	}

	/**
	 * Generate the i18n versions table
	 * Uses the same ID type as the parent table for parentId
	 */
	private generateI18nVersionsTable(): InferI18nVersionedTableWithColumns<
		TState["name"],
		LocalizedFields<TState["fields"], TState["localized"]>,
		TState["title"]
	> | null {
		const versioning = this.state.options.versioning;
		if (!versioning) return null;
		if (typeof versioning === "object" && !versioning.enabled) return null;
		if (this.state.localized.length === 0) return null;

		const tableName = `${this.state.name}_i18n_versions`;

		// Get the parent table's ID column to match its type
		const parentIdColumn = (this.table as any).id as PgColumn;
		const columns: Record<string, any> =
			Collection.i18nVersionCols(parentIdColumn);

		// Add _localized column for nested-mode fields
		columns._localized = jsonb("_localized");

		// Add localized fields based on their mode (same logic as generateI18nTable)
		for (const localizedField of this.state.localized) {
			const parsed = parseLocalizedField(localizedField as string);
			const column = this.state.fields[parsed.name];
			if (!column) continue;

			const isJsonb = isJsonbColumn(column);

			// Flat fields (non-JSONB) always get their own column
			if (!isJsonb) {
				columns[parsed.name] = column;
				continue;
			}

			// JSONB fields:
			// - whole mode: get their own column (entire JSONB per locale)
			// - nested mode: skip (values go to _localized column)
			if (parsed.mode === "whole") {
				columns[parsed.name] = column;
			}
		}

		return pgTable(tableName, columns as any, (t) => [
			uniqueIndex().on(t.parentId, t.versionNumber, t.locale),
			index().on(t.parentId, t.versionNumber),
		]) as any;
	}

	/**
	 * Create i18n accessor object for localized fields
	 * Returns SQL expressions with COALESCE pattern for each localized field
	 */
	private createI18nAccessorFor(
		table: any,
		i18nTable: any | null,
		context: any,
	): I18nFieldAccessor<TState["fields"], TState["localized"]> {
		const accessor: any = {};
		const defaultLocale = context?.defaultLocale || DEFAULT_LOCALE;

		if (!i18nTable) return accessor;

		for (const localizedField of this.state.localized) {
			// Parse field name (remove :nested suffix if present)
			const parsed = parseLocalizedField(localizedField as string);
			const fieldName = parsed.name;

			// COALESCE(
			//   1. Value from the main LEFT JOIN (filtered by current locale in CRUD generator)
			//   2. Fallback subquery for default locale
			// )
			const i18nRef = i18nTable as any;
			if (context?.localeFallback === false) {
				accessor[fieldName] = i18nRef[fieldName];
			} else {
				accessor[fieldName] = sql`COALESCE(
					${i18nRef[fieldName]},
					(SELECT ${i18nRef[fieldName]} FROM ${i18nTable}
					 WHERE ${i18nRef.parentId} = ${(table as any).id}
					 AND ${i18nRef.locale} = ${defaultLocale} LIMIT 1)
				)`;
			}
		}

		return accessor;
	}

	private createI18nAccessorForVersions(
		table: any,
		i18nTable: any | null,
		context: any,
	): I18nFieldAccessor<TState["fields"], TState["localized"]> {
		const accessor: any = {};
		const defaultLocale = context?.defaultLocale || DEFAULT_LOCALE;

		if (!i18nTable) return accessor;

		for (const localizedField of this.state.localized) {
			// Parse field name (remove :nested suffix if present)
			const parsed = parseLocalizedField(localizedField as string);
			const fieldName = parsed.name;

			const i18nRef = i18nTable as any;
			if (context?.localeFallback === false) {
				accessor[fieldName] = i18nRef[fieldName];
			} else {
				accessor[fieldName] = sql`COALESCE(
					${i18nRef[fieldName]},
					(SELECT ${i18nRef[fieldName]} FROM ${i18nTable}
					 WHERE ${i18nRef.parentId} = ${(table as any).id}
					 AND ${i18nRef.versionNumber} = ${(table as any).versionNumber}
					 AND ${i18nRef.locale} = ${defaultLocale} LIMIT 1)
				)`;
			}
		}

		return accessor;
	}

	/**
	 * Create raw i18n accessor object (direct column references)
	 */
	private createRawI18nAccessorFor(
		i18nTable: any | null,
	): I18nFieldAccessor<TState["fields"], TState["localized"]> {
		const accessor: any = {};

		if (!i18nTable) return accessor;

		for (const localizedField of this.state.localized) {
			// Parse field name (remove :nested suffix if present)
			const parsed = parseLocalizedField(localizedField as string);
			const fieldName = parsed.name;

			accessor[fieldName] = (i18nTable as any)[fieldName];
		}

		return accessor;
	}

	private createI18nAccessor(
		context: any,
	): I18nFieldAccessor<TState["fields"], TState["localized"]> {
		return this.createI18nAccessorFor(this.table, this.i18nTable, context);
	}

	/**
	 * Create i18n accessor using aliased tables for current and fallback locales.
	 * Uses simple COALESCE(current, fallback) instead of subqueries.
	 *
	 * @param i18nCurrentTable - Aliased i18n table for current locale (null if no i18n)
	 * @param i18nFallbackTable - Aliased i18n table for fallback locale (null if no fallback)
	 * @param context - CRUD context
	 */
	private createI18nAccessorWithAliases(
		i18nCurrentTable: any | null,
		i18nFallbackTable: any | null,
		context: any,
	): I18nFieldAccessor<TState["fields"], TState["localized"]> {
		const accessor: any = {};

		if (!i18nCurrentTable) return accessor;

		for (const localizedField of this.state.localized) {
			// Parse field name (remove :nested suffix if present)
			const parsed = parseLocalizedField(localizedField as string);
			const fieldName = parsed.name;

			const currentRef = i18nCurrentTable[fieldName];

			// If no fallback or fallback disabled, use current directly
			if (!i18nFallbackTable || context?.localeFallback === false) {
				accessor[fieldName] = currentRef;
			} else {
				// COALESCE(current, fallback) - no subquery needed
				const fallbackRef = i18nFallbackTable[fieldName];
				accessor[fieldName] = sql`COALESCE(${currentRef}, ${fallbackRef})`;
			}
		}

		return accessor;
	}

	/**
	 * Create i18n accessor for versions using aliased tables for current and fallback locales.
	 * Uses simple COALESCE(current, fallback) instead of subqueries.
	 *
	 * @param i18nVersionsCurrentTable - Aliased i18n versions table for current locale
	 * @param i18nVersionsFallbackTable - Aliased i18n versions table for fallback locale
	 * @param context - CRUD context
	 */
	private createI18nAccessorWithAliasesForVersions(
		i18nVersionsCurrentTable: any | null,
		i18nVersionsFallbackTable: any | null,
		context: any,
	): I18nFieldAccessor<TState["fields"], TState["localized"]> {
		// Same logic as createI18nAccessorWithAliases - just with different table parameters
		const accessor: any = {};

		if (!i18nVersionsCurrentTable) return accessor;

		for (const localizedField of this.state.localized) {
			// Parse field name (remove :nested suffix if present)
			const parsed = parseLocalizedField(localizedField as string);
			const fieldName = parsed.name;

			const currentRef = i18nVersionsCurrentTable[fieldName];

			// If no fallback or fallback disabled, use current directly
			if (!i18nVersionsFallbackTable || context?.localeFallback === false) {
				accessor[fieldName] = currentRef;
			} else {
				// COALESCE(current, fallback) - no subquery needed
				const fallbackRef = i18nVersionsFallbackTable[fieldName];
				accessor[fieldName] = sql`COALESCE(${currentRef}, ${fallbackRef})`;
			}
		}

		return accessor;
	}

	private createRawI18nAccessor(): I18nFieldAccessor<
		TState["fields"],
		TState["localized"]
	> {
		return this.createRawI18nAccessorFor(this.i18nTable);
	}

	/**
	 * Generate CRUD operations (Drizzle RQB v2-like)
	 */
	generateCRUD(
		db: any,
		cms?: any,
	): CRUD<
		CollectionSelect<TState>,
		CollectionInsert<TState>,
		CollectionUpdate<TState>,
		TState["relations"]
	> {
		const crud = new CRUDGenerator(
			this.state,
			this.table,
			this.i18nTable,
			this.versionsTable,
			this.i18nVersionsTable,
			db,
			this.getVirtuals.bind(this),
			this.getVirtualsWithAliases.bind(this),
			this.getTitleExpression.bind(this),
			this.getVirtualsForVersions.bind(this),
			this.getVirtualsForVersionsWithAliases.bind(this),
			this.getTitleExpressionForVersions.bind(this),
			this.getRawTitleExpression.bind(this),
			cms,
		);

		return crud.generate() as CRUD<
			CollectionSelect<TState>,
			CollectionInsert<TState>,
			CollectionUpdate<TState>,
			TState["relations"]
		>;
	}
	// ...

	/**
	 * Get metadata about the collection
	 */
	getMeta() {
		// Title is now a field name (string) - determine if it's a field or virtual
		const titleField = this.state.title;
		const titleMeta: {
			defined: boolean;
			type: "field" | "virtual" | null;
			fieldName: string | null;
		} = {
			defined: !!titleField,
			type: null,
			fieldName: titleField || null,
		};

		if (titleField) {
			if (titleField in this.state.fields) {
				titleMeta.type = "field";
			} else if (this.state.virtuals && titleField in this.state.virtuals) {
				titleMeta.type = "virtual";
			}
		}

		return {
			name: this.state.name,
			fields: Object.entries(this.state.fields).map(([name, column]) => {
				const mode = getLocalizedFieldMode(
					this.state.localized as readonly string[],
					name,
				);
				return {
					name,
					column,
					localized: mode !== null,
					localizationMode: mode,
					virtual: this.state.virtuals && name in this.state.virtuals,
				};
			}),
			title: titleMeta,
			timestamps: this.state.options.timestamps !== false,
			softDelete: this.state.options.softDelete || false,
			virtualFields: this.state.virtuals
				? Object.keys(this.state.virtuals)
				: [],
			localizedFields: Array.from(this.state.localized).map((f) =>
				parseLocalizedField(f as string),
			),
			relations: Object.keys(this.state.relations),
		};
	}
}
