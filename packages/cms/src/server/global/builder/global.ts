import { Collection } from "#questpie/cms/server/collection/builder/collection";
import type {
	I18nFieldAccessor,
	InferSQLType,
	NonLocalizedFields,
	RelationVariant,
} from "#questpie/cms/server/collection/builder/types";
import type {
	GlobalBuilderRelationFn,
	GlobalBuilderState,
	InferGlobalTableWithColumns,
} from "#questpie/cms/server/global/builder/types";
import type {
	GetColumnData,
	InferInsertModel,
	InferSelectModel,
	SQL,
} from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import {
	index,
	integer,
	pgTable,
	text,
	timestamp,
	uuid,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { GlobalCRUDGenerator } from "../crud/global-crud-generator";
import type { GlobalCRUD } from "../crud/types";

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
		NonLocalizedFields<TState["fields"], TState["localized"]>,
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
				NonLocalizedFields<TState["fields"], TState["localized"]>,
				TState["options"]
			>,
			TState["fields"],
			TState["localized"],
			TState["virtuals"]
		>;
		insert: InferGlobalInsert<
			InferGlobalTableWithColumns<
				TState["name"],
				NonLocalizedFields<TState["fields"], TState["localized"]>,
				TState["options"]
			>,
			TState["fields"],
			TState["localized"]
		>;
		update: InferGlobalUpdate<
			InferGlobalTableWithColumns<
				TState["name"],
				NonLocalizedFields<TState["fields"], TState["localized"]>,
				TState["options"]
			>,
			TState["fields"],
			TState["localized"]
		>;
	};

	constructor(
		state: TState,
		private readonly virtualsFn?: (
			table: any,
			i18n: any,
			context: any,
		) => TState["virtuals"],
		private readonly relationsFn?: GlobalBuilderRelationFn<TState, any>,
	) {
		this.state = state;
		this.name = state.name;

		this.table = this.generateMainTable() as any;
		this.i18nTable = this.generateI18nTable() as any;
		this.versionsTable = this.generateVersionsTable();
		this.i18nVersionsTable = this.generateI18nVersionsTable();

		// Execute virtuals to populate state
		if (virtualsFn) {
			const context = {
				defaultLocale: "en", // Placeholder
			};
			const i18nAccessor = this.createI18nAccessor(context);
			state.virtuals = virtualsFn(
				this.table,
				i18nAccessor,
				context,
			) as TState["virtuals"];
		}

		// Execute relations
		if (relationsFn) {
			const context = { defaultLocale: "en" };
			const i18nAccessor = this.createI18nAccessor(context);
			const helpers: RelationVariant = {
				one: (collection, config) =>
					({ type: "one", collection, ...config }) as any,
				many: (collection, config) =>
					({ type: "many", collection, ...config }) as any,
				manyToMany: (collection, config) =>
					({ type: "manyToMany", collection, ...config }) as any,
			};
			state.relations = relationsFn({
				table: this.table as any,
				i18n: i18nAccessor,
				...helpers,
			});
		}

		this.$infer = {} as any;
	}

	public getVirtuals(context: any): TState["virtuals"] {
		if (!this.virtualsFn) return this.state.virtuals;
		const i18nAccessor = this.createI18nAccessor(context);
		return this.virtualsFn(this.table, i18nAccessor, context);
	}

	public getVirtualsForVersions(context: any): TState["virtuals"] {
		if (!this.virtualsFn || !this.versionsTable) return this.state.virtuals;
		const i18nAccessor = this.createI18nAccessorForVersions(
			this.versionsTable,
			this.i18nVersionsTable,
			context,
		);
		return this.virtualsFn(this.versionsTable, i18nAccessor, context);
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
		const columns: Record<string, any> = {
			id: uuid("id").primaryKey().default(sql`uuidv7()`),
		};

		for (const [fieldName, column] of Object.entries(this.state.fields)) {
			if (this.state.localized.includes(fieldName as any)) continue;
			columns[fieldName] = column;
		}

		if (this.state.options.timestamps !== false) {
			Object.assign(columns, Collection.timestampsCols());
		}

		return pgTable(tableName, columns as any);
	}

	private generateI18nTable(): PgTable | null {
		if (this.state.localized.length === 0) return null;

		const tableName = `${this.state.name}_i18n`;
		const columns: Record<string, any> = {
			id: uuid("id").primaryKey().default(sql`uuidv7()`),
			parentId: uuid("parent_id")
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
		const columns: Record<string, any> = {
			versionId: uuid("version_id").primaryKey().default(sql`uuidv7()`),
			id: uuid("id").notNull(),
			versionNumber: integer("version_number").notNull(),
			versionOperation: text("version_operation").notNull(),
			versionUserId: text("version_user_id"),
			versionCreatedAt: timestamp("version_created_at", { mode: "date" })
				.defaultNow()
				.notNull(),
		};

		for (const [fieldName, column] of Object.entries(this.state.fields)) {
			if (this.state.localized.includes(fieldName as any)) continue;
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
		const columns: Record<string, any> = {
			id: uuid("id").primaryKey().default(sql`uuidv7()`),
			parentId: uuid("parent_id").notNull(),
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
		const defaultLocale = context?.defaultLocale || "en";

		if (!this.i18nTable) return accessor;

		for (const fieldName of this.state.localized) {
			const i18nTable = this.i18nTable as any;
			accessor[fieldName] = sql`COALESCE(
                ${i18nTable[fieldName]},
                (SELECT ${i18nTable[fieldName]} FROM ${this.i18nTable}
                 WHERE ${i18nTable.parentId} = ${(this.table as any).id}
                 AND ${i18nTable.locale} = ${defaultLocale} LIMIT 1)
            )`;
		}

		return accessor;
	}

	private createI18nAccessorForVersions(
		table: any,
		i18nTable: any | null,
		context: any,
	): I18nFieldAccessor<TState["fields"], TState["localized"]> {
		const accessor: any = {};
		const defaultLocale = context?.defaultLocale || "en";

		if (!i18nTable) return accessor;

		for (const fieldName of this.state.localized) {
			const i18nRef = i18nTable as any;
			accessor[fieldName] = sql`COALESCE(
				${i18nRef[fieldName]},
				(SELECT ${i18nRef[fieldName]} FROM ${i18nTable}
				 WHERE ${i18nRef.parentId} = ${(table as any).id}
				 AND ${i18nRef.versionNumber} = ${(table as any).versionNumber}
				 AND ${i18nRef.locale} = ${defaultLocale} LIMIT 1)
			)`;
		}

		return accessor;
	}

	getMeta() {
		return {
			name: this.state.name,
			fields: Object.entries(this.state.fields).map(([name, column]) => ({
				name,
				column,
				localized: this.state.localized.includes(name as any),
				virtual: name in this.state.virtuals,
			})),
			isGlobal: true,
			timestamps: this.state.options.timestamps !== false,
			virtualFields: Object.keys(this.state.virtuals),
			localizedFields: Array.from(this.state.localized),
			relations: Object.keys(this.state.relations),
		};
	}
}
