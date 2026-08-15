import type { SQL } from "bun";

import { canonicalBytes, compareAscii } from "../../canonical";
import type { SchemaProjectionV1 } from "../contracts";
import {
	dependencyName,
	fingerprintType,
	operatorClass,
} from "../postgres-catalog";
import { childRecords, fail } from "./shared";

type JsonRecord = Readonly<Record<string, unknown>>;

function physicalFieldName(collection: JsonRecord, identity: string): string {
	const field = childRecords(collection, "fields").find(
		(candidate) => candidate.identity === identity,
	);
	if (!field)
		return fail(
			"QP-SCHEMA-028",
			"invalidObject",
			`unknown fingerprint Field ${identity}`,
		);
	return String(field.postgresName);
}

function fingerprintCheckExpression(
	expression: JsonRecord,
	collection: JsonRecord,
): JsonRecord {
	if (expression.kind === "field")
		return {
			kind: "field",
			field: physicalFieldName(collection, String(expression.field)),
		};
	if (expression.kind === "literal")
		return { kind: "literal", value: expression.value };
	if (expression.kind === "textLength")
		return {
			kind: "textLength",
			expression: fingerprintCheckExpression(
				expression.expression as JsonRecord,
				collection,
			),
		};
	if (expression.kind === "compare")
		return {
			kind: "compare",
			operator: expression.operator,
			left: fingerprintCheckExpression(
				expression.left as JsonRecord,
				collection,
			),
			right: fingerprintCheckExpression(
				expression.right as JsonRecord,
				collection,
			),
		};
	if (expression.kind === "and" || expression.kind === "or")
		return {
			kind: expression.kind,
			expressions: (expression.expressions as readonly JsonRecord[]).map(
				(item) => fingerprintCheckExpression(item, collection),
			),
		};
	if (
		expression.kind === "not" ||
		expression.kind === "isNull" ||
		expression.kind === "isNotNull"
	)
		return {
			kind: expression.kind,
			expression: fingerprintCheckExpression(
				expression.expression as JsonRecord,
				collection,
			),
		};
	return fail(
		"QP-SCHEMA-028",
		"invalidObject",
		`unsupported fingerprint check ${String(expression.kind)}`,
	);
}

