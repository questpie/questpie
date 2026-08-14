import { createHash } from "node:crypto";

import { canonicalBytes, compareAscii, digest } from "./canonical";
import { CompilerDiagnosticError } from "./diagnostic";
import {
	classifyAddedField,
	classifyChangedField,
	classifyProviderDelta,
	maximumClassification,
} from "./schema/migration-classification";
import type { MigrationClassification } from "./schema/migration-classification";
import type {
	MigrationPlanInput,
	MigrationPlanningResult,
	PlannedMigration,
} from "./schema/migration-planning";

type JsonRecord = Readonly<Record<string, unknown>>;

export interface SchemaProjectionV1 extends JsonRecord {
	readonly format: "questpie.schema-projection";
	readonly version: 1;
	readonly application: Readonly<{ name: string; postgresSchema: string }>;
	readonly requiredPostgres: Readonly<{
		minimumMajor: number;
		databaseCollation: string;
		databaseCType: string;
		extensions: readonly Readonly<{ name: string }>[];
	}>;
	readonly collections: readonly JsonRecord[];
}

export type RenameIdentityV1 =
	| `collection:${string}`
	| `collection:${string}/field:${string}`;

export type MigrationStepKindV1 =
	| "createApplicationSchema"
	| "renameCollection"
	| "createCollection"
	| "renameField"
	| "renameConstraint"
	| "renameRelationConstraint"
	| "renameIndex"
	| "addField"
	| "alterField"
	| "addConstraint"
	| "addRelation"
	| "addIndex"
	| "dropIndex"
	| "dropRelation"
	| "dropConstraint"
	| "dropField"
	| "dropCollection";

export interface MigrationStepV1 extends JsonRecord {
	readonly stepId: string;
	readonly kind: MigrationStepKindV1;
	readonly targetIdentity: string;
	readonly containerIdentity: string;
	readonly lock:
		| "none"
		| "share"
		| "shareRowExclusive"
		| "shareUpdateExclusive"
		| "accessExclusive";
	readonly scansData: boolean;
	readonly rewritesTable: boolean;
	readonly reversibleWithoutData: boolean;
	readonly classification: MigrationClassification;
}

export interface MigrationPlanV1 extends JsonRecord {
	readonly format: "questpie.migration-plan";
	readonly version: 1;
	readonly application: string;
	readonly slug: string;
	readonly baseMigration: string | null;
	readonly baseSchemaDigest: string;
	readonly targetSchemaDigest: string;
	readonly renames: readonly Readonly<{
		from: RenameIdentityV1;
		to: RenameIdentityV1;
	}>[];
	readonly requiredPostgres: SchemaProjectionV1["requiredPostgres"];
	readonly classification: MigrationClassification;
	readonly steps: readonly MigrationStepV1[];
}

export interface CommittedMigration {
	readonly identity: string;
	readonly checksum: string;
	readonly plan: MigrationPlanV1;
	readonly baseSchema: SchemaProjectionV1;
	readonly targetSchema: SchemaProjectionV1;
	readonly files: CommittedMigrationFilesV1;
}

export interface CommittedMigrationFilesV1 {
	readonly "migration.json": string;
	readonly "plan.json": string;
	readonly "base-schema.json": string;
	readonly "target-schema.json": string;
	readonly "up.sql": string;
	readonly "checksum.sha256": string;
}

function schemaError(
	code: ConstructorParameters<typeof CompilerDiagnosticError>[0],
	diagnosticClass: string,
	message: string,
	details: Readonly<Record<string, unknown>> = {},
): never {
	throw new CompilerDiagnosticError(code, diagnosticClass, message, details);
}

function assertProjection(value: unknown, label: string): SchemaProjectionV1 {
	if (!value || typeof value !== "object" || Array.isArray(value))
		return schemaError(
			"QP-SCHEMA-001",
			"invalidDefinition",
			`${label} is not an object`,
		);
	const projection = value as SchemaProjectionV1;
	if (
		projection.format !== "questpie.schema-projection" ||
		projection.version !== 1 ||
		!projection.application ||
		!projection.requiredPostgres ||
		!Array.isArray(projection.collections)
	)
		return schemaError(
			"QP-SCHEMA-001",
			"invalidDefinition",
			`${label} is not a Schema Projection v1`,
		);
	return projection;
}

