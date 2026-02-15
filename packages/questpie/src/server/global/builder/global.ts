import type {
	GetColumnData,
	InferInsertModel,
	InferSelectModel,
	SQL,
} from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import {
	bigint,
	char,
	index,
	integer,
	pgTable,
	smallint,
	text,
	timestamp,
	uniqueIndex,
	uuid,
	varchar,
} from "drizzle-orm/pg-core";
import { Collection } from "#questpie/server/collection/builder/collection.js";
import type {
	ExtractFieldsByLocation,
	I18nFieldAccessor,
	InferSQLType,
} from "#questpie/server/collection/builder/types.js";
import type {
	GlobalBuilderState,
	InferGlobalTableWithColumns,
} from "#questpie/server/global/builder/types.js";
import { createGlobalValidationSchema } from "#questpie/server/global/builder/validation-helpers.js";
import { DEFAULT_LOCALE } from "#questpie/shared/constants.js";
import type { GlobalMeta } from "#questpie/shared/global-meta.js";
import { GlobalCRUDGenerator } from "../crud/global-crud-generator.js";
import type { GlobalCRUD } from "../crud/types.js";

/**
 * Default ID column factory for globals
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
			return text(newName);
	}
}

/**
 * Infer select type from Global
 */
type InferGlobalSelect<
	TTable extends PgTable,
	TFields extends Record<string, any>,
	TLocalized extends ReadonlyArray<keyof TFields>,
	TVirtuals extends Record<string, SQL>,
> = InferSelectModel<TTable> & {
	[K in keyof TVirtuals]: InferSQLType<TVirtuals[K]>;
} & {
	[K in TLocalized[number]]: GetColumnData<TFields[K]>;
};

/**
 * Infer insert type from Global
 */
type InferGlobalInsert<
	TTable extends PgTable,
	TFields extends Record<string, any>,
	TLocalized extends ReadonlyArray<keyof TFields>,
> = InferInsertModel<TTable> & {
	[K in TLocalized[number]]?: GetColumnData<TFields[K]>;
};

/**
 * Infer update type from Global
 */
type InferGlobalUpdate<
	TTable extends PgTable,
	TFields extends Record<string, any>,
	TLocalized extends ReadonlyArray<keyof TFields>,
> = Partial<InferInsertModel<TTable>> & {
	[K in TLocalized[number]]?: GetColumnData<TFields[K]>;
};

export class Global<TState extends GlobalBuilderState> {
	public readonly name: TState["name"];
	public readonly table: InferGlobalTableWithColumns<
		TState["name"],
		TState["fieldDefinitions"] extends Record<string, any>
			? ExtractFieldsByLocation<TState["fieldDefinitions"], "main">
			: Omit<TState["fields"], TState["localized"][number]>,
		TState["options"]
	>;
	public readonly i18nTable: TState["localized"][number] extends never
		? null
		: PgTable; // Simplified type for now
	public readonly versionsTable: PgTable | null;
	public readonly i18nVersionsTable: PgTable | null;
	public readonly state: TState;

	/**
	 * Type inference helper
	 */
	public readonly $infer!: {
		select: InferGlobalSelect<
			InferGlobalTableWithColumns<
				TState["name"],
				TState["fieldDefinitions"] extends Record<string, any>
					? ExtractFieldsByLocation<TState["fieldDefinitions"], "main">
					: Omit<TState["fields"], TState["localized"][number]>,
				TState["options"]
			>,
			TState["fields"],
			TState["localized"],
			TState["virtuals"]
		>;
		insert: InferGlobalInsert<
			InferGlobalTableWithColumns<
				TState["name"],
				TState["fieldDefinitions"] extends Record<string, any>
					? ExtractFieldsByLocation<TState["fieldDefinitions"], "main">
					: Omit<TState["fields"], TState["localized"][number]>,
				TState["options"]
			>,
			TState["fields"],
			TState["localized"]
		>;
		update: InferGlobalUpdate<
			InferGlobalTableWithColumns<
				TState["name"],
				TState["fieldDefinitions"] extends Record<string, any>
					? ExtractFieldsByLocation<TState["fieldDefinitions"], "main">
					: Omit<TState["fields"], TState["localized"][number]>,
				TState["options"]
			>,
			TState["fields"],
			TState["localized"]
		>;
	};