export function expectedComparable(schema: SchemaProjectionV1): JsonRecord {
	const applicationSchemaExists = schema.collections.length > 0;
	const objects: JsonRecord[] = applicationSchemaExists
		? [{ kind: "schema", name: schema.application.postgresSchema }]
		: [];
	const dependencies = new Map<string, JsonRecord>();
	const addDependency = (value: JsonRecord) =>
		dependencies.set(canonicalBytes(value), value);
	for (const collection of schema.collections) {
		objects.push({
			kind: "table",
			name: collection.postgresName,
			persistence: "permanent",
			rowSecurityEnabled: false,
			rowSecurityForced: false,
		});
		for (const field of childRecords(collection, "fields")) {
			const type = field.type as JsonRecord;
			objects.push({
				kind: "column",
				table: collection.postgresName,
				name: field.postgresName,
				type: fingerprintType(field),
				nullable: field.nullable,
				default: field.default,
				identity: "none",
				generated: "none",
				collation:
					field.collation === "questpie.binary" ? "pg_catalog.C" : null,
			});
			addDependency({
				kind: "type",
				schema: "pg_catalog",
				name: dependencyName(type),
				extension: null,
			});
			if (field.collation === "questpie.binary")
				addDependency({
					kind: "collation",
					schema: "pg_catalog",
					name: "C",
					extension: null,
				});
			const defaultValue = field.default as JsonRecord | null;
			if (defaultValue?.kind === "randomUuid" || defaultValue?.kind === "now")
				addDependency({
					kind: "defaultFunction",
					schema: "pg_catalog",
					name: defaultValue.kind === "randomUuid" ? "gen_random_uuid" : "now",
					extension: null,
				});
		}
		for (const constraint of childRecords(collection, "constraints"))
			objects.push(
				constraint.kind === "check"
					? {
							kind: "check",
							table: collection.postgresName,
							name: constraint.postgresName,
							expression: fingerprintCheckExpression(
								constraint.expression as JsonRecord,
								collection,
							),
							validated: true,
						}
					: {
							kind: constraint.kind,
							table: collection.postgresName,
							name: constraint.postgresName,
							fields: (constraint.fields as readonly string[]).map((identity) =>
								physicalFieldName(collection, identity),
							),
							validated: true,
							deferrable: false,
							initiallyDeferred: false,
						},
			);
		for (const relation of childRecords(collection, "relations")) {
			const target = schema.collections.find(
				(item) => item.identity === relation.target,
			);
			if (!target)
				return fail(
					"QP-SCHEMA-028",
					"invalidObject",
					`unknown fingerprint Relation target ${String(relation.target)}`,
				);
			objects.push({
				kind: "foreignKey",
				table: collection.postgresName,
				name: relation.constraintPostgresName,
				fields: (relation.fields as readonly string[]).map((identity) =>
					physicalFieldName(collection, identity),
				),
				referencedTable: target.postgresName,
				referencedFields: (relation.references as readonly string[]).map(
					(identity) => physicalFieldName(target, identity),
				),
				onDelete: relation.onDelete,
				onUpdate: relation.onUpdate,
				validated: true,
				deferrable: false,
				initiallyDeferred: false,
			});
		}
		for (const index of childRecords(collection, "indexes")) {
			objects.push({
				kind: "index",
				table: collection.postgresName,
				name: index.postgresName,
				method: "btree",
				unique: false,
				fields: (index.fields as readonly JsonRecord[]).map((entry) => ({
					field: physicalFieldName(collection, String(entry.field)),
					order: entry.order,
					nulls: entry.nulls,
					operatorClass: "typeDefault",
					collation: entry.collation,
				})),
				predicate: null,
				valid: true,
				ready: true,
			});
			for (const entry of index.fields as readonly JsonRecord[]) {
				const field = childRecords(collection, "fields").find(
					(item) => item.identity === entry.field,
				);
				if (field)
					addDependency({
						kind: "operatorClass",
						schema: "pg_catalog",
						name: operatorClass(field.type as JsonRecord),
						extension: null,
					});
			}
		}
		for (const constraint of childRecords(collection, "constraints"))
			if (constraint.kind === "primaryKey" || constraint.kind === "unique")
				for (const identity of constraint.fields as readonly string[]) {
					const field = childRecords(collection, "fields").find(
						(item) => item.identity === identity,
					);
					if (field)
						addDependency({
							kind: "operatorClass",
							schema: "pg_catalog",
							name: operatorClass(field.type as JsonRecord),
							extension: null,
						});
				}
	}
	return {
		application: schema.application.name,
		applicationSchema: schema.application.postgresSchema,
		applicationSchemaExists,
		objects: objects.sort((left, right) =>
			compareAscii(canonicalBytes(left), canonicalBytes(right)),
		),
		unsupportedObjects: [],
		externalDependencies: [...dependencies.values()].sort((left, right) =>
			compareAscii(canonicalBytes(left), canonicalBytes(right)),
		),
		installedRequiredExtensions: schema.requiredPostgres.extensions.map(
			(extension) => extension.name,
		),
	};
}

type QuotePostgresIdentifier = (name: string) => string;

export async function postgresIdentifierQuoter(
	sql: SQL,
): Promise<QuotePostgresIdentifier> {
	const keywords = await sql<{ quoted: string; word: string }[]>`
		select pg_catalog.quote_ident(word) as quoted, word
		from pg_catalog.pg_get_keywords()
		where pg_catalog.quote_ident(word) <> word
	`;
	const quoted = new Map(
		keywords.map((keyword) => [keyword.word, keyword.quoted]),
	);
	return (name) => quoted.get(name) ?? name;
}