function mapByIdentity(
	values: readonly JsonRecord[],
	label: string,
): Map<string, JsonRecord> {
	const mapped = new Map<string, JsonRecord>();
	for (const value of values) {
		const identity = value.identity;
		if (typeof identity !== "string")
			return schemaError(
				"QP-SCHEMA-001",
				"invalidDefinition",
				`${label} identity is missing`,
			);
		if (mapped.has(identity))
			return schemaError(
				"QP-SCHEMA-002",
				"duplicateIdentity",
				`${identity} is duplicated`,
			);
		mapped.set(identity, value);
	}
	return mapped;
}

function schemaDigest(schema: SchemaProjectionV1): string {
	return digest("questpie-schema-projection-v1", schema);
}

function genesis(target: SchemaProjectionV1): SchemaProjectionV1 {
	return {
		format: "questpie.schema-projection",
		version: 1,
		application: target.application,
		requiredPostgres: target.requiredPostgres,
		collections: [],
	};
}

function step(
	input: Readonly<{
		kind: MigrationStepKindV1;
		targetIdentity: string;
		containerIdentity: string;
		lock: MigrationStepV1["lock"];
		scansData: boolean;
		rewritesTable: boolean;
		reversibleWithoutData: boolean;
		classification: MigrationClassification;
	}>,
): MigrationStepV1 {
	return {
		stepId: digest("questpie-migration-step-v1", input),
		...input,
	};
}

const kindRank: readonly MigrationStepKindV1[] = [
	"createApplicationSchema",
	"renameCollection",
	"createCollection",
	"renameField",
	"renameConstraint",
	"renameRelationConstraint",
	"renameIndex",
	"addField",
	"alterField",
	"addConstraint",
	"addRelation",
	"addIndex",
	"dropIndex",
	"dropRelation",
	"dropConstraint",
	"dropField",
	"dropCollection",
] as const;

function sortSteps(steps: MigrationStepV1[]): MigrationStepV1[] {
	return steps.sort((left, right) => {
		const kindOrder =
			kindRank.indexOf(left.kind) - kindRank.indexOf(right.kind);
		return kindOrder || compareAscii(left.targetIdentity, right.targetIdentity);
	});
}

function childRecords(
	collection: JsonRecord,
	key: string,
): readonly JsonRecord[] {
	const value = collection[key];
	return Array.isArray(value) ? (value as readonly JsonRecord[]) : [];
}

function createSteps(target: SchemaProjectionV1): MigrationStepV1[] {
	const steps: MigrationStepV1[] = [
		step({
			kind: "createApplicationSchema",
			targetIdentity: `application:${target.application.name}`,
			containerIdentity: `application:${target.application.name}`,
			lock: "none",
			scansData: false,
			rewritesTable: false,
			reversibleWithoutData: true,
			classification: "safe",
		}),
	];
	for (const collection of target.collections) {
		const identity = String(collection.identity);
		steps.push(
			step({
				kind: "createCollection",
				targetIdentity: identity,
				containerIdentity: `application:${target.application.name}`,
				lock: "accessExclusive",
				scansData: false,
				rewritesTable: false,
				reversibleWithoutData: true,
				classification: "safe",
			}),
		);
		for (const constraint of childRecords(collection, "constraints"))
			steps.push(
				step({
					kind: "addConstraint",
					targetIdentity: String(constraint.identity),
					containerIdentity: identity,
					lock: "shareRowExclusive",
					scansData: true,
					rewritesTable: false,
					reversibleWithoutData: true,
					classification: "guarded",
				}),
			);
		for (const relation of childRecords(collection, "relations"))
			steps.push(
				step({
					kind: "addRelation",
					targetIdentity: String(relation.identity),
					containerIdentity: identity,
					lock: "shareRowExclusive",
					scansData: true,
					rewritesTable: false,
					reversibleWithoutData: true,
					classification: "guarded",
				}),
			);
		for (const index of childRecords(collection, "indexes"))
			steps.push(
				step({
					kind: "addIndex",
					targetIdentity: String(index.identity),
					containerIdentity: identity,
					lock: "share",
					scansData: false,
					rewritesTable: false,
					reversibleWithoutData: true,
					classification: "safe",
				}),
			);
	}
	return sortSteps(steps);
}

