import { compareAscii, digest } from "../../canonical";
import type { ScalarCodecV1 } from "../types";

type RecordValue = Readonly<Record<string, unknown>>;

const POSTGRES_MAX_TARGET_COLUMNS = 1_664;
const MAX_CONTEXT_BOOTSTRAP_FIELDS = POSTGRES_MAX_TARGET_COLUMNS / 2;

function record(value: unknown, label: string): RecordValue {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new TypeError(`${label} must be an object`);
	return value as RecordValue;
}

function array(value: unknown, label: string): readonly unknown[] {
	if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
	return value;
}

function text(value: unknown, label: string): string {
	if (typeof value !== "string" || value.length === 0)
		throw new TypeError(`${label} must be text`);
	return value;
}

function quote(value: string): string {
	return `"${value.replaceAll('"', '""')}"`;
}

function supportedCodec(value: unknown): ScalarCodecV1 | null {
	const codec = record(value, "ContextBootstrap codec") as ScalarCodecV1;
	return ["uuid", "text", "boolean", "integer", "timestamp"].includes(
		codec.kind,
	)
		? codec
		: null;
}

function postgresType(codec: ScalarCodecV1): string {
	if (codec.kind === "uuid") return "uuid";
	if (codec.kind === "boolean") return "bool";
	if (codec.kind === "integer") return "int4";
	if (codec.kind === "timestamp")
		return codec.withTimezone ? "timestamptz" : "timestamp";
	return "text";
}

export function projectPostgresContextBootstrapPlans(schema: unknown) {
	const projection = record(schema, "Schema Projection");
	const application = record(projection.application, "Schema application");
	const schemaName = text(application.postgresSchema, "PostgreSQL schema");
	const plans = array(projection.collections, "Schema Collections")
		.map((item) => {
			const collection = record(item, "Schema Collection");
			const collectionIdentity = text(
				collection.identity,
				"Collection identity",
			);
			const fields = array(collection.fields, "Collection Fields")
				.map((raw) => {
					const field = record(raw, "Schema Field");
					const path = array(field.path, "Field path");
					const codec = supportedCodec(field.type);
					if (
						path.length !== 1 ||
						typeof path[0] !== "string" ||
						codec === null
					)
						return null;
					return {
						field: text(field.identity, "Field identity"),
						key: path[0],
						postgresName: text(field.postgresName, "Field PostgreSQL name"),
						nullable: field.nullable === true,
						codec,
					};
				})
				.filter((field): field is NonNullable<typeof field> => field !== null)
				.sort((left, right) => compareAscii(left.key, right.key));
			const byIdentity = new Map(fields.map((field) => [field.field, field]));
			const primary = array(collection.constraints, "Collection Constraints")
				.map((constraint) => record(constraint, "Schema Constraint"))
				.filter((constraint) => constraint.kind === "primaryKey");
			if (primary.length !== 1) return null;
			const primaryFields = array(primary[0]!.fields, "Primary key Fields").map(
				(fieldIdentity) =>
					byIdentity.get(text(fieldIdentity, "Primary key Field")),
			);
			if (
				primaryFields.length === 0 ||
				primaryFields.some((field) => !field || field.nullable)
			)
				return null;
			const key = primaryFields.map((field, index) => {
				if (!field) throw new TypeError("unreachable primary key Field");
				return {
					field: field.field,
					key: field.key,
					codec: field.codec,
					nullable: false as const,
					postgresType: postgresType(field.codec),
					position: index + 1,
				};
			});
			const resultFields = fields.map((field, index) => ({
				field: field.field,
				key: field.key,
				codec: field.codec,
				nullable: field.nullable,
				selectionPosition: key.length + index + 1,
				selectedColumn: `qp_selected_${index}`,
				valueColumn: `qp_value_${index}`,
			}));
			if (
				fields.length > MAX_CONTEXT_BOOTSTRAP_FIELDS ||
				key.length + fields.length > POSTGRES_MAX_TARGET_COLUMNS
			)
				throw new RangeError(
					`${collectionIdentity} exceeds PostgreSQL ContextBootstrap statement bounds`,
				);
			const select = fields.flatMap((field, index) => {
				const position = key.length + index + 1;
				const selected = `$${position}::pg_catalog.bool`;
				return [
					`${selected} AS ${quote(`qp_selected_${index}`)}`,
					`CASE WHEN ${selected} THEN ${quote(field.postgresName)} ELSE NULL::pg_catalog.${postgresType(field.codec)} END AS ${quote(`qp_value_${index}`)}`,
				];
			});
			const where = key.map((parameter) => {
				const field = byIdentity.get(parameter.field)!;
				return `${quote(field.postgresName)} = $${parameter.position}::pg_catalog.${parameter.postgresType}`;
			});
			const unsigned = {
				format: "questpie.postgres-context-bootstrap-plan" as const,
				version: 1 as const,
				collection: collectionIdentity,
				sql: `SELECT\n  ${select.join(",\n  ")}\nFROM ${quote(schemaName)}.${quote(text(collection.postgresName, "Collection PostgreSQL name"))}\nWHERE ${where.join("\n  AND ")}\nLIMIT 1`,
				key,
				fields: resultFields,
			};
			return {
				...unsigned,
				digest: digest("questpie-postgres-context-bootstrap-plan-v1", unsigned),
			};
		})
		.filter((plan): plan is NonNullable<typeof plan> => plan !== null)
		.sort((left, right) => compareAscii(left.collection, right.collection));
	const unsigned = {
		format: "questpie.postgres-context-bootstrap-plans" as const,
		version: 1 as const,
		plans,
	};
	return Object.freeze({
		...unsigned,
		digest: digest("questpie-postgres-context-bootstrap-plans-v1", unsigned),
	});
}