function renderFingerprintExpression(
	expression: JsonRecord,
	quoteIdentifier: QuotePostgresIdentifier,
	collection?: JsonRecord,
	literalType?: string,
): string {
	if (expression.kind === "field")
		return quoteIdentifier(
			collection
				? physicalFieldName(collection, String(expression.field))
				: String(expression.field),
		);
	if (expression.kind === "literal") {
		if (expression.value === null) return "NULL";
		if (typeof expression.value === "boolean")
			return expression.value ? "true" : "false";
		if (typeof expression.value === "number") return String(expression.value);
		return `'${String(expression.value).replaceAll("'", "''")}'::${literalType === "bigint" ? "bigint" : "text"}`;
	}
	if (expression.kind === "textLength")
		return `char_length(${renderFingerprintExpression(expression.expression as JsonRecord, quoteIdentifier, collection)})`;
	if (expression.kind === "compare") {
		const operators: Readonly<Record<string, string>> = {
			equal: "=",
			notEqual: "<>",
			lessThan: "<",
			lessThanOrEqual: "<=",
			greaterThan: ">",
			greaterThanOrEqual: ">=",
		};
		const left = expression.left as JsonRecord;
		const leftField =
			collection && left.kind === "field"
				? childRecords(collection, "fields").find(
						(field) => field.identity === left.field,
					)
				: undefined;
		const leftType = (leftField?.type as JsonRecord | undefined)?.kind;
		return `${renderFingerprintExpression(left, quoteIdentifier, collection)} ${operators[String(expression.operator)]} ${renderFingerprintExpression(expression.right as JsonRecord, quoteIdentifier, collection, typeof leftType === "string" ? leftType : undefined)}`;
	}
	if (expression.kind === "and" || expression.kind === "or")
		return (expression.expressions as readonly JsonRecord[])
			.map(
				(item) =>
					`(${renderFingerprintExpression(item, quoteIdentifier, collection)})`,
			)
			.join(expression.kind === "and" ? " AND " : " OR ");
	if (expression.kind === "not")
		return `NOT (${renderFingerprintExpression(expression.expression as JsonRecord, quoteIdentifier, collection)})`;
	if (expression.kind === "isNull" || expression.kind === "isNotNull")
		return `${renderFingerprintExpression(expression.expression as JsonRecord, quoteIdentifier, collection)} IS ${expression.kind === "isNull" ? "NULL" : "NOT NULL"}`;
	return fail(
		"QP-SCHEMA-028",
		"invalidObject",
		`unsupported fingerprint expression ${String(expression.kind)}`,
	);
}

export function expectedConstraintDefinition(
	object: JsonRecord,
	schemaName: string,
	quoteIdentifier: QuotePostgresIdentifier,
	collection: JsonRecord,
): string {
	if (object.kind === "primaryKey")
		return `PRIMARY KEY (${(object.fields as readonly string[]).map(quoteIdentifier).join(", ")})`;
	if (object.kind === "unique")
		return `UNIQUE (${(object.fields as readonly string[]).map(quoteIdentifier).join(", ")})`;
	if (object.kind === "check") {
		const semanticConstraint = childRecords(collection, "constraints").find(
			(constraint) => constraint.postgresName === object.name,
		);
		if (!semanticConstraint)
			return fail(
				"QP-SCHEMA-028",
				"invalidObject",
				`unknown semantic Constraint ${String(object.name)}`,
			);
		return `CHECK (${renderFingerprintExpression(semanticConstraint.expression as JsonRecord, quoteIdentifier, collection)})`;
	}
	if (object.kind === "foreignKey") {
		const action = (value: unknown) =>
			String(value)
				.replace(/([a-z])([A-Z])/g, "$1 $2")
				.toUpperCase();
		const clause = (kind: "UPDATE" | "DELETE", value: unknown) =>
			value === "noAction" ? "" : ` ON ${kind} ${action(value)}`;
		return `FOREIGN KEY (${(object.fields as readonly string[]).map(quoteIdentifier).join(", ")}) REFERENCES ${quoteIdentifier(schemaName)}.${quoteIdentifier(String(object.referencedTable))}(${(object.referencedFields as readonly string[]).map(quoteIdentifier).join(", ")})${clause("UPDATE", object.onUpdate)}${clause("DELETE", object.onDelete)}`;
	}
	return fail(
		"QP-SCHEMA-028",
		"invalidObject",
		`unsupported expected Constraint ${String(object.kind)}`,
	);
}

export function expectedIndexDefinition(
	object: JsonRecord,
	schemaName: string,
	quoteIdentifier: QuotePostgresIdentifier,
): string {
	const fields = (object.fields as readonly JsonRecord[])
		.map((field) => {
			const order = field.order === "desc" ? " DESC" : "";
			const nonDefaultNulls =
				(field.order === "asc" && field.nulls === "first") ||
				(field.order === "desc" && field.nulls === "last")
					? ` NULLS ${String(field.nulls).toUpperCase()}`
					: "";
			return `${quoteIdentifier(String(field.field))}${order}${nonDefaultNulls}`;
		})
		.join(", ");
	return `CREATE INDEX ${quoteIdentifier(String(object.name))} ON ${quoteIdentifier(schemaName)}.${quoteIdentifier(String(object.table))} USING btree (${fields})`;
}