function allRenameable(schema: SchemaProjectionV1): Map<string, JsonRecord> {
	const result = mapByIdentity(schema.collections, "Collection");
	for (const collection of schema.collections)
		for (const field of childRecords(collection, "fields"))
			result.set(String(field.identity), field);
	return result;
}

function validateRenames(
	base: SchemaProjectionV1,
	target: SchemaProjectionV1,
	renames: MigrationPlanV1["renames"],
): void {
	const baseObjects = allRenameable(base);
	const targetObjects = allRenameable(target);
	const from = new Set<string>();
	const to = new Set<string>();
	for (const mapping of renames) {
		const fromField = mapping.from.includes("/field:");
		const toField = mapping.to.includes("/field:");
		if (
			mapping.from === mapping.to ||
			fromField !== toField ||
			from.has(mapping.from) ||
			to.has(mapping.to) ||
			!baseObjects.has(mapping.from) ||
			!targetObjects.has(mapping.to)
		)
			return schemaError(
				"QP-SCHEMA-001",
				"invalidDefinition",
				`rename mapping ${mapping.from}=${mapping.to} is not one-to-one over the base and target`,
			);
		if (
			fromField &&
			canonicalBytes(baseObjects.get(mapping.from)?.type) !==
				canonicalBytes(targetObjects.get(mapping.to)?.type)
		)
			return schemaError(
				"QP-SCHEMA-031",
				"nonTransactionalDdl",
				`rename mapping ${mapping.from}=${mapping.to} is not type-compatible`,
			);
		from.add(mapping.from);
		to.add(mapping.to);
	}
}

function mapIdentityForward(
	identity: string,
	renames: MigrationPlanV1["renames"],
): string {
	const mapping = [...renames]
		.sort((left, right) => right.from.length - left.from.length)
		.find(
			(candidate) =>
				identity === candidate.from ||
				identity.startsWith(`${candidate.from}/`),
		);
	return mapping
		? `${mapping.to}${identity.slice(mapping.from.length)}`
		: identity;
}

function mapIdentityBackward(
	identity: string,
	renames: MigrationPlanV1["renames"],
): string {
	const mapping = [...renames]
		.sort((left, right) => right.to.length - left.to.length)
		.find(
			(candidate) =>
				identity === candidate.to || identity.startsWith(`${candidate.to}/`),
		);
	return mapping
		? `${mapping.from}${identity.slice(mapping.to.length)}`
		: identity;
}

function semanticComparable(
	value: unknown,
	renames: MigrationPlanV1["renames"],
): unknown {
	if (typeof value === "string") return mapIdentityForward(value, renames);
	if (Array.isArray(value))
		return value.map((item) => semanticComparable(item, renames));
	if (!value || typeof value !== "object") return value;
	const result: Record<string, unknown> = {};
	for (const [key, item] of Object.entries(value)) {
		if (
			key === "postgresName" ||
			key === "constraintPostgresName" ||
			key === "path"
		)
			continue;
		result[key] = semanticComparable(item, renames);
	}
	return result;
}

function deltaKind(
	key: "fields" | "constraints" | "relations" | "indexes",
	operation: "add" | "drop" | "rename",
): MigrationStepKindV1 {
	if (key === "fields")
		return operation === "add"
			? "addField"
			: operation === "drop"
				? "dropField"
				: "renameField";
	if (key === "constraints")
		return operation === "add"
			? "addConstraint"
			: operation === "drop"
				? "dropConstraint"
				: "renameConstraint";
	if (key === "relations")
		return operation === "add"
			? "addRelation"
			: operation === "drop"
				? "dropRelation"
				: "renameRelationConstraint";
	return operation === "add"
		? "addIndex"
		: operation === "drop"
			? "dropIndex"
			: "renameIndex";
}