	constructor(state: TState) {
		this.state = state;
		this.name = state.name;

		this.table = this.generateMainTable() as any;
		this.i18nTable = this.generateI18nTable() as any;
		this.versionsTable = this.generateVersionsTable();
		this.i18nVersionsTable = this.generateI18nVersionsTable();

		// Relations are now defined via f.relation() in fields() and resolved in global-builder.ts

		// Auto-generate validation schema if not explicitly provided
		if (!state.validation) {
			const localizedFieldNames = new Set(state.localized as readonly string[]);
			const mainFields: Record<string, any> = {};
			const localizedFields: Record<string, any> = {};

			// Include auto-generated ID field if user didn't define one
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

			// Include system fields in validation schema
			if (state.options.timestamps !== false) {
				Object.assign(mainFields, Collection.timestampsCols());
			}

			state.validation = createGlobalValidationSchema(
				state.name,
				mainFields,
				localizedFields,
			) as any;
		}

		this.$infer = {} as any;
	}

	public getVirtuals(_context: any): TState["virtuals"] {
		return this.state.virtuals;
	}

	public getVirtualsForVersions(_context: any): TState["virtuals"] {
		return this.state.virtuals;
	}

	/**
	 * Generate CRUD operations
	 */
	generateCRUD(
		db: any,
		cms?: any,
	): GlobalCRUD<
		InferGlobalSelect<
			any,
			TState["fields"],
			TState["localized"],
			TState["virtuals"]
		>,
		InferGlobalInsert<any, TState["fields"], TState["localized"]>,
		InferGlobalUpdate<any, TState["fields"], TState["localized"]>,
		TState["relations"]
	> {
		const crud = new GlobalCRUDGenerator(
			this.state,
			this.table,
			this.i18nTable,
			this.versionsTable,
			this.i18nVersionsTable,
			db,
			this.getVirtuals.bind(this),
			this.getVirtualsForVersions.bind(this),
			cms,
		);
		return crud.generate() as any;
	}

	private generateMainTable(): PgTable {
		const tableName = this.state.name;
		const columns: Record<string, any> = {};
		const isScoped = !!this.state.options.scoped;

		// Check if user defined 'id' in fields
		const hasUserDefinedId = "id" in this.state.fields;

		// Add default ID if user didn't provide one
		if (!hasUserDefinedId) {
			columns.id = defaultIdColumn();
		}

		// Add scope_id column for scoped globals
		if (isScoped) {
			columns.scopeId = text("scope_id");
		}

		for (const [fieldName, column] of Object.entries(this.state.fields)) {
			if (this.state.localized.includes(fieldName as any)) continue;
			columns[fieldName] = column;
		}

		if (this.state.options.timestamps !== false) {
			Object.assign(columns, Collection.timestampsCols());
		}

		// Add unique index on scope_id for scoped globals
		if (isScoped) {
			return pgTable(tableName, columns as any, (t) => ({
				scopeIdx: uniqueIndex(`${tableName}_scope_idx`).on(t.scopeId),
			}));
		}

		return pgTable(tableName, columns as any);
	}

	private generateI18nTable(): PgTable | null {
		if (this.state.localized.length === 0) return null;

		const tableName = `${this.state.name}_i18n`;

		// Get the parent table's ID column to match its type for parentId
		const parentIdColumn = (this.table as any).id as PgColumn;

		const columns: Record<string, any> = {
			id: text("id").primaryKey().default(sql`gen_random_uuid()`),
			parentId: cloneColumnType(parentIdColumn, "parent_id")
				.notNull()
				.references(() => (this.table as any).id, { onDelete: "cascade" }),
			locale: text("locale").notNull(),
		};

		for (const fieldName of this.state.localized) {
			const column = this.state.fields[fieldName];
			if (column) {
				columns[fieldName as string] = column;
			}
		}

		return pgTable(tableName, columns as any, (t) => ({
			parentLocaleIdx: uniqueIndex().on(t.parentId, t.locale),
		}));
	}

