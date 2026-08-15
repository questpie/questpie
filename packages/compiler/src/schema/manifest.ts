import { canonicalBytes, compareAscii } from "../canonical";
import { projectDataRelations } from "../data";
import { CompilerDiagnosticError } from "../diagnostic";
import type { ApplicationConfiguration, NormalizedResource } from "../types";
import { projectCheckExpression } from "./check-expression";
import { flattenFieldContracts } from "./field-contract";
import { fieldPath, indexField } from "./field-reference";
import {
	reservePostgresRelationName,
	validateBtreeIndexTerms,
	validateKeyConstraintFields,
} from "./member-validation";
import {
	shortenedPostgresName,
	validatedApplicationSchemaName,
	validatedPhysicalName,
} from "./physical-name";

type RecordValue = Readonly<Record<string, unknown>>;

function record(value: unknown, label: string): RecordValue {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new CompilerDiagnosticError(
			"QP-COMPOSE-015",
			"invalidAugmentation",
			`${label} must be an object`,
		);
	return value as RecordValue;
}

function string(value: unknown, label: string): string {
	if (typeof value !== "string")
		throw new CompilerDiagnosticError(
			"QP-COMPOSE-015",
			"invalidAugmentation",
			`${label} must be a string`,
		);
	return value;
}

function entries(value: unknown): [string, RecordValue][] {
	return Object.entries(record(value, "member map"))
		.map(([key, item]) => [key, record(item, key)] as [string, RecordValue])
		.sort(([left], [right]) => compareAscii(left, right));
}

function snake(value: string): string {
	return value
		.replace(/([a-z0-9])([A-Z])/g, "$1_$2")
		.replace(/([A-Z])([A-Z][a-z])/g, "$1_$2")
		.toLowerCase();
}

function defaultCollectionName(name: string): string {
	return name.split(".").map(snake).join("__");
}

function physicalName(
	configuration: ApplicationConfiguration,
	identity: string,
	inline: unknown,
	fallback: string,
): string {
	const override = configuration.postgres.physicalNames[identity];
	if (inline !== null && inline !== undefined && override !== undefined)
		throw new CompilerDiagnosticError(
			"QP-SCHEMA-005",
			"invalidPhysicalName",
			`${identity} supplies both inline and questpie.json physical names`,
		);
	const candidate = String(
		inline ?? override ?? shortenedPostgresName(identity, fallback),
	);
	return validatedPhysicalName(identity, candidate);
}
function boundConstraints(
	configuration: ApplicationConfiguration,
	collectionIdentity: string,
	tableName: string,
	field: Readonly<{ path: readonly string[]; contract: RecordValue }>,
): RecordValue[] {
	const type = record(field.contract.type, "Field type");
	const fieldIdentity = fieldSemanticIdentity(collectionIdentity, field.path);
	const bounds =
		type.kind === "text"
			? (["minLength", "maxLength"] as const)
			: type.kind === "integer" || type.kind === "bigint"
				? (["minimum", "maximum"] as const)
				: [];
	return bounds.flatMap((bound) => {
		const value = type[bound];
		if (typeof value !== "number" && typeof value !== "string") return [];
		const identity = `${fieldIdentity}/invariant:${bound}`;
		const left =
			bound === "minLength" || bound === "maxLength"
				? {
						kind: "textLength",
						expression: { kind: "field", field: fieldIdentity },
					}
				: { kind: "field", field: fieldIdentity };
		return [
			{
				kind: "check",
				identity,
				postgresName: physicalName(
					configuration,
					identity,
					null,
					`qp_ck_${tableName}_${field.path.map(snake).join("_")}_${snake(bound)}`,
				),
				expression: {
					kind: "compare",
					operator:
						bound === "minLength" || bound === "minimum"
							? "greaterThanOrEqual"
							: "lessThanOrEqual",
					left,
					right: { kind: "literal", value },
				},
			},
		];
	});
}

function fieldSemanticIdentity(
	collectionIdentity: string,
	path: readonly string[],
): string {
	return `${collectionIdentity}/${path.map((segment) => `field:${segment}`).join("/")}`;
}