function destructiveDeltaSteps(
	base: SchemaProjectionV1,
	target: SchemaProjectionV1,
	renames: MigrationPlanV1["renames"],
): MigrationStepV1[] {
	validateRenames(base, target, renames);
	const baseCollections = mapByIdentity(base.collections, "base Collection");
	const targetCollections = mapByIdentity(
		target.collections,
		"target Collection",
	);
	const steps: MigrationStepV1[] = [];
	for (const targetCollection of target.collections) {
		const targetIdentity = String(targetCollection.identity);
		const baseIdentity = mapIdentityBackward(targetIdentity, renames);
		const baseCollection = baseCollections.get(baseIdentity);
		if (!baseCollection) {
			steps.push(
				...createSteps({ ...target, collections: [targetCollection] }).slice(1),
			);
			continue;
		}
		if (
			baseIdentity !== targetIdentity ||
			baseCollection.postgresName !== targetCollection.postgresName
		)
			steps.push(
				step({
					kind: "renameCollection",
					targetIdentity,
					containerIdentity: `application:${target.application.name}`,
					lock: "accessExclusive",
					scansData: false,
					rewritesTable: false,
					reversibleWithoutData: true,
					classification: "destructive",
				}),
			);
		for (const key of [
			"fields",
			"constraints",
			"relations",
			"indexes",
		] as const) {
			const before = mapByIdentity(
				childRecords(baseCollection, key),
				`base ${key}`,
			);
			const matchedBase = new Set<string>();
			for (const targetValue of childRecords(targetCollection, key)) {
				const targetChildIdentity = String(targetValue.identity);
				const baseChildIdentity = mapIdentityBackward(
					targetChildIdentity,
					renames,
				);
				const baseValue = before.get(baseChildIdentity);
				if (!baseValue) {
					const isField = key === "fields";
					const classification: MigrationClassification = isField
						? classifyAddedField(targetValue)
						: "guarded";
					steps.push(
						step({
							kind: deltaKind(key, "add"),
							targetIdentity: targetChildIdentity,
							containerIdentity: targetIdentity,
							lock: "accessExclusive",
							scansData: classification !== "safe",
							rewritesTable: false,
							reversibleWithoutData: classification !== "blocked",
							classification,
						}),
					);
					continue;
				}
				matchedBase.add(baseChildIdentity);
				const derivedRename = baseChildIdentity !== targetChildIdentity;
				const physicalName =
					key === "relations" ? "constraintPostgresName" : "postgresName";
				const physicalChanged =
					baseValue[physicalName] !== targetValue[physicalName];
				if (derivedRename || (key === "fields" && physicalChanged))
					steps.push(
						step({
							kind: deltaKind(key, "rename"),
							targetIdentity: targetChildIdentity,
							containerIdentity: targetIdentity,
							lock: "accessExclusive",
							scansData: false,
							rewritesTable: false,
							reversibleWithoutData: true,
							classification: "destructive",
						}),
					);
				const semanticChanged =
					canonicalBytes(semanticComparable(baseValue, renames)) !==
					canonicalBytes(semanticComparable(targetValue, []));
				if (
					semanticChanged ||
					(!derivedRename && key !== "fields" && physicalChanged)
				) {
					if (key === "fields") {
						const classification = classifyChangedField(baseValue, targetValue);
						if (classification)
							steps.push(
								step({
									kind: "alterField",
									targetIdentity: targetChildIdentity,
									containerIdentity: targetIdentity,
									lock: "accessExclusive",
									scansData: true,
									rewritesTable: true,
									reversibleWithoutData: false,
									classification,
								}),
							);
					} else
						steps.push(
							step({
								kind: deltaKind(key, "drop"),
								targetIdentity: baseChildIdentity,
								containerIdentity: baseIdentity,
								lock: "accessExclusive",
								scansData: true,
								rewritesTable: false,
								reversibleWithoutData: false,
								classification: "destructive",
							}),
							step({
								kind: deltaKind(key, "add"),
								targetIdentity: targetChildIdentity,
								containerIdentity: targetIdentity,
								lock: "accessExclusive",
								scansData: true,
								rewritesTable: false,
								reversibleWithoutData: false,
								classification: "destructive",
							}),
						);
				}
			}
			for (const baseValue of childRecords(baseCollection, key)) {
				const baseChildIdentity = String(baseValue.identity);
				if (!matchedBase.has(baseChildIdentity))
					steps.push(
						step({
							kind: deltaKind(key, "drop"),
							targetIdentity: baseChildIdentity,
							containerIdentity: baseIdentity,
							lock: "accessExclusive",
							scansData: true,
							rewritesTable: false,
							reversibleWithoutData: false,
							classification: "destructive",
						}),
					);
			}
		}
	}
	for (const baseCollection of base.collections) {
		const baseIdentity = String(baseCollection.identity);
		if (!targetCollections.has(mapIdentityForward(baseIdentity, renames)))
			steps.push(
				step({
					kind: "dropCollection",
					targetIdentity: baseIdentity,
					containerIdentity: `application:${target.application.name}`,
					lock: "accessExclusive",
					scansData: true,
					rewritesTable: false,
					reversibleWithoutData: false,
					classification: "destructive",
				}),
			);
	}
	return sortSteps(steps);
}

