// builder/collection.ts
import type { PgTable } from "drizzle-orm/pg-core";
import {
	pgTable,
	uuid,
	text,
	timestamp,
	index,
	uniqueIndex,
	integer,
	jsonb,
} from "drizzle-orm/pg-core";
import type {
	SQL,
	InferSelectModel,
	InferInsertModel,
	GetColumnData,
} from "drizzle-orm";
import { sql } from "drizzle-orm";
import type {
	CollectionBuilderState,
	NonLocalizedFields,
	InferSQLType,
	InferTableWithColumns,
	I18nFieldAccessor,
	LocalizedFields,
	LocalizedTableName,
	RelationVariant,
	CollectionBuilderRelationFn,
} from "#questpie/cms/server/collection/builder/types";
import { CRUDGenerator } from "#questpie/cms/server/collection/crud";
import type { CRUD } from "#questpie/cms/server/collection/crud/types";

// ... (Infer types skipped for brevity if not changing) ...
/**
 * Infer select type from Collection
 * Combines: Drizzle table $inferSelect + virtual fields + _title + localized fields
 */
type InferCollectionSelect<
	TTable extends PgTable,
	TFields extends Record<string, any>,
	TLocalized extends ReadonlyArray<keyof TFields>,
	TVirtuals extends Record<string, SQL>,
	TTitle extends SQL | undefined,
> = InferSelectModel<TTable> & {
	[K in keyof TVirtuals]: InferSQLType<TVirtuals[K]>;
} & {
	[K in TLocalized[number]]: GetColumnData<TFields[K]>;
} & (TTitle extends SQL ? { _title: string } : {});

/**
 * Infer insert type from Collection
 * Uses Drizzle's $inferInsert + adds localized fields
 */
type InferCollectionInsert<
	TTable extends PgTable,
	TFields extends Record<string, any>,
	TLocalized extends ReadonlyArray<keyof TFields>,
> = InferInsertModel<TTable> & {
	// Localized fields are optional on insert (default locale)
	[K in TLocalized[number]]?: GetColumnData<TFields[K]>;
};

/**
 * Infer update type from Collection
 * Partial of $inferInsert + localized fields
 */
type InferCollectionUpdate<
	TTable extends PgTable,
	TFields extends Record<string, any>,
	TLocalized extends ReadonlyArray<keyof TFields>,
> = Partial<InferInsertModel<TTable>> & {
	[K in TLocalized[number]]?: GetColumnData<TFields[K]>;
};

// Re-export for convenience
export type { CollectionBuilder } from "./collection-builder.js";

export type CollectionSelect<TState extends CollectionBuilderState> =
	InferCollectionSelect<
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

export type CollectionInsert<TState extends CollectionBuilderState> =
	InferCollectionInsert<
		InferTableWithColumns<
			TState["name"],
			NonLocalizedFields<TState["fields"], TState["localized"]>,
			TState["title"],
			TState["options"]
		>,
		TState["fields"],
		TState["localized"]
	>;

export type CollectionUpdate<TState extends CollectionBuilderState> =
	InferCollectionUpdate<
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
 * Final Collection class - the result of build()
 * Contains the generated tables, types, and CRUD operations
 * Uses single generic state pattern for better type performance
 */
export class Collection<TState extends CollectionBuilderState> {
	public readonly name: TState["name"];
	public readonly table: InferTableWithColumns<
		TState["name"],
		NonLocalizedFields<TState["fields"], TState["localized"]>,
		TState["title"],
		TState["options"]
	>;
	public readonly i18nTable: TState["localized"][number] extends never
		? null
		: InferTableWithColumns<
				LocalizedTableName<TState["name"]>,
				LocalizedFields<TState["fields"], TState["localized"]>,
				TState["title"],
				TState["options"]
			>;
	public readonly versionsTable: PgTable | null;
	public readonly state: TState;

