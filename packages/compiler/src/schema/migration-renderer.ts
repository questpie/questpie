import { canonicalBytes } from "../canonical";
import type {
	MigrationPlanV1,
	MigrationStepV1,
	SchemaProjectionV1,
} from "./contracts";
import {
	renderPostgresCheck,
	renderPostgresDefault,
	renderPostgresType,
} from "./postgres-ddl";
import {
	childRecords,
	mapIdentityBackward,
	mapIdentityForward,
	schemaError,
} from "./projection";

type JsonRecord = Readonly<Record<string, unknown>>;

function quote(name: string): string {
	return `"${name.replaceAll('"', '""')}"`;
}

function collectionFor(
	schema: SchemaProjectionV1,
	identity: string,
): JsonRecord {
	const collection = schema.collections.find(
		(candidate) => candidate.identity === identity,
	);
	if (!collection)
		return schemaError(
			"QP-SCHEMA-003",
			"invalidReference",
			`unknown Collection ${identity}`,
		);
	return collection;
}

function childFor(
	collection: JsonRecord,
	kind: string,
	identity: string,
): JsonRecord {
	const key =
		kind === "addConstraint"
			? "constraints"
			: kind === "addRelation"
				? "relations"
				: kind === "addIndex"
					? "indexes"
					: "fields";
	const child = childRecords(collection, key).find(
		(candidate) => candidate.identity === identity,
	);
	if (!child)
		return schemaError(
			"QP-SCHEMA-003",
			"invalidReference",
			`unknown schema target ${identity}`,
		);
	return child;
}