export function createMigrationPlan(
	input: MigrationPlanInput & Readonly<{ baseSchema?: undefined }>,
): PlannedMigration;
export function createMigrationPlan(
	input: MigrationPlanInput,
): MigrationPlanningResult;
export function createMigrationPlan(
	input: MigrationPlanInput,
): MigrationPlanningResult {
	const target = assertProjection(input.targetSchema, "target schema");
	const base = input.baseSchema
		? assertProjection(input.baseSchema, "base schema")
		: genesis(target);
	if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug))
		return schemaError(
			"QP-SCHEMA-001",
			"invalidDefinition",
			"migration slug must be lower kebab case",
		);
	if (
		base.application.name !== target.application.name ||
		base.application.postgresSchema !== target.application.postgresSchema
	)
		return schemaError(
			"QP-SCHEMA-029",
			"applicationBindingMismatch",
			"base and target application bindings differ",
		);
	const renames = [...(input.renames ?? [])].sort((left, right) =>
		compareAscii(`${left.from}\0${left.to}`, `${right.from}\0${right.to}`),
	);
	validateRenames(base, target, renames);
	const steps =
		base.collections.length === 0
			? createSteps(target)
			: destructiveDeltaSteps(base, target, renames);
	const providerDelta = classifyProviderDelta(
		base.requiredPostgres,
		target.requiredPostgres,
	);
	if (
		steps.length === 0 &&
		providerDelta === null &&
		canonicalBytes(base) === canonicalBytes(target)
	)
		return { status: "noChanges" };
	const classifiedSteps = providerDelta
		? [...steps, { classification: providerDelta }]
		: steps.length > 0
			? steps
			: [{ classification: "blocked" as const }];
	const plan: MigrationPlanV1 = {
		format: "questpie.migration-plan",
		version: 1,
		application: target.application.name,
		slug: input.slug,
		baseMigration: input.baseMigration ?? null,
		baseSchemaDigest: schemaDigest(base),
		targetSchemaDigest: schemaDigest(target),
		renames,
		requiredPostgres: target.requiredPostgres,
		classification: maximumClassification(classifiedSteps),
		steps,
	};
	return {
		status: "planned",
		plan,
		digest: digest("questpie-migration-plan-v1", plan),
		baseSchema: base,
	};
}

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

function sqlType(field: JsonRecord): string {
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
			return schemaError(
				"QP-SCHEMA-031",
				"nonTransactionalDdl",
				`unsupported Field type ${String(type.kind)}`,
			);
	}
}

function defaultSql(value: unknown): string {
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
	return schemaError(
		"QP-SCHEMA-031",
		"nonTransactionalDdl",
		"unsupported default",
	);
}

