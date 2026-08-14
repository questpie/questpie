import { CompilerDiagnosticError } from "../diagnostic";

type JsonRecord = Readonly<Record<string, unknown>>;

function fail(
	code: ConstructorParameters<typeof CompilerDiagnosticError>[0],
	diagnosticClass: string,
	message: string,
): never {
	throw new CompilerDiagnosticError(code, diagnosticClass, message);
}

function fieldFor(collection: JsonRecord, identity: string): JsonRecord {
	const fields = collection.fields;
	const field = Array.isArray(fields)
		? (fields as readonly JsonRecord[]).find(
				(candidate) => candidate.identity === identity,
			)
		: null;
	if (!field)
		return fail(
			"QP-SCHEMA-003",
			"invalidReference",
			`unknown Field ${identity}`,
		);
	return field;
}

export function renderPostgresType(field: JsonRecord): string {
	const type = field.type as JsonRecord;
	switch (type.kind) {
		case "uuid":
			return "pg_catalog.uuid";
		case "text":
			return 'pg_catalog.text COLLATE pg_catalog."C"';
		case "boolean":
			return "pg_catalog.bool";
		case "integer":
			return "pg_catalog.int4";
		case "bigint":
			return "pg_catalog.int8";
		case "numeric":
			return `pg_catalog.numeric(${type.precision}, ${type.scale})`;
		case "timestamp":
			return type.withTimezone === true
				? "pg_catalog.timestamptz"
				: "pg_catalog.timestamp";
		case "date":
			return "pg_catalog.date";
		case "object":
		case "array":
		case "json":
			return "pg_catalog.jsonb";
		default:
			return fail(
				"QP-SCHEMA-031",
				"nonTransactionalDdl",
				`unsupported Field type ${String(type.kind)}`,
			);
	}
}

export function renderPostgresDefault(value: unknown): string {
	if (value === null) return "";
	const normalized = value as JsonRecord;
	if (normalized.kind === "randomUuid")
		return " DEFAULT pg_catalog.gen_random_uuid()";
	if (normalized.kind === "now") return " DEFAULT pg_catalog.now()";
	if (normalized.kind === "literal") {
		if (normalized.value === null) return " DEFAULT NULL";
		if (typeof normalized.value === "boolean")
			return ` DEFAULT ${normalized.value ? "TRUE" : "FALSE"}`;
		if (typeof normalized.value === "number")
			return ` DEFAULT ${normalized.value}`;
		return ` DEFAULT '${String(normalized.value).replaceAll("'", "''")}'`;
	}
	return fail("QP-SCHEMA-031", "nonTransactionalDdl", "unsupported default");
}

export function renderPostgresCheck(
	expression: JsonRecord,
	collection: JsonRecord,
): string {
	if (expression.kind === "field")
		return `"${String(fieldFor(collection, String(expression.field)).postgresName).replaceAll('"', '""')}"`;
	if (expression.kind === "literal") {
		if (expression.value === null) return "NULL";
		if (typeof expression.value === "boolean")
			return expression.value ? "TRUE" : "FALSE";
		if (typeof expression.value === "number") return String(expression.value);
		return `'${String(expression.value).replaceAll("'", "''")}'`;
	}
	if (expression.kind === "textLength")
		return `pg_catalog.char_length(${renderPostgresCheck(expression.expression as JsonRecord, collection)})`;
	if (expression.kind === "compare") {
		const operators: Readonly<Record<string, string>> = {
			equal: "=",
			notEqual: "<>",
			lessThan: "<",
			lessThanOrEqual: "<=",
			greaterThan: ">",
			greaterThanOrEqual: ">=",
		};
		const operator = operators[String(expression.operator)];
		if (!operator)
			return fail(
				"QP-SCHEMA-031",
				"nonTransactionalDdl",
				`unsupported check operator ${String(expression.operator)}`,
			);
		const left = expression.left as JsonRecord;
		const right = expression.right as JsonRecord;
		const leftField =
			left.kind === "field" ? fieldFor(collection, String(left.field)) : null;
		const rightSql =
			(leftField?.type as JsonRecord | undefined)?.kind === "bigint" &&
			right.kind === "literal" &&
			typeof right.value === "string"
				? `CAST('${right.value.replaceAll("'", "''")}' AS pg_catalog.int8)`
				: renderPostgresCheck(right, collection);
		return `(${renderPostgresCheck(left, collection)} ${operator} ${rightSql})`;
	}
	return fail(
		"QP-SCHEMA-031",
		"nonTransactionalDdl",
		`unsupported check expression ${String(expression.kind)}`,
	);
}