	private generateVersionsTable(): PgTable | null {
		const versioning = this.state.options.versioning;
		if (!versioning) return null;
		if (typeof versioning === "object" && !versioning.enabled) return null;

		const tableName = `${this.state.name}_versions`;
		const isScoped = !!this.state.options.scoped;

		// Get the parent table's ID column to match its type
		const parentIdColumn = (this.table as any).id as PgColumn;

		const columns: Record<string, any> = {
			versionId: text("version_id")
				.primaryKey()
				.default(sql`gen_random_uuid()`),
			id: cloneColumnType(parentIdColumn, "id").notNull(),
			versionNumber: integer("version_number").notNull(),
			versionOperation: text("version_operation").notNull(),
			versionUserId: text("version_user_id"),
			versionCreatedAt: timestamp("version_created_at", { mode: "date" })
				.defaultNow()
				.notNull(),
		};

		// Add scope_id for scoped globals
		if (isScoped) {
			columns.scopeId = text("scope_id");
		}

		for (const [fieldName, column] of Object.entries(this.state.fields)) {
			if (this.state.localized.includes(fieldName as any)) continue;
			// Skip id field as it's already included above
			if (fieldName === "id") continue;
			columns[fieldName as string] = column;
		}

		if (this.state.options.timestamps !== false) {
			Object.assign(columns, Collection.timestampsCols());
		}

		return pgTable(tableName, columns as any, (t) => ({
			recordVersionIdx: index().on(t.id, t.versionNumber),
			versionCreatedAtIdx: index().on(t.versionCreatedAt),
		}));
	}

	private generateI18nVersionsTable(): PgTable | null {
		const versioning = this.state.options.versioning;
		if (!versioning) return null;
		if (typeof versioning === "object" && !versioning.enabled) return null;
		if (this.state.localized.length === 0) return null;

		const tableName = `${this.state.name}_i18n_versions`;

		// Get the parent table's ID column to match its type
		const parentIdColumn = (this.table as any).id as PgColumn;

		const columns: Record<string, any> = {
			id: text("id").primaryKey().default(sql`gen_random_uuid()`),
			parentId: cloneColumnType(parentIdColumn, "parent_id").notNull(),
			versionNumber: integer("version_number").notNull(),
			locale: text("locale").notNull(),
		};

		for (const fieldName of this.state.localized) {
			const column = this.state.fields[fieldName];
			if (column) {
				columns[fieldName as string] = column;
			}
		}

		return pgTable(tableName, columns as any, (t) => ({
			parentVersionLocaleIdx: uniqueIndex().on(
				t.parentId,
				t.versionNumber,
				t.locale,
			),
			parentVersionIdx: index().on(t.parentId, t.versionNumber),
		}));
	}

	private createI18nAccessor(
		context: any,
	): I18nFieldAccessor<TState["fields"], TState["localized"]> {
		const accessor: any = {};
		const defaultLocale = context?.defaultLocale || DEFAULT_LOCALE;

		if (!this.i18nTable) return accessor;

		for (const fieldName of this.state.localized) {
			const i18nTable = this.i18nTable as any;
			if (context?.localeFallback === false) {
				accessor[fieldName] = i18nTable[fieldName];
			} else {
				accessor[fieldName] = sql`COALESCE(
					${i18nTable[fieldName]},
					(SELECT ${i18nTable[fieldName]} FROM ${this.i18nTable}
					 WHERE ${i18nTable.parentId} = ${(this.table as any).id}
					 AND ${i18nTable.locale} = ${defaultLocale} LIMIT 1)
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

		for (const fieldName of this.state.localized) {
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

	getMeta(): GlobalMeta {
		const fieldDefinitions = this.state.fieldDefinitions || {};
		const fields = Object.entries(fieldDefinitions).map(
			([name, def]: [string, any]) => ({
				name,
				localized: this.state.localized.includes(name as any),
				virtual: name in this.state.virtuals,
			}),
		);

		const versioning = this.state.options.versioning;
		const hasVersioning =
			!!versioning &&
			(typeof versioning !== "object" || versioning.enabled !== false);

		return {
			name: this.state.name,
			fields,
			timestamps: this.state.options.timestamps !== false,
			versioning: hasVersioning,
			virtualFields: Object.keys(this.state.virtuals),
			localizedFields: Array.from(this.state.localized),
		};
	}
}