function resolvedCollectionEntries(
	resource: NormalizedResource,
	kind: "constraints" | "fields" | "indexes",
): Array<{
	key: string;
	contract: RecordValue;
	contributionIdentity: string | null;
}> {
	const resolved: Array<{
		key: string;
		contract: RecordValue;
		contributionIdentity: string | null;
	}> = entries(resource.value[kind]).map(([key, value]) => ({
		key,
		contract: value,
		contributionIdentity: null,
	}));
	for (const rawAugmentation of (resource.value.augmentations ??
		[]) as readonly unknown[]) {
		const augmentation = record(rawAugmentation, "augmentation");
		const contributionIdentity = `${resource.identity}/augmentation:${string(augmentation.name, "augmentation.name")}`;
		for (const [key, value] of entries(augmentation[kind])) {
			if (resolved.some((entry) => entry.key === key))
				throw new CompilerDiagnosticError(
					"QP-COMPOSE-014",
					"augmentationMemberCollision",
					`${resource.identity}/${kind.slice(0, -1)}:${key} has multiple contributors`,
				);
			resolved.push({
				key,
				contract: value,
				contributionIdentity,
			});
		}
	}
	return resolved.sort((left, right) => compareAscii(left.key, right.key));
}

function resolvedFields(resource: NormalizedResource): Array<{
	path: readonly string[];
	contract: RecordValue;
	contributionIdentity: string | null;
}> {
	return resolvedCollectionEntries(resource, "fields").flatMap((entry) =>
		flattenFieldContracts({ [entry.key]: entry.contract }).map((field) => ({
			...field,
			contributionIdentity: entry.contributionIdentity,
		})),
	);
}

export function projectMemberContributions(
	resource: NormalizedResource,
): ReadonlyArray<
	Readonly<{ identity: string; contributionIdentity: string | null }>
> {
	if (resource.kind !== "collection") return [];
	return [
		...resolvedFields(resource).map((entry) => ({
			identity: fieldSemanticIdentity(resource.identity, entry.path),
			contributionIdentity: entry.contributionIdentity,
		})),
		...resolvedCollectionEntries(resource, "constraints").map((entry) => ({
			identity: `${resource.identity}/constraint:${entry.key}`,
			contributionIdentity: entry.contributionIdentity,
		})),
		...resolvedCollectionEntries(resource, "indexes").map((entry) => ({
			identity: `${resource.identity}/index:${entry.key}`,
			contributionIdentity: entry.contributionIdentity,
		})),
		...entries(resource.value.relations).map(([key]) => ({
			identity: `${resource.identity}/relation:${key}`,
			contributionIdentity: null,
		})),
	].sort((left, right) => compareAscii(left.identity, right.identity));
}