function renderCheckExpression(
	expression: JsonRecord,
	collection: JsonRecord,
): string {
	if (expression.kind === "field")
		return quote(
			String(
				childFor(collection, "addField", String(expression.field)).postgresName,
			),
		);
	if (expression.kind === "literal") {
		if (expression.value === null) return "NULL";
		if (typeof expression.value === "boolean")
			return expression.value ? "TRUE" : "FALSE";
		if (typeof expression.value === "number") return String(expression.value);
		return `'${String(expression.value).replaceAll("'", "''")}'`;
	}
	if (expression.kind === "textLength")
		return `pg_catalog.char_length(${renderCheckExpression(expression.expression as JsonRecord, collection)})`;
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
			return schemaError(
				"QP-SCHEMA-031",
				"nonTransactionalDdl",
				`unsupported check operator ${String(expression.operator)}`,
			);
		return `(${renderCheckExpression(expression.left as JsonRecord, collection)} ${operator} ${renderCheckExpression(expression.right as JsonRecord, collection)})`;
	}
	return schemaError(
		"QP-SCHEMA-031",
		"nonTransactionalDdl",
		`unsupported check expression ${String(expression.kind)}`,
	);
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
				`  ${quote(String(field.postgresName))} ${sqlType(field)}${field.nullable === true ? "" : " NOT NULL"}${defaultSql(field.default)}`,
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
		return `ALTER TABLE ${table} ADD COLUMN ${quote(String(field.postgresName))} ${sqlType(field)}${field.nullable === true ? "" : " NOT NULL"}${defaultSql(field.default)};`;
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
				`ALTER TABLE ${table} ALTER COLUMN ${column} TYPE ${sqlType(field)} USING ${column}::${sqlType(field).split(" COLLATE ")[0]};`,
			);
		if (
			canonicalBytes(baseField.default) !== canonicalBytes(field.default) &&
			field.default !== null
		)
			statements.push(
				`ALTER TABLE ${table} ALTER COLUMN ${column} SET${defaultSql(field.default)};`,
			);
		if (baseField.nullable === true && field.nullable !== true) {
			const literal = field.default as JsonRecord | null;
			if (literal?.kind === "literal")
				statements.push(
					`UPDATE ${table} SET ${column} =${defaultSql(literal).slice(8)} WHERE ${column} IS NULL;`,
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
			return `ALTER TABLE ${table} ADD CONSTRAINT ${quote(String(constraint.postgresName))} CHECK (${renderCheckExpression(constraint.expression as JsonRecord, collection)});`;
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
		const name =
			key === "relations" ? value.constraintPostgresName : value.postgresName;
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
		return `DROP INDEX ${quote(schemaName)}.${quote(String(index.postgresName))};`;
	}
	if (stepValue.kind === "dropCollection") return `DROP TABLE ${table};`;
	return schemaError(
		"QP-SCHEMA-031",
		"nonTransactionalDdl",
		`SQL renderer does not support ${stepValue.kind}`,
	);
}

type MigrationPayloadFiles = Omit<CommittedMigrationFilesV1, "checksum.sha256">;

const committedMigrationFileNames = [
	"base-schema.json",
	"checksum.sha256",
	"migration.json",
	"plan.json",
	"target-schema.json",
	"up.sql",
] as const;

