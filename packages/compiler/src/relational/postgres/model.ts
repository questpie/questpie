import type {
	CollectionIdentity,
	FieldIdentity,
	ScalarCodecV1,
} from "../types";

type RecordValue = Readonly<Record<string, unknown>>;

export interface PostgresField {
	readonly identity: FieldIdentity;
	readonly collection: CollectionIdentity;
	readonly path: readonly string[];
	readonly postgresName: string;
	readonly nullable: boolean;
	readonly codec: ScalarCodecV1;
	readonly defaultValue:
		| null
		| Readonly<{ kind: "literal"; value: boolean | number | string }>
		| Readonly<{ kind: "now" | "randomUuid" }>;
}

export interface PostgresRelation {
	readonly identity: `collection:${string}/relation:${string}`;
	readonly source: CollectionIdentity;
	readonly target: CollectionIdentity;
	readonly fields: readonly FieldIdentity[];
	readonly references: readonly FieldIdentity[];
}

export interface PostgresCollection {
	readonly identity: CollectionIdentity;
	readonly postgresName: string;
	readonly fields: ReadonlyMap<FieldIdentity, PostgresField>;
	readonly fieldsByPath: ReadonlyMap<string, PostgresField>;
	readonly primaryKey: readonly FieldIdentity[];
	readonly relations: ReadonlyMap<string, PostgresRelation>;
}

export interface PostgresCatalog {
	readonly schemaName: string;
	readonly collections: ReadonlyMap<CollectionIdentity, PostgresCollection>;
	readonly fields: ReadonlyMap<FieldIdentity, PostgresField>;
	readonly relations: ReadonlyMap<string, PostgresRelation>;
}

function record(value: unknown, label: string): RecordValue {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new TypeError(`${label} must be an object`);
	return value as RecordValue;
}

function string(value: unknown, label: string): string {
	if (typeof value !== "string" || value.length === 0)
		throw new TypeError(`${label} must be a non-empty string`);
	return value;
}

function items(value: unknown, label: string): readonly unknown[] {
	if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
	return value;
}

export function quoteIdentifier(value: string): string {
	return `"${value.replaceAll('"', '""')}"`;
}

export function qualifiedTable(
	catalog: PostgresCatalog,
	collection: PostgresCollection,
): string {
	return `${quoteIdentifier(catalog.schemaName)}.${quoteIdentifier(collection.postgresName)}`;
}

export function fieldValueSql(field: PostgresField, alias: string): string {
	const column = `${quoteIdentifier(alias)}.${quoteIdentifier(field.postgresName)}`;
	return field.codec.kind === "timestamp"
		? `pg_catalog.date_trunc('milliseconds', ${column})`
		: column;
}

export function postgresType(
	codec: Readonly<{ kind: string; withTimezone?: boolean }>,
): string {
	switch (codec.kind) {
		case "uuid":
			return "uuid";
		case "boolean":
			return "boolean";
		case "integer":
			return "integer";
		case "bigint":
			return "bigint";
		case "numeric":
			return "numeric";
		case "timestamp":
			return codec.withTimezone === true ? "timestamptz" : "timestamp";
		case "date":
			return "date";
		default:
			return "text";
	}
}

export function buildPostgresCatalog(schema: unknown): PostgresCatalog {
	const projection = record(schema, "Schema Projection");
	const application = record(projection.application, "Schema application");
	const schemaName = string(application.postgresSchema, "PostgreSQL schema");
	const fields = new Map<FieldIdentity, PostgresField>();
	const relations = new Map<string, PostgresRelation>();
	const collections = new Map<CollectionIdentity, PostgresCollection>();

	for (const rawCollection of items(
		projection.collections,
		"Schema Collections",
	)) {
		const value = record(rawCollection, "Schema Collection");
		const identity = string(
			value.identity,
			"Collection identity",
		) as CollectionIdentity;
		const collectionFields = new Map<FieldIdentity, PostgresField>();
		const fieldsByPath = new Map<string, PostgresField>();
		for (const rawField of items(value.fields, `${identity} Fields`)) {
			const fieldValue = record(rawField, "Schema Field");
			const fieldIdentity = string(
				fieldValue.identity,
				"Field identity",
			) as FieldIdentity;
			const path = items(
				fieldValue.path ?? [fieldIdentity.split("/field:")[1]],
				"Field path",
			).map((segment) => string(segment, "Field path segment"));
			const field: PostgresField = {
				identity: fieldIdentity,
				collection: identity,
				path,
				postgresName: string(fieldValue.postgresName, "Field PostgreSQL name"),
				nullable: fieldValue.nullable === true,
				codec: record(fieldValue.type, "Field codec") as ScalarCodecV1,
				defaultValue: (fieldValue.default ??
					null) as PostgresField["defaultValue"],
			};
			collectionFields.set(field.identity, field);
			fieldsByPath.set(JSON.stringify(path), field);
			fields.set(field.identity, field);
		}
		const collectionRelations = new Map<string, PostgresRelation>();
		const primaryConstraints = items(
			value.constraints ?? [],
			`${identity} Constraints`,
		)
			.map((constraint) => record(constraint, "Schema Constraint"))
			.filter((constraint) => constraint.kind === "primaryKey");
		if (primaryConstraints.length > 1)
			throw new TypeError(`${identity} has multiple primary keys`);
		const primaryKey = primaryConstraints.flatMap((constraint) =>
			items(constraint.fields, "Primary key Fields").map(
				(field) => string(field, "Primary key Field") as FieldIdentity,
			),
		);
		for (const rawRelation of items(
			value.relations ?? [],
			`${identity} Relations`,
		)) {
			const relationValue = record(rawRelation, "Schema Relation");
			if (relationValue.kind !== "toOne") continue;
			const relation: PostgresRelation = {
				identity: string(
					relationValue.identity,
					"Relation identity",
				) as PostgresRelation["identity"],
				source: identity,
				target: string(
					relationValue.target,
					"Relation target",
				) as CollectionIdentity,
				fields: items(relationValue.fields, "Relation Fields").map(
					(item) => string(item, "Relation Field") as FieldIdentity,
				),
				references: items(relationValue.references, "Relation references").map(
					(item) => string(item, "Relation reference") as FieldIdentity,
				),
			};
			collectionRelations.set(relation.identity, relation);
			relations.set(relation.identity, relation);
		}
		collections.set(identity, {
			identity,
			postgresName: string(value.postgresName, "Collection PostgreSQL name"),
			fields: collectionFields,
			fieldsByPath,
			primaryKey,
			relations: collectionRelations,
		});
	}
	return { schemaName, collections, fields, relations };
}

export function requiredCollection(
	catalog: PostgresCatalog,
	identity: CollectionIdentity,
): PostgresCollection {
	const collection = catalog.collections.get(identity);
	if (!collection) throw new TypeError(`unknown Collection ${identity}`);
	return collection;
}

export function requiredField(
	catalog: PostgresCatalog,
	identity: FieldIdentity,
): PostgresField {
	const field = catalog.fields.get(identity);
	if (!field) throw new TypeError(`unknown Field ${identity}`);
	return field;
}

export function fieldAtPath(
	catalog: PostgresCatalog,
	collection: CollectionIdentity,
	path: readonly string[],
): PostgresField {
	const field = requiredCollection(catalog, collection).fieldsByPath.get(
		JSON.stringify(path),
	);
	if (!field)
		throw new TypeError(`unknown Field path ${collection}/${path.join(".")}`);
	return field;
}