export function projectManifest(
	configuration: ApplicationConfiguration,
	resources: readonly NormalizedResource[],
): Readonly<Record<string, unknown>> {
	const collections = resources.filter(
		(resource) => resource.kind === "collection",
	);
	const schemaCollections = collections.map((resource) => {
		const fields = resolvedFields(resource);
		const tableName = physicalName(
			configuration,
			resource.identity,
			resource.value.postgresName,
			defaultCollectionName(resource.name),
		);
		const projectedFields = fields.map(({ path, contract }) => {
			const identity = fieldSemanticIdentity(resource.identity, path);
			return {
				identity,
				path,
				postgresName: physicalName(
					configuration,
					identity,
					contract.postgresName,
					path.map(snake).join("_"),
				),
				type: contract.type,
				nullable: contract.nullable,
				default: contract.default,
				collation:
					record(contract.type, "field type").kind === "text"
						? "questpie.binary"
						: null,
			};
		});
		const constraints = [
			...resolvedCollectionEntries(resource, "constraints").map(
				({ key, contract: value }) => {
					const identity = `${resource.identity}/constraint:${key}`;
					const prefix =
						value.kind === "primaryKey"
							? "qp_pk"
							: value.kind === "unique"
								? "qp_uq"
								: "qp_ck";
					const postgresName = physicalName(
						configuration,
						identity,
						value.postgresName,
						`${prefix}_${tableName}_${snake(key)}`,
					);
					if (value.kind === "check")
						return {
							kind: "check",
							identity,
							postgresName,
							expression: projectCheckExpression(
								identity,
								resource.identity,
								value.expression as RecordValue,
								projectedFields,
							),
						};
					const references = (value.fields as readonly unknown[]).map((field) =>
						fieldSemanticIdentity(resource.identity, fieldPath(field)),
					);
					return {
						kind: value.kind,
						identity,
						postgresName,
						fields: validateKeyConstraintFields(
							identity,
							references,
							projectedFields,
						),
					};
				},
			),
			...fields.flatMap((field) =>
				boundConstraints(configuration, resource.identity, tableName, field),
			),
		].sort((left, right) =>
			compareAscii(String(left.identity), String(right.identity)),
		);
		const primaryKeys = constraints.filter(
			(item) => item.kind === "primaryKey",
		);
		if (primaryKeys.length !== 1)
			throw new CompilerDiagnosticError(
				"QP-SCHEMA-001",
				"invalidDefinition",
				`${resource.identity} requires exactly one named primary key`,
			);
		const indexes = resolvedCollectionEntries(resource, "indexes").map(
			({ key, contract: value }) => {
				const identity = `${resource.identity}/index:${key}`;
				const terms = (value.fields as readonly unknown[]).map((rawField) => {
					const field = indexField(rawField);
					return {
						field: fieldSemanticIdentity(resource.identity, field.field),
						order: field.order,
						nulls: field.nulls,
						operatorClass: "typeDefault",
						collation:
							projectedFields.find(
								(candidate) =>
									candidate.identity ===
									fieldSemanticIdentity(resource.identity, field.field),
							)?.collation === "questpie.binary"
								? "field"
								: null,
					};
				});
				return {
					kind: "btree",
					identity,
					postgresName: physicalName(
						configuration,
						identity,
						value.postgresName,
						`qp_ix_${tableName}_${snake(key)}`,
					),
					fields: validateBtreeIndexTerms(identity, terms, projectedFields),
				};
			},
		);
		const relations = entries(resource.value.relations)
			.filter(([, value]) => value.kind === "toOne")
			.map(([key, value]) => {
				const identity = `${resource.identity}/relation:${key}`;
				return {
					kind: "toOne",
					identity,
					target: value.target,
					fields: (value.fields as readonly unknown[]).map((field) =>
						fieldSemanticIdentity(resource.identity, fieldPath(field)),
					),
					references: (value.references as readonly unknown[]).map((field) =>
						fieldSemanticIdentity(String(value.target), fieldPath(field)),
					),
					constraintPostgresName: physicalName(
						configuration,
						identity,
						value.postgresName,
						`qp_fk_${tableName}_${snake(key)}`,
					),
					onDelete: value.onDelete,
					onUpdate: value.onUpdate,
				};
			});
		return {
			identity: resource.identity,
			postgresName: tableName,
			fields: projectedFields,
			constraints,
			indexes,
			relations,
		};
	});
	const collectionMap = new Map(
		schemaCollections.map((collection) => [collection.identity, collection]),
	);
	const knownPhysicalTargets = new Set<string>();
	const globalNames = new Map<string, string>();
	for (const collection of schemaCollections) {
		knownPhysicalTargets.add(collection.identity);
		reservePostgresRelationName(
			globalNames,
			collection.postgresName,
			collection.identity,
		);
		const localNames = new Map<string, string>();
		for (const field of collection.fields) {
			knownPhysicalTargets.add(field.identity);
			const previous = localNames.get(`field:${field.postgresName}`);
			if (previous)
				throw new CompilerDiagnosticError(
					"QP-SCHEMA-006",
					"physicalNameCollision",
					`${previous} and ${field.identity} share ${field.postgresName}`,
				);
			localNames.set(`field:${field.postgresName}`, field.identity);
		}
		for (const constraint of collection.constraints) {
			knownPhysicalTargets.add(String(constraint.identity));
			const previous = localNames.get(`constraint:${constraint.postgresName}`);
			if (previous)
				throw new CompilerDiagnosticError(
					"QP-SCHEMA-006",
					"physicalNameCollision",
					`${previous} and ${constraint.identity} share ${constraint.postgresName}`,
				);
			localNames.set(
				`constraint:${constraint.postgresName}`,
				String(constraint.identity),
			);
			if (constraint.kind === "primaryKey" || constraint.kind === "unique")
				reservePostgresRelationName(
					globalNames,
					String(constraint.postgresName),
					String(constraint.identity),
				);
		}
		for (const relation of collection.relations) {
			knownPhysicalTargets.add(relation.identity);
			const previous = localNames.get(
				`constraint:${relation.constraintPostgresName}`,
			);
			if (previous)
				throw new CompilerDiagnosticError(
					"QP-SCHEMA-006",
					"physicalNameCollision",
					`${previous} and ${relation.identity} share ${relation.constraintPostgresName}`,
				);
			localNames.set(
				`constraint:${relation.constraintPostgresName}`,
				relation.identity,
			);
			const target = collectionMap.get(String(relation.target));
			if (!target)
				throw new CompilerDiagnosticError(
					"QP-SCHEMA-003",
					"invalidReference",
					`${relation.identity} targets unknown ${relation.target}`,
				);
			const localFields = new Map(
				collection.fields.map((field) => [field.identity, field]),
			);
			const targetFields = new Set(
				target.fields.map((field) => field.identity),
			);
			if (
				relation.fields.length !== relation.references.length ||
				relation.fields.some((field) => !localFields.has(field)) ||
				relation.references.some((field) => !targetFields.has(field))
			)
				throw new CompilerDiagnosticError(
					"QP-SCHEMA-003",
					"invalidReference",
					`${relation.identity} has an invalid endpoint`,
				);
			const referencedKey = target.constraints.some(
				(constraint) =>
					(constraint.kind === "primaryKey" || constraint.kind === "unique") &&
					canonicalBytes(constraint.fields) ===
						canonicalBytes(relation.references),
			);
			if (!referencedKey)
				throw new CompilerDiagnosticError(
					"QP-SCHEMA-003",
					"invalidReference",
					`${relation.identity} does not reference a primary or unique key`,
				);
			if (
				relation.onDelete === "setNull" &&
				relation.fields.some(
					(field) => localFields.get(field)?.nullable !== true,
				)
			)
				throw new CompilerDiagnosticError(
					"QP-SCHEMA-003",
					"invalidReference",
					`${relation.identity} setNull requires nullable local Fields`,
				);
		}
		for (const index of collection.indexes) {
			knownPhysicalTargets.add(index.identity);
			reservePostgresRelationName(
				globalNames,
				index.postgresName,
				index.identity,
			);
		}
	}
	for (const identity of Object.keys(configuration.postgres.physicalNames))
		if (!knownPhysicalTargets.has(identity))
			throw new CompilerDiagnosticError(
				"QP-SCHEMA-003",
				"invalidReference",
				`postgres.physicalNames references unknown ${identity}`,
			);
	const schema = {
		format: "questpie.schema-projection",
		version: 1,
		application: {
			name: configuration.application.name,
			postgresSchema: validatedApplicationSchemaName(
				`application:${configuration.application.name}`,
				configuration.postgres.schema,
			),
		},
		requiredPostgres: {
			minimumMajor: 16,
			databaseCollation: configuration.postgres.databaseCollation,
			databaseCType: configuration.postgres.databaseCType,
			extensions: configuration.postgres.extensions.map((name) => ({ name })),
		},
		collections: schemaCollections,
	};
	const dataRelations = projectDataRelations(collections, schemaCollections);
	const data = {
		format: "questpie.data-contract-projection",
		version: 1,
		applicationIdentity: `application:${configuration.application.name}`,
		collections: schemaCollections.map((collection) => {
			const primary = collection.constraints.find(
				(constraint) => constraint.kind === "primaryKey",
			);
			return {
				identity: collection.identity,
				primaryKey: {
					identity: primary?.identity,
					fields: primary?.fields,
				},
				fields: collection.fields.map((field) => ({
					identity: field.identity,
					path: field.path,
					codec: field.type,
					nullable: field.nullable,
					hasDefault: field.default !== null,
				})),
				relations: dataRelations.get(collection.identity) ?? [],
			};
		}),
	};
	return {
		format: "questpie.manifest",
		version: 1,
		application: { name: configuration.application.name },
		composition: {
			resources: resources.map((resource) => ({
				identity: resource.identity,
				contributions: resource.contributions.map((contribution) => ({
					identity: contribution.identity,
					structuralContractDigest: contribution.structuralContractDigest,
				})),
			})),
		},
		schema,
		data,
	};
}