function renderMigrationSql(
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

function migrationChecksum(files: MigrationPayloadFiles): string {
	return createHash("sha256")
		.update("questpie-migration-v1\0")
		.update(files["migration.json"])
		.update("\0")
		.update(files["plan.json"])
		.update("\0")
		.update(files["base-schema.json"])
		.update("\0")
		.update(files["target-schema.json"])
		.update("\0")
		.update(files["up.sql"])
		.digest("hex");
}

export function createCommittedMigration(
	input: Readonly<{
		plan: MigrationPlanV1;
		baseSchema: SchemaProjectionV1;
		targetSchema: SchemaProjectionV1;
		planDigest: string;
		sequence?: number;
		parent?: string | null;
		currentSchema: SchemaProjectionV1;
		acceptDestructive?: string;
	}>,
): CommittedMigration {
	const base = assertProjection(input.baseSchema, "base schema");
	const target = assertProjection(input.targetSchema, "target schema");
	const actualPlanDigest = digest("questpie-migration-plan-v1", input.plan);
	if (input.planDigest !== actualPlanDigest)
		return schemaError(
			"QP-SCHEMA-021",
			"planDigestMismatch",
			"Migration Plan Digest does not match the supplied plan",
		);
	if (input.plan.classification === "blocked")
		return schemaError(
			"QP-SCHEMA-031",
			"nonTransactionalDdl",
			"blocked Migration Plan cannot be committed",
		);
	if (
		input.plan.classification === "destructive" &&
		input.acceptDestructive !== actualPlanDigest
	)
		return schemaError(
			"QP-SCHEMA-020",
			"destructiveAcknowledgementRequired",
			"destructive Migration Plan requires its exact digest",
		);
	const current = assertProjection(input.currentSchema, "current schema");
	const replanned = createMigrationPlan({
		targetSchema: current,
		baseSchema: base,
		baseMigration: input.plan.baseMigration,
		slug: input.plan.slug,
		renames: input.plan.renames,
	});
	if (
		replanned.status === "noChanges" ||
		canonicalBytes(replanned.plan) !== canonicalBytes(input.plan) ||
		schemaDigest(target) !== input.plan.targetSchemaDigest
	)
		return schemaError(
			"QP-SCHEMA-022",
			"stalePlan",
			"Definitions or migration history changed after planning",
		);
	const sequence = input.sequence ?? 1;
	if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > 999_999)
		return schemaError(
			"QP-SCHEMA-001",
			"invalidDefinition",
			"migration sequence is outside six-digit v1 range",
		);
	const identity = `${sequence.toString().padStart(6, "0")}_${input.plan.slug}`;
	const parent = input.parent ?? input.plan.baseMigration;
	if (
		(sequence === 1 &&
			(parent !== null || input.plan.baseMigration !== null)) ||
		(sequence > 1 && (parent === null || parent !== input.plan.baseMigration))
	)
		return schemaError(
			"QP-SCHEMA-025",
			"orderMismatch",
			"migration sequence, parent, and plan base do not form one linear chain",
		);
	const metadata = {
		format: "questpie.committed-migration",
		version: 1,
		identity,
		sequence,
		slug: input.plan.slug,
		parent,
		planDigest: actualPlanDigest,
		baseSchemaDigest: schemaDigest(base),
		targetSchemaDigest: schemaDigest(target),
		requiredPostgres: target.requiredPostgres,
		transaction: "required",
		sqlRenderer: "questpie-postgres-ddl-v1",
	};
	const upSql = renderMigrationSql(input.plan, target, base);
	const payloadFiles: MigrationPayloadFiles = {
		"migration.json": canonicalBytes(metadata),
		"plan.json": canonicalBytes(input.plan),
		"base-schema.json": canonicalBytes(base),
		"target-schema.json": canonicalBytes(target),
		"up.sql": upSql,
	};
	const checksum = migrationChecksum(payloadFiles);
	const files: CommittedMigrationFilesV1 = {
		...payloadFiles,
		"checksum.sha256": `${checksum}\n`,
	};
	return {
		identity,
		checksum,
		plan: input.plan,
		baseSchema: base,
		targetSchema: target,
		files,
	};
}

