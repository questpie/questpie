import { CompilerDiagnosticError } from "../diagnostic";

type JsonRecord = Readonly<Record<string, unknown>>;

function fail(message: string): never {
	throw new CompilerDiagnosticError("QP-SCHEMA-028", "invalidObject", message);
}

export function physicalType(field: JsonRecord): string {
	const type = field.type as JsonRecord;
	switch (type.kind) {
		case "uuid":
			return "uuid";
		case "text":
			return "text";
		case "boolean":
			return "bool";
		case "integer":
			return "int4";
		case "bigint":
			return "int8";
		case "numeric":
			return "numeric";
		case "timestamp":
			return type.withTimezone === true ? "timestamptz" : "timestamp";
		case "date":
			return "date";
		case "object":
		case "array":
		case "json":
			return "jsonb";
		default:
			return fail(`unsupported expected Field type ${String(type.kind)}`);
	}
}

export function expectedDefault(field: JsonRecord): string | null {
	if (field.default === null) return null;
	const value = field.default as JsonRecord;
	if (value.kind === "randomUuid") return "gen_random_uuid()";
	if (value.kind === "now") return "now()";
	if (value.kind === "literal") {
		const type = field.type as JsonRecord;
		if (type.kind === "text")
			return `'${String(value.value).replaceAll("'", "''")}'::text`;
		return String(value.value);
	}
	return fail(`unsupported expected default ${String(value.kind)}`);
}

export function fingerprintType(field: JsonRecord): JsonRecord {
	const type = field.type as JsonRecord;
	if (type.kind === "numeric")
		return {
			kind: "numeric",
			precision: type.precision,
			scale: type.scale,
		};
	if (type.kind === "timestamp")
		return { kind: "timestamp", withTimezone: type.withTimezone === true };
	if (type.kind === "object" || type.kind === "array" || type.kind === "json")
		return { kind: "jsonb" };
	return { kind: type.kind };
}

export function dependencyName(type: JsonRecord): string {
	if (type.kind === "object" || type.kind === "array" || type.kind === "json")
		return "jsonb";
	if (type.kind === "boolean") return "bool";
	if (type.kind === "integer") return "int4";
	if (type.kind === "bigint") return "int8";
	if (type.kind === "timestamp")
		return type.withTimezone === true ? "timestamptz" : "timestamp";
	return String(type.kind);
}

export function operatorClass(type: JsonRecord): string {
	return `${dependencyName(type)}_ops`;
}