	static pkCols = () => ({
		id: uuid("id").primaryKey().default(sql`uuidv7()`),
	});

	static timestampsCols = () => ({
		createdAt: timestamp("created_at", { mode: "string" })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { mode: "string" })
			.defaultNow()
			.notNull(),
	});

	static softDeleteCols = () => ({
		deletedAt: timestamp("deleted_at", { mode: "string" }),
	});

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
		private readonly virtualsFn?: (
			table: any,
			i18n: any,
			context: any,
		) => TState["virtuals"],
		private readonly relationsFn?: CollectionBuilderRelationFn<TState, any>,
		readonly indexesFn?: (table: any) => TState["indexes"],
		private readonly titleFn?: (
			table: any,
			i18n: any,
			context: any,
		) => TState["title"],
	) {
		this.state = state;
		this.name = state.name;

		// Build the main table
		this.table = this.generateMainTable(indexesFn, titleFn) as any;

		// Build the i18n table if there are localized fields
		this.i18nTable = this.generateI18nTable() as any;

		// Build the versions table
		this.versionsTable = this.generateVersionsTable();

		// Execute virtual fields function now that we have the table
		if (virtualsFn) {
			const context = {
				defaultLocale: (this.state.options as any).defaultLocale || "en",
			};
			const i18nAccessor = this.createI18nAccessor(context);
			state.virtuals = virtualsFn(
				this.table,
				i18nAccessor,
				context,
			) as TState["virtuals"];
		}

		// Execute relations function
		if (relationsFn) {
			const context = {
				defaultLocale: (this.state.options as any).defaultLocale || "en",
			};
			const i18nAccessor = this.createI18nAccessor(context);

			const helpers: RelationVariant = {
				one: (collection, config) =>
					({ type: "one", collection, ...config }) as any,
				many: (collection, config) =>
					({ type: "many", collection, ...config }) as any,
				manyToMany: (collection, config) =>
					({ type: "manyToMany", collection, ...config }) as any,
				polymorphic: (config) =>
					({ type: "polymorphic", collection: "", ...config }) as any,
			};

			state.relations = this.relationsFn?.({
				table: this.table as any,
				i18n: i18nAccessor,
				...helpers,
			}) as TState["relations"];
		}

		// Execute title function to set initial state (if needed for type inference)
		if (titleFn) {
			const context = {
				defaultLocale: (this.state.options as any).defaultLocale || "en",
			};
			const i18nAccessor = this.createI18nAccessor(context);
			state.title = titleFn(
				this.table,
				i18nAccessor,
				context,
			) as TState["title"];
		}

		// Type inference helper (empty runtime object, types only)
		this.$infer = {} as any;
	}

	/**
	 * Get virtual fields with specific context
	 * This allows regenerating virtual field SQL with runtime context
	 */
	public getVirtuals(context: any): TState["virtuals"] {
		if (!this.virtualsFn) return this.state.virtuals;
		const i18nAccessor = this.createI18nAccessor(context);
		return this.virtualsFn(this.table, i18nAccessor, context);
	}

	/**
	 * Get title expression with specific context
	 */
	public getTitle(context: any): TState["title"] {
		if (!this.titleFn) return this.state.title;
		const i18nAccessor = this.createI18nAccessor(context);
		return this.titleFn(this.table, i18nAccessor, context);
	}

	/**
	 * Get raw title expression (for UPDATE queries) without COALESCE
	 */
	public getRawTitle(context: any): TState["title"] {
		if (!this.titleFn) return this.state.title;
		const i18nAccessor = this.createRawI18nAccessor();
		return this.titleFn(this.table, i18nAccessor, context);
	}

	/**
	 * Generate the main Drizzle table
	 */
	private generateMainTable(
		indexesFn?: (table: any) => TState["indexes"],
		_titleFn?: (table: any, i18n: any, context: any) => TState["title"],
	): PgTable {
		const tableName = this.state.options.tableName || this.state.name;
		const columns: Record<string, any> = {
			id: uuid("id").primaryKey().default(sql`uuidv7()`),
		};

		// Add non-localized fields
		for (const [fieldName, column] of Object.entries(this.state.fields)) {
			// Skip localized fields
			if (this.state.localized.includes(fieldName as any)) continue;

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
				Object.assign(constraints, indexesFn(t));
			}

			// Auto-index on deletedAt for soft delete
			if (this.state.options.softDelete) {
				constraints[`${tableName}_deleted_at_idx`] = index().on(
					(t as any).deletedAt,
				);
			}

			return constraints;
		});

		return table;
	}

	/**
	 * Generate the i18n table for localized fields
	 */
	private generateI18nTable(): PgTable | null {
		if (this.state.localized.length === 0) return null;

		const tableName = `${this.state.options.tableName || this.state.name}_i18n`;
		const columns: Record<string, any> = {
			id: uuid("id").primaryKey().default(sql`uuidv7()`),
			parentId: uuid("parent_id")
				.notNull()
				.references(() => (this.table as any).id, { onDelete: "cascade" }),
			locale: text("locale").notNull(),
		};

		// Add localized fields
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

	/**
	 * Generate the versions table
	 */
	private generateVersionsTable(): PgTable | null {
		const versioning = this.state.options.versioning;
		if (!versioning) return null;
		if (typeof versioning === "object" && !versioning.enabled) return null;

		const tableName = `${this.state.options.tableName || this.state.name}_versions`;

		return pgTable(
			tableName,
			{
				id: uuid("id").primaryKey().default(sql`uuidv7()`),
				parentId: uuid("parent_id").notNull(),
				version: integer("version").notNull(),
				operation: text("operation").notNull(), // 'create' | 'update' | 'delete'
				data: jsonb("data").notNull(),
				userId: text("user_id"), // Nullable if unknown
				createdAt: timestamp("created_at", { mode: "date" })
					.defaultNow()
					.notNull(),
			},
			(t) => ({
				parentVersionIdx: index().on(t.parentId, t.version),
				createdAtIdx: index().on(t.createdAt),
			}),
		);
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
		const defaultLocale = context?.defaultLocale || "en";

		if (!i18nTable) return accessor;

		for (const fieldName of this.state.localized) {
			// COALESCE(
			//   1. Value from the main LEFT JOIN (filtered by current locale in CRUD generator)
			//   2. Fallback subquery for default locale
			// )
			const i18nRef = i18nTable as any;
			accessor[fieldName] = sql`COALESCE(
				${i18nRef[fieldName]},
				(SELECT ${i18nRef[fieldName]} FROM ${i18nTable}
				 WHERE ${i18nRef.parentId} = ${(table as any).id}
				 AND ${i18nRef.locale} = ${defaultLocale} LIMIT 1)
			)`;
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

		for (const fieldName of this.state.localized) {
			accessor[fieldName] = (i18nTable as any)[fieldName];
		}

		return accessor;
	}

	private createI18nAccessor(
		context: any,
	): I18nFieldAccessor<TState["fields"], TState["localized"]> {
		return this.createI18nAccessorFor(this.table, this.i18nTable, context);
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
			db,
			this.getVirtuals.bind(this),
			this.getTitle.bind(this),
			this.getRawTitle.bind(this),
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
		return {
			name: this.state.name,
			fields: Object.entries(this.state.fields).map(([name, column]) => ({
				name,
				column,
				localized: this.state.localized.includes(name as any),
				virtual: name in this.state.virtuals,
			})),
			hasTitle: !!this.state.title,
			timestamps: this.state.options.timestamps !== false,
			softDelete: this.state.options.softDelete || false,
			virtualFields: Object.keys(this.state.virtuals),
			localizedFields: Array.from(this.state.localized),
			relations: Object.keys(this.state.relations),
		};
	}
}