export function verifyCommittedMigration(migration: CommittedMigration): void {
	const names = Object.keys(migration.files).sort(compareAscii);
	if (canonicalBytes(names) !== canonicalBytes(committedMigrationFileNames))
		return schemaError(
			"QP-SCHEMA-023",
			"checksumMismatch",
			`${migration.identity} does not contain the exact six-file contract`,
		);
	const payloadFiles: MigrationPayloadFiles = {
		"migration.json": migration.files["migration.json"],
		"plan.json": migration.files["plan.json"],
		"base-schema.json": migration.files["base-schema.json"],
		"target-schema.json": migration.files["target-schema.json"],
		"up.sql": migration.files["up.sql"],
	};
	const actualChecksum = migrationChecksum(payloadFiles);
	if (
		migration.files["checksum.sha256"] !== `${actualChecksum}\n` ||
		migration.checksum !== actualChecksum
	)
		return schemaError(
			"QP-SCHEMA-023",
			"checksumMismatch",
			`${migration.identity} checksum is invalid`,
		);
	let metadata: JsonRecord;
	let plan: MigrationPlanV1;
	let base: SchemaProjectionV1;
	let target: SchemaProjectionV1;
	try {
		metadata = JSON.parse(payloadFiles["migration.json"]) as JsonRecord;
		plan = JSON.parse(payloadFiles["plan.json"]) as MigrationPlanV1;
		base = assertProjection(
			JSON.parse(payloadFiles["base-schema.json"]),
			"committed base schema",
		);
		target = assertProjection(
			JSON.parse(payloadFiles["target-schema.json"]),
			"committed target schema",
		);
	} catch {
		return schemaError(
			"QP-SCHEMA-023",
			"checksumMismatch",
			`${migration.identity} contains invalid artifact JSON`,
		);
	}
	const sequence = Number(metadata.sequence);
	const parent = metadata.parent === null ? null : String(metadata.parent);
	const expectedIdentity = `${sequence.toString().padStart(6, "0")}_${String(metadata.slug)}`;
	const expectedPlanDigest = digest("questpie-migration-plan-v1", plan);
	if (
		canonicalBytes(metadata) !== payloadFiles["migration.json"] ||
		canonicalBytes(plan) !== payloadFiles["plan.json"] ||
		canonicalBytes(base) !== payloadFiles["base-schema.json"] ||
		canonicalBytes(target) !== payloadFiles["target-schema.json"] ||
		metadata.format !== "questpie.committed-migration" ||
		metadata.version !== 1 ||
		!Number.isSafeInteger(sequence) ||
		sequence < 1 ||
		expectedIdentity !== migration.identity ||
		metadata.identity !== migration.identity ||
		metadata.slug !== plan.slug ||
		metadata.planDigest !== expectedPlanDigest ||
		metadata.baseSchemaDigest !== schemaDigest(base) ||
		metadata.targetSchemaDigest !== schemaDigest(target) ||
		plan.baseSchemaDigest !== schemaDigest(base) ||
		plan.targetSchemaDigest !== schemaDigest(target) ||
		plan.application !== target.application.name ||
		canonicalBytes(metadata.requiredPostgres) !==
			canonicalBytes(target.requiredPostgres) ||
		canonicalBytes(plan.requiredPostgres) !==
			canonicalBytes(target.requiredPostgres) ||
		metadata.transaction !== "required" ||
		metadata.sqlRenderer !== "questpie-postgres-ddl-v1" ||
		base.application.name !== target.application.name ||
		base.application.postgresSchema !== target.application.postgresSchema ||
		parent !== plan.baseMigration ||
		(sequence === 1 ? parent !== null : parent === null) ||
		canonicalBytes(plan) !== canonicalBytes(migration.plan) ||
		canonicalBytes(base) !== canonicalBytes(migration.baseSchema) ||
		canonicalBytes(target) !== canonicalBytes(migration.targetSchema) ||
		renderMigrationSql(plan, target, base) !== payloadFiles["up.sql"]
	)
		return schemaError(
			"QP-SCHEMA-023",
			"checksumMismatch",
			`${migration.identity} artifacts disagree with one another`,
		);
}

export function verifyCommittedMigrationChain(
	migrations: readonly CommittedMigration[],
): void {
	if (migrations.length === 0)
		return schemaError(
			"QP-SCHEMA-024",
			"missingLocalMigration",
			"no committed migration exists",
		);
	for (const [index, migration] of migrations.entries()) {
		verifyCommittedMigration(migration);
		const metadata = JSON.parse(
			migration.files["migration.json"],
		) as JsonRecord;
		const sequence = index + 1;
		const previous = migrations[index - 1];
		const expectedParent = previous?.identity ?? null;
		if (
			metadata.sequence !== sequence ||
			migration.identity.slice(0, 6) !== sequence.toString().padStart(6, "0") ||
			migration.plan.baseMigration !== expectedParent ||
			metadata.parent !== expectedParent ||
			(previous !== undefined &&
				canonicalBytes(migration.baseSchema) !==
					canonicalBytes(previous.targetSchema)) ||
			(previous === undefined && migration.baseSchema.collections.length !== 0)
		)
			return schemaError(
				"QP-SCHEMA-025",
				"orderMismatch",
				`${migration.identity} does not extend the exact local migration prefix`,
			);
	}
}