function renderStep(
	stepValue: MigrationStepV1,
	target: SchemaProjectionV1,
	base: SchemaProjectionV1,
	renames: MigrationPlanV1["renames"],
): string {
	const schemaName = target.application.postgresSchema;
	if (stepValue.kind === "createApplicationSchema")
		return `CREATE SCHEMA ${quote(schemaName)};`;
	if (stepValue.kind === "createCollection") {
		const collection = collectionFor(target, stepValue.targetIdentity);
		const columns = childRecords(collection, "fields").map(
			(field) =>
				`  ${quote(String(field.postgresName))} ${renderPostgresType(field)}${field.nullable === true ? "" : " NOT NULL"}${renderPostgresDefault(field.default)}`,
		);
		return `CREATE TABLE ${quote(schemaName)}.${quote(String(collection.postgresName))} (\n${columns.join(",\n")}\n);`;
	}
	if (stepValue.kind === "renameCollection") {
		const targetCollection = collectionFor(target, stepValue.targetIdentity);
		const baseCollection = collectionFor(
			base,
			mapIdentityBackward(stepValue.targetIdentity, renames),
		);
		return `ALTER TABLE ${quote(schemaName)}.${quote(String(baseCollection.postgresName))} RENAME TO ${quote(String(targetCollection.postgresName))};`;
	}
	if (stepValue.kind === "dropCollection") {
		const baseCollection = collectionFor(base, stepValue.targetIdentity);
		return `DROP TABLE ${quote(schemaName)}.${quote(String(baseCollection.postgresName))};`;
	}
	const targetContainerIdentity = mapIdentityForward(
		stepValue.containerIdentity,
		renames,
	);
	const targetCollection = target.collections.find(
		(candidate) => candidate.identity === targetContainerIdentity,
	);
	const baseContainerIdentity = mapIdentityBackward(
		stepValue.containerIdentity,
		renames,
	);
	const baseCollection = base.collections.find(
		(candidate) => candidate.identity === baseContainerIdentity,
	);
	const collection = targetCollection ?? baseCollection;
	if (!collection)
		return schemaError(
			"QP-SCHEMA-003",
			"invalidReference",
			`unknown step container ${stepValue.containerIdentity}`,
		);
	const table = `${quote(schemaName)}.${quote(String(collection.postgresName))}`;
	if (
		stepValue.kind === "renameField" ||
		stepValue.kind === "renameConstraint" ||
		stepValue.kind === "renameRelationConstraint" ||
		stepValue.kind === "renameIndex"
	) {
		if (!targetCollection || !baseCollection)
			return schemaError(
				"QP-SCHEMA-003",
				"invalidReference",
				`rename target ${stepValue.targetIdentity} has no paired base object`,
			);
		const key =
			stepValue.kind === "renameField"
				? "fields"
				: stepValue.kind === "renameConstraint"
					? "constraints"
					: stepValue.kind === "renameRelationConstraint"
						? "relations"
						: "indexes";
		const targetValue = childRecords(targetCollection, key).find(
			(value) => value.identity === stepValue.targetIdentity,
		);
		const baseValue = childRecords(baseCollection, key).find(
			(value) =>
				value.identity ===
				mapIdentityBackward(stepValue.targetIdentity, renames),
		);
		if (!targetValue || !baseValue)
			return schemaError(
				"QP-SCHEMA-003",
				"invalidReference",
				`rename target ${stepValue.targetIdentity} is missing`,
			);
		const nameKey =
			key === "relations" ? "constraintPostgresName" : "postgresName";
		if (stepValue.kind === "renameField")
			return `ALTER TABLE ${table} RENAME COLUMN ${quote(String(baseValue[nameKey]))} TO ${quote(String(targetValue[nameKey]))};`;
		if (stepValue.kind === "renameIndex")
			return `ALTER INDEX ${quote(schemaName)}.${quote(String(baseValue[nameKey]))} RENAME TO ${quote(String(targetValue[nameKey]))};`;
		return `ALTER TABLE ${table} RENAME CONSTRAINT ${quote(String(baseValue[nameKey]))} TO ${quote(String(targetValue[nameKey]))};`;
	}
	if (stepValue.kind === "addField") {
		if (!targetCollection)
			return schemaError(
				"QP-SCHEMA-003",
				"invalidReference",
				"addField target Collection is missing",
			);
		const field = childFor(
			targetCollection,
			stepValue.kind,
			stepValue.targetIdentity,
		);
		return `ALTER TABLE ${table} ADD COLUMN ${quote(String(field.postgresName))} ${renderPostgresType(field)}${field.nullable === true ? "" : " NOT NULL"}${renderPostgresDefault(field.default)};`;
	}
	if (stepValue.kind === "alterField") {
		if (!targetCollection || !baseCollection)
			return schemaError(
				"QP-SCHEMA-003",
				"invalidReference",
				"alterField Collection is missing",
			);
		const field = childFor(
			targetCollection,
			"addField",
			stepValue.targetIdentity,
		);
		const baseField = childFor(
			baseCollection,
			"addField",
			mapIdentityBackward(stepValue.targetIdentity, renames),
		);
		const column = quote(String(field.postgresName));
		const statements: string[] = [];
		if (
			canonicalBytes(baseField.default) !== canonicalBytes(field.default) &&
			baseField.default !== null
		)
			statements.push(
				`ALTER TABLE ${table} ALTER COLUMN ${column} DROP DEFAULT;`,
			);
		if (canonicalBytes(baseField.type) !== canonicalBytes(field.type))
			statements.push(
				`ALTER TABLE ${table} ALTER COLUMN ${column} TYPE ${renderPostgresType(field)} USING ${column}::${renderPostgresType(field).split(" COLLATE ")[0]};`,
			);
		if (
			canonicalBytes(baseField.default) !== canonicalBytes(field.default) &&
			field.default !== null
		)
			statements.push(
				`ALTER TABLE ${table} ALTER COLUMN ${column} SET${renderPostgresDefault(field.default)};`,
			);
		if (baseField.nullable === true && field.nullable !== true) {
			const literal = field.default as JsonRecord | null;
			if (literal?.kind === "literal")
				statements.push(
					`UPDATE ${table} SET ${column} =${renderPostgresDefault(literal).slice(8)} WHERE ${column} IS NULL;`,
				);
			statements.push(
				`ALTER TABLE ${table} ALTER COLUMN ${column} SET NOT NULL;`,
			);
		} else if (baseField.nullable !== true && field.nullable === true)
			statements.push(
				`ALTER TABLE ${table} ALTER COLUMN ${column} DROP NOT NULL;`,
			);
		if (statements.length === 0)
			return schemaError(
				"QP-SCHEMA-031",
				"nonTransactionalDdl",
				`unsupported Field delta ${stepValue.targetIdentity}`,
			);
		return statements.join("\n");
	}
	if (stepValue.kind === "addConstraint") {
		const constraint = childFor(
			collection,
			stepValue.kind,
			stepValue.targetIdentity,
		);
		if (constraint.kind === "check")
			return `ALTER TABLE ${table} ADD CONSTRAINT ${quote(String(constraint.postgresName))} CHECK (${renderPostgresCheck(constraint.expression as JsonRecord, collection)});`;
		const fields = (constraint.fields as readonly string[])
			.map((identity) =>
				quote(String(childFor(collection, "addField", identity).postgresName)),
			)
			.join(", ");
		if (constraint.kind === "primaryKey")
			return `ALTER TABLE ${table} ADD CONSTRAINT ${quote(String(constraint.postgresName))} PRIMARY KEY (${fields});`;
		if (constraint.kind === "unique")
			return `ALTER TABLE ${table} ADD CONSTRAINT ${quote(String(constraint.postgresName))} UNIQUE (${fields});`;
		return schemaError(
			"QP-SCHEMA-031",
			"nonTransactionalDdl",
			`unsupported Constraint ${stepValue.targetIdentity}`,
		);
	}
	if (stepValue.kind === "addRelation") {
		const relation = childFor(
			collection,
			stepValue.kind,
			stepValue.targetIdentity,
		);
		const targetCollection = collectionFor(target, String(relation.target));
		const local = (relation.fields as readonly string[])
			.map((identity) =>
				quote(String(childFor(collection, "addField", identity).postgresName)),
			)
			.join(", ");
		const referenced = (relation.references as readonly string[])
			.map((identity) =>
				quote(
					String(childFor(targetCollection, "addField", identity).postgresName),
				),
			)
			.join(", ");
		const action = (value: unknown) =>
			String(value)
				.replace(/([a-z])([A-Z])/g, "$1 $2")
				.toUpperCase();
		return `ALTER TABLE ${table} ADD CONSTRAINT ${quote(String(relation.constraintPostgresName))} FOREIGN KEY (${local}) REFERENCES ${quote(schemaName)}.${quote(String(targetCollection.postgresName))} (${referenced}) ON DELETE ${action(relation.onDelete)} ON UPDATE ${action(relation.onUpdate)};`;
	}
	if (stepValue.kind === "addIndex") {
		const index = childFor(
			collection,
			stepValue.kind,
			stepValue.targetIdentity,
		);
		const fields = (index.fields as readonly JsonRecord[])
			.map(
				(entry) =>
					`${quote(String(childFor(collection, "addField", String(entry.field)).postgresName))} ${String(entry.order).toUpperCase()} NULLS ${String(entry.nulls).toUpperCase()}`,
			)
			.join(", ");
		return `CREATE INDEX ${quote(String(index.postgresName))} ON ${table} USING btree (${fields});`;
	}
	if (stepValue.kind === "dropField") {
		if (!baseCollection)
			return schemaError(
				"QP-SCHEMA-003",
				"invalidReference",
				"dropField base Collection is missing",
			);
		const field = childFor(
			baseCollection,
			"addField",
			stepValue.targetIdentity,
		);
		return `ALTER TABLE ${table} DROP COLUMN ${quote(String(field.postgresName))};`;
	}
	if (
		stepValue.kind === "dropConstraint" ||
		stepValue.kind === "dropRelation"
	) {
		if (!baseCollection)
			return schemaError(
				"QP-SCHEMA-003",
				"invalidReference",
				"drop constraint base Collection is missing",
			);
		const key =
			stepValue.kind === "dropConstraint" ? "constraints" : "relations";
		const value = childRecords(baseCollection, key).find(
			(item) => item.identity === stepValue.targetIdentity,
		);
		if (!value)
			return schemaError(
				"QP-SCHEMA-003",
				"invalidReference",
				`unknown drop target ${stepValue.targetIdentity}`,
			);
		const nameKey =
			key === "relations" ? "constraintPostgresName" : "postgresName";
		const mappedIdentity = mapIdentityForward(
			stepValue.targetIdentity,
			renames,
		);
		const renamedTarget =
			mappedIdentity === stepValue.targetIdentity
				? undefined
				: childRecords(targetCollection ?? {}, key).find(
						(item) => item.identity === mappedIdentity,
					);
		const name = renamedTarget?.[nameKey] ?? value[nameKey];
		return `ALTER TABLE ${table} DROP CONSTRAINT ${quote(String(name))};`;
	}
	if (stepValue.kind === "dropIndex") {
		if (!baseCollection)
			return schemaError(
				"QP-SCHEMA-003",
				"invalidReference",
				"dropIndex base Collection is missing",
			);
		const index = childRecords(baseCollection, "indexes").find(
			(item) => item.identity === stepValue.targetIdentity,
		);
		if (!index)
			return schemaError(
				"QP-SCHEMA-003",
				"invalidReference",
				`unknown drop target ${stepValue.targetIdentity}`,
			);
		const mappedIdentity = mapIdentityForward(
			stepValue.targetIdentity,
			renames,
		);
		const renamedTarget =
			mappedIdentity === stepValue.targetIdentity
				? undefined
				: childRecords(targetCollection ?? {}, "indexes").find(
						(item) => item.identity === mappedIdentity,
					);
		return `DROP INDEX ${quote(schemaName)}.${quote(String(renamedTarget?.postgresName ?? index.postgresName))};`;
	}
	return schemaError(
		"QP-SCHEMA-031",
		"nonTransactionalDdl",
		`SQL renderer does not support ${stepValue.kind}`,
	);
}

export function renderMigrationSql(
	plan: MigrationPlanV1,
	target: SchemaProjectionV1,
	base: SchemaProjectionV1,
): string {
	return plan.steps
		.map(
			(item) =>
				`-- questpie-step: ${item.stepId}\n${renderStep(item, target, base, plan.renames)}\n`,
		)
		.join("\n");
}
