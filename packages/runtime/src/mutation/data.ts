type QueryRows = readonly Readonly<Record<string, unknown>>[];

export type TransactionQuery = (
	statement: string,
	parameters?: readonly unknown[],
) => Promise<QueryRows>;

type Field = Readonly<{
	identity: string;
	path: readonly string[];
	postgresName: string;
}>;

type Collection = Readonly<{
	identity: string;
	name: string;
	postgresName: string;
	fields: ReadonlyMap<string, Field>;
	primaryKey: readonly string[];
}>;

function record(
	value: unknown,
	label: string,
): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new TypeError(`${label} must be an object`);
	return value as Readonly<Record<string, unknown>>;
}

function identifier(value: unknown, label: string): string {
	if (typeof value !== "string" || !/^[a-z_][a-z0-9_]*$/i.test(value))
		throw new TypeError(`${label} is not a safe PostgreSQL identifier`);
	return value;
}

function quote(value: string): string {
	return `"${value}"`;
}

function projectSchema(value: unknown) {
	const schema = record(value, "Schema Projection");
	const application = record(schema.application, "Schema Application");
	const postgresSchema = identifier(
		application.postgresSchema,
		"Schema Application postgresSchema",
	);
	if (!Array.isArray(schema.collections))
		throw new TypeError("Schema Projection collections must be an array");
	const collections = new Map<string, Collection>();
	for (const rawCollection of schema.collections) {
		const source = record(rawCollection, "Schema Collection");
		const identity = String(source.identity);
		if (!identity.startsWith("collection:"))
			throw new TypeError("Schema Collection identity is invalid");
		const name = identity.slice("collection:".length);
		if (!Array.isArray(source.fields) || !Array.isArray(source.constraints))
			throw new TypeError("Schema Collection shape is invalid");
		const fields = new Map<string, Field>();
		for (const rawField of source.fields) {
			const field = record(rawField, "Schema Field");
			if (
				!Array.isArray(field.path) ||
				field.path.length !== 1 ||
				typeof field.path[0] !== "string"
			)
				continue;
			fields.set(
				field.path[0],
				Object.freeze({
					identity: String(field.identity),
					path: Object.freeze([field.path[0]]),
					postgresName: identifier(
						field.postgresName,
						"Schema Field postgresName",
					),
				}),
			);
		}
		const primary = source.constraints
			.map((constraint) => record(constraint, "Schema Constraint"))
			.find((constraint) => constraint.kind === "primaryKey");
		if (!primary || !Array.isArray(primary.fields))
			throw new TypeError(`Schema Collection ${identity} has no primary key`);
		const primaryKey = primary.fields.map((fieldIdentity) => {
			const field = [...fields.values()].find(
				(candidate) => candidate.identity === fieldIdentity,
			);
			if (!field) throw new TypeError(`Schema primary key Field is missing`);
			return field.path[0]!;
		});
		collections.set(
			name,
			Object.freeze({
				identity,
				name,
				postgresName: identifier(
					source.postgresName,
					"Schema Collection postgresName",
				),
				fields,
				primaryKey: Object.freeze(primaryKey),
			}),
		);
	}
	return Object.freeze({ postgresSchema, collections });
}

function exactFields(
	collection: Collection,
	value: unknown,
	label: string,
): Readonly<Record<string, unknown>> {
	const input = record(value, label);
	if (Object.keys(input).some((key) => !collection.fields.has(key)))
		throw new TypeError(`${label} contains an unknown Field`);
	return input;
}

function selectedFields(
	collection: Collection,
	value: unknown,
): readonly Field[] {
	const select = exactFields(collection, value, "Mutation selection");
	const names = Object.keys(select).sort();
	if (names.length === 0 || names.some((name) => select[name] !== true))
		throw new TypeError("Mutation selection must contain true Field members");
	return names.map((name) => collection.fields.get(name)!);
}

function selectedRow(
	fields: readonly Field[],
	row: Readonly<Record<string, unknown>>,
) {
	return Object.freeze(
		Object.fromEntries(
			fields.map((field) => [field.path[0], row[field.path[0]!]]),
		),
	);
}

export function createPostgresMutationData(
	input: Readonly<{
		schema: unknown;
		query: TransactionQuery;
		onCreate(collection: string, key: Readonly<Record<string, unknown>>): void;
	}>,
) {
	const schema = projectSchema(input.schema);
	return Object.freeze(
		Object.fromEntries(
			[...schema.collections.entries()].map(([name, collection]) => [
				name,
				Object.freeze({
					get: async (request: Readonly<{ key: unknown; select: unknown }>) => {
						const key = exactFields(collection, request.key, "Mutation key");
						const keyNames = Object.keys(key).sort();
						if (
							keyNames.length !== collection.primaryKey.length ||
							collection.primaryKey.some((field) => !Object.hasOwn(key, field))
						)
							throw new TypeError("Mutation key must be the exact primary key");
						const selected = selectedFields(collection, request.select);
						const rows = await input.query(
							`SELECT ${selected.map((field) => `${quote(field.postgresName)} AS ${quote(field.path[0]!)}`).join(", ")} FROM ${quote(schema.postgresSchema)}.${quote(collection.postgresName)} WHERE ${collection.primaryKey.map((field, index) => `${quote(collection.fields.get(field)!.postgresName)} = $${index + 1}`).join(" AND ")} FOR UPDATE`,
							collection.primaryKey.map((field) => key[field]),
						);
						if (rows.length > 1)
							throw new TypeError("Mutation key is not unique");
						return rows[0] ? selectedRow(selected, rows[0]) : null;
					},
					create: async (
						request: Readonly<{ input: unknown; select: unknown }>,
					) => {
						const values = exactFields(
							collection,
							request.input,
							"Mutation create input",
						);
						const names = Object.keys(values).sort();
						if (names.length === 0)
							throw new TypeError("Mutation create input must not be empty");
						const selected = selectedFields(collection, request.select);
						const rows = await input.query(
							`INSERT INTO ${quote(schema.postgresSchema)}.${quote(collection.postgresName)} (${names.map((name) => quote(collection.fields.get(name)!.postgresName)).join(", ")}) VALUES (${names.map((_, index) => `$${index + 1}`).join(", ")}) RETURNING ${selected.map((field) => `${quote(field.postgresName)} AS ${quote(field.path[0]!)}`).join(", ")}`,
							names.map((name) => values[name]),
						);
						if (rows.length !== 1)
							throw new TypeError("Mutation create returned no row");
						const key = Object.fromEntries(
							collection.primaryKey.map((field) => [
								field,
								values[field] ?? rows[0]?.[field],
							]),
						);
						input.onCreate(collection.name, Object.freeze(key));
						return selectedRow(selected, rows[0]!);
					},
				}),
			]),
		),
	);
}
