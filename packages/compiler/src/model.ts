import { createHash } from "node:crypto";

import { canonicalBytes, compareAscii, digest } from "./canonical";
import { CompilerDiagnosticError } from "./diagnostic";
import type {
	ApplicationConfiguration,
	EvaluatedExport,
	NormalizedResource,
	PackageInventory,
	PackageInventoryEntry,
	PackageResolution,
	SourceSpan,
} from "./types";

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

function fieldContract(key: string, value: RecordValue): RecordValue {
	const scalar = string(value.scalar, `${key}.scalar`);
	const options = record(value.options ?? {}, `${key}.options`);
	let type: RecordValue;
	if (scalar === "text")
		type = {
			kind: "text",
			minLength: options.minLength ?? null,
			maxLength: options.maxLength ?? null,
			collation: "questpie.binary",
		};
	else if (scalar === "timestamp")
		type = { kind: "timestamp", withTimezone: options.withTimezone ?? false };
	else if (scalar === "integer")
		type = {
			kind: "integer",
			minimum: options.minimum ?? null,
			maximum: options.maximum ?? null,
		};
	else if (scalar === "bigint")
		type = {
			kind: "bigint",
			minimum: options.minimum ?? null,
			maximum: options.maximum ?? null,
		};
	else if (scalar === "numeric")
		type = {
			kind: "numeric",
			precision: options.precision,
			scale: options.scale,
		};
	else type = { kind: scalar };
	const rawDefault = value.default;
	const normalizedDefault =
		(scalar === "timestamp" && rawDefault === "now") ||
		(scalar === "uuid" && rawDefault === "randomUuid")
			? { kind: rawDefault }
			: typeof rawDefault === "string" ||
				  typeof rawDefault === "boolean" ||
				  typeof rawDefault === "number"
				? { kind: "literal", value: rawDefault }
				: null;
	return {
		path: [key],
		type,
		nullable: value.nullable === true,
		default: normalizedDefault,
		postgresName:
			typeof value.postgresName === "string" ? value.postgresName : null,
	};
}

function constraintContract(value: RecordValue): RecordValue {
	return {
		kind: string(value.kind, "constraint.kind"),
		fields: (value.fields as readonly string[]).map((field) => [field]),
		postgresName:
			typeof value.postgresName === "string" ? value.postgresName : null,
	};
}

function indexContract(value: RecordValue): RecordValue {
	return {
		kind: "btree",
		fields: (value.fields as readonly string[]).map((field) => ({
			field: [field],
			order: "asc",
			nulls: "last",
		})),
		postgresName:
			typeof value.postgresName === "string" ? value.postgresName : null,
	};
}

function relationContract(value: RecordValue): RecordValue {
	return {
		kind: "toOne",
		target: value.target,
		fields: (value.fields as readonly string[]).map((field) => [field]),
		references: (value.references as readonly string[]).map((field) => [field]),
		onDelete: value.onDelete,
		onUpdate: value.onUpdate,
		postgresName:
			typeof value.postgresName === "string" ? value.postgresName : null,
	};
}

function augmentationContract(value: RecordValue): RecordValue {
	return {
		format: "questpie.collection-augmentation-contract",
		version: 1,
		name: string(value.name, "augmentation.name"),
		fields: entries(value.fields).map(([key, field]) =>
			fieldContract(key, field),
		),
		constraints: entries(value.constraints).map(([key, constraint]) => ({
			key,
			contract: constraintContract(constraint),
		})),
		indexes: entries(value.indexes).map(([key, index]) => ({
			key,
			contract: indexContract(index),
		})),
	};
}

function brand(value: RecordValue): RecordValue {
	return record(value["__questpie"], "Definition brand");
}

function inventoryIdentity(value: RecordValue): string {
	const valueBrand = brand(value);
	const resourceKind = string(valueBrand.resourceKind, "resource kind");
	const name = string(value.name, "resource name");
	return valueBrand.category === "augmentation"
		? `${resourceKind}-augmentation:${name}`
		: `${resourceKind}:${name}`;
}

function packageContract(value: RecordValue): RecordValue {
	const valueBrand = brand(value);
	if (valueBrand.category === "augmentation")
		return augmentationContract(value);
	if (valueBrand.resourceKind === "query") return queryContract(value);
	if (valueBrand.resourceKind === "collection")
		return ownerCollectionContract(value, []);
	throw new CompilerDiagnosticError(
		"QP-COMPOSE-006",
		"invalidPackageManifest",
		`unsupported Package export ${inventoryIdentity(value)}`,
	);
}

export function createPackageInventory(
	resolution: PackageResolution,
	exports: readonly EvaluatedExport[],
): PackageInventory {
	const inventoryEntries: PackageInventoryEntry[] = exports
		.map((item) => {
			const valueBrand = brand(item.value);
			const contract = packageContract(item.value);
			return {
				exportName: item.exportName,
				category: string(
					valueBrand.category,
					"Package category",
				) as PackageInventoryEntry["category"],
				resourceKind: string(valueBrand.resourceKind, "Package Resource Kind"),
				identity: inventoryIdentity(item.value),
				structuralContractDigest: digest(
					"questpie-structural-contract-v1",
					contract,
				),
			};
		})
		.sort((left, right) => {
			for (const key of ["category", "identity", "exportName"] as const) {
				const order = compareAscii(left[key], right[key]);
				if (order !== 0) return order;
			}
			return 0;
		});
	return {
		package: resolution,
		entries: inventoryEntries,
		digest: digest("questpie-package-inventory-v1", inventoryEntries),
	};
}

function codecContract(value: unknown): unknown {
	const codec = record(value, "codec");
	if (codec.kind === "object") {
		return {
			kind: "object",
			properties: Object.fromEntries(
				Object.entries(record(codec.properties, "codec properties"))
					.sort(([left], [right]) => compareAscii(left, right))
					.map(([key, child]) => [key, codecContract(child)]),
			),
		};
	}
	return { kind: string(codec.kind, "codec kind") };
}

function queryContract(value: RecordValue): RecordValue {
	return {
		format: "questpie.query-definition-contract",
		version: 1,
		name: string(value.name, "query.name"),
		input: codecContract(value.input),
		output: codecContract(value.output),
	};
}

function seedContract(value: RecordValue): RecordValue {
	return {
		format: "questpie.seed-definition-contract",
		version: 1,
		name: string(value.name, "seed.name"),
		dependsOn: [...((value.dependsOn ?? []) as readonly string[])].sort(
			compareAscii,
		),
		steps: (value.steps as readonly unknown[]).map((item) => {
			const step = record(item, "seed step");
			return {
				kind: string(step.kind, "seed step kind"),
				collection: string(step.collection, "seed step collection"),
				...(step.values === undefined
					? {}
					: { values: record(step.values, "seed values") }),
				...(step.key === undefined
					? {}
					: { key: record(step.key, "seed key") }),
				...(step.create === undefined
					? {}
					: { create: record(step.create, "seed create values") }),
				...(step.update === undefined
					? {}
					: { update: record(step.update, "seed update values") }),
			};
		}),
	};
}

function ownerCollectionContract(
	value: RecordValue,
	contributionIdentities: readonly string[],
): RecordValue {
	return {
		format: "questpie.collection-definition-contract",
		version: 1,
		name: string(value.name, "collection.name"),
		postgresName:
			typeof value.postgresName === "string" ? value.postgresName : null,
		fields: entries(value.fields).map(([key, field]) =>
			fieldContract(key, field),
		),
		constraints: entries(value.constraints).map(([key, constraint]) => ({
			key,
			contract: constraintContract(constraint),
		})),
		indexes: entries(value.indexes).map(([key, index]) => ({
			key,
			contract: indexContract(index),
		})),
		relations: entries(value.relations).map(([key, relation]) => ({
			key,
			contract: relationContract(relation),
		})),
		augmentations: [...contributionIdentities].sort(compareAscii),
	};
}

export function normalizeResources(
	exports: readonly EvaluatedExport[],
	inventories: readonly PackageInventory[],
): NormalizedResource[] {
	const inventoryAugmentations = new Map<
		string,
		Readonly<{
			digest: string;
			packageId: string;
			logicalPath: string;
			exportName: string;
			definedSpan: SourceSpan | null;
			memberSpans: Readonly<Record<string, SourceSpan>>;
		}>
	>();
	for (const inventory of inventories)
		for (const entry of inventory.entries)
			if (entry.category === "augmentation")
				inventoryAugmentations.set(entry.identity, {
					digest: entry.structuralContractDigest,
					packageId: inventory.package.id,
					logicalPath: inventory.package.entry
						.slice(inventory.package.root.length + 1)
						.replaceAll("\\", "/")
						.normalize("NFC"),
					exportName: entry.exportName,
					definedSpan:
						exports.find(
							(candidate) => candidate.exportName === entry.exportName,
						)?.span ?? null,
					memberSpans:
						exports.find(
							(candidate) => candidate.exportName === entry.exportName,
						)?.memberSpans ?? {},
				});

	const resources: NormalizedResource[] = [];
	for (const item of exports) {
		const valueBrand = brand(item.value);
		if (valueBrand.category !== "definition") continue;
		const kind = string(valueBrand.resourceKind, "Resource Kind");
		const name = string(item.value.name, "Resource name");
		const identity = `${kind}:${name}`;
		if (kind === "collection") {
			const contributions: Array<{
				identity: string;
				structuralContractDigest: string;
				packageId: string;
				logicalPath: string;
				exportName: string;
				definedSpan: SourceSpan | null;
				acceptedSpan: SourceSpan | null;
				memberSpans: Readonly<Record<string, SourceSpan>>;
			}> = [];
			const seen = new Set<string>();
			for (const [augmentationIndex, rawAugmentation] of (
				(item.value.augmentations ?? []) as readonly unknown[]
			).entries()) {
				const augmentation = record(rawAugmentation, "augmentation");
				const augmentationName = string(augmentation.name, "augmentation.name");
				const inventoryKey = `collection-augmentation:${augmentationName}`;
				const accepted = inventoryAugmentations.get(inventoryKey);
				if (!accepted)
					throw new CompilerDiagnosticError(
						"QP-COMPOSE-015",
						"invalidAugmentation",
						`${identity} did not accept an active Package Augmentation`,
						{ augmentation: augmentationName },
					);
				const contributionIdentity = `${identity}/augmentation:${augmentationName}`;
				if (seen.has(contributionIdentity))
					throw new CompilerDiagnosticError(
						"QP-COMPOSE-020",
						"duplicateContributionIdentity",
						`${contributionIdentity} is accepted twice`,
					);
				seen.add(contributionIdentity);
				const actualDigest = digest(
					"questpie-structural-contract-v1",
					augmentationContract(augmentation),
				);
				if (actualDigest !== accepted.digest)
					throw new CompilerDiagnosticError(
						"QP-COMPOSE-015",
						"invalidAugmentation",
						`${augmentationName} differs from the accepted Package contract`,
					);
				contributions.push({
					identity: contributionIdentity,
					structuralContractDigest: actualDigest,
					packageId: accepted.packageId,
					logicalPath: accepted.logicalPath,
					exportName: accepted.exportName,
					definedSpan: accepted.definedSpan,
					acceptedSpan: item.acceptanceSpans[augmentationIndex] ?? null,
					memberSpans: accepted.memberSpans,
				});
			}
			contributions.sort((left, right) =>
				compareAscii(left.identity, right.identity),
			);
			resources.push({
				identity,
				kind,
				name,
				contract: ownerCollectionContract(
					item.value,
					contributions.map((entry) => entry.identity),
				),
				contributions,
				origin: {
					logicalPath: item.logicalPath,
					exportName: item.exportName,
					packageId: item.packageId,
					span: item.span,
					memberSpans: item.memberSpans,
				},
				value: item.value,
			});
		} else if (kind === "query") {
			resources.push({
				identity,
				kind,
				name,
				contract: queryContract(item.value),
				contributions: [],
				origin: {
					logicalPath: item.logicalPath,
					exportName: item.exportName,
					packageId: item.packageId,
					span: item.span,
					memberSpans: item.memberSpans,
				},
				value: item.value,
			});
		} else if (kind === "seed") {
			resources.push({
				identity,
				kind,
				name,
				contract: seedContract(item.value),
				contributions: [],
				origin: {
					logicalPath: item.logicalPath,
					exportName: item.exportName,
					packageId: item.packageId,
					span: item.span,
					memberSpans: item.memberSpans,
				},
				value: item.value,
			});
		} else
			throw new CompilerDiagnosticError(
				"QP-COMPOSE-013",
				"structuralTypeError",
				`${identity} is outside BETA-01 compile scope`,
			);
	}
	resources.sort((left, right) => compareAscii(left.identity, right.identity));
	for (let index = 1; index < resources.length; index += 1) {
		const previous = resources[index - 1];
		const current = resources[index];
		if (!previous || !current) continue;
		if (previous.identity === current.identity)
			throw new CompilerDiagnosticError(
				"QP-COMPOSE-002",
				"duplicateResourceIdentity",
				`${current.identity} has more than one Owner`,
				{ origins: [previous.origin, current.origin] },
			);
	}
	return resources;
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

function shortenedPostgresName(identity: string, candidate: string): string {
	if (Buffer.byteLength(candidate) <= 63) return candidate;
	const suffix = createHash("sha256")
		.update(`questpie-postgres-name-v1\0${identity}`)
		.digest("hex")
		.slice(0, 12);
	let prefix = candidate;
	while (Buffer.byteLength(`${prefix}_${suffix}`) > 63)
		prefix = prefix.slice(0, -1);
	return `${prefix}_${suffix}`;
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
	if (
		!/^[a-z][a-z0-9_]*$/.test(candidate) ||
		Buffer.byteLength(candidate) > 63 ||
		candidate.startsWith("pg_") ||
		candidate.startsWith("questpie_")
	)
		throw new CompilerDiagnosticError(
			"QP-SCHEMA-005",
			"invalidPhysicalName",
			`${identity} has invalid PostgreSQL name ${candidate}`,
		);
	return candidate;
}

function boundConstraints(
	configuration: ApplicationConfiguration,
	collectionIdentity: string,
	tableName: string,
	field: Readonly<{ key: string; contract: RecordValue }>,
): RecordValue[] {
	const type = record(field.contract.type, "Field type");
	const fieldIdentity = `${collectionIdentity}/field:${field.key}`;
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
					`qp_ck_${tableName}_${snake(field.key)}_${snake(bound)}`,
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
	key: string;
	contract: RecordValue;
	contributionIdentity: string | null;
}> {
	return resolvedCollectionEntries(resource, "fields").map((entry) => ({
		...entry,
		contract: fieldContract(entry.key, entry.contract),
	}));
}

export function projectMemberContributions(
	resource: NormalizedResource,
): ReadonlyArray<
	Readonly<{ identity: string; contributionIdentity: string | null }>
> {
	if (resource.kind !== "collection") return [];
	return [
		...resolvedCollectionEntries(resource, "fields").map((entry) => ({
			identity: `${resource.identity}/field:${entry.key}`,
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
		const projectedFields = fields.map(({ key, contract }) => {
			const identity = `${resource.identity}/field:${key}`;
			return {
				identity,
				path: [key],
				postgresName: physicalName(
					configuration,
					identity,
					contract.postgresName,
					snake(key),
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
					return {
						kind: value.kind,
						identity,
						postgresName: physicalName(
							configuration,
							identity,
							value.postgresName,
							`${prefix}_${tableName}_${snake(key)}`,
						),
						fields: (value.fields as readonly string[]).map(
							(field) => `${resource.identity}/field:${field}`,
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
				return {
					kind: "btree",
					identity,
					postgresName: physicalName(
						configuration,
						identity,
						value.postgresName,
						`qp_ix_${tableName}_${snake(key)}`,
					),
					fields: (value.fields as readonly string[]).map((field) => ({
						field: `${resource.identity}/field:${field}`,
						order: "asc",
						nulls: "last",
						operatorClass: "typeDefault",
						collation:
							projectedFields.find(
								(candidate) =>
									candidate.identity === `${resource.identity}/field:${field}`,
							)?.collation === "questpie.binary"
								? "field"
								: null,
					})),
				};
			},
		);
		const relations = entries(resource.value.relations).map(([key, value]) => {
			const identity = `${resource.identity}/relation:${key}`;
			return {
				kind: "toOne",
				identity,
				target: value.target,
				fields: (value.fields as readonly string[]).map(
					(field) => `${resource.identity}/field:${field}`,
				),
				references: (value.references as readonly string[]).map(
					(field) => `${value.target}/field:${field}`,
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
		const previousTable = globalNames.get(`table:${collection.postgresName}`);
		if (previousTable)
			throw new CompilerDiagnosticError(
				"QP-SCHEMA-006",
				"physicalNameCollision",
				`${previousTable} and ${collection.identity} share ${collection.postgresName}`,
			);
		globalNames.set(`table:${collection.postgresName}`, collection.identity);
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
			const previous = globalNames.get(`index:${index.postgresName}`);
			if (previous)
				throw new CompilerDiagnosticError(
					"QP-SCHEMA-006",
					"physicalNameCollision",
					`${previous} and ${index.identity} share ${index.postgresName}`,
				);
			globalNames.set(`index:${index.postgresName}`, index.identity);
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
			postgresSchema: configuration.postgres.schema,
		},
		requiredPostgres: {
			minimumMajor: 16,
			databaseCollation: configuration.postgres.databaseCollation,
			databaseCType: configuration.postgres.databaseCType,
			extensions: configuration.postgres.extensions.map((name) => ({ name })),
		},
		collections: schemaCollections,
	};
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
				relations: collection.relations.map((relation) => ({
					kind: "toOne",
					identity: relation.identity,
					target: relation.target,
					fields: relation.fields,
					references: relation.references,
				})),
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

export function semanticDraft(
	resources: readonly NormalizedResource[],
): string {
	return canonicalBytes(
		resources.map((resource) => ({
			identity: resource.identity,
			contract: resource.contract,
			contributions: resource.contributions,
			origin: resource.origin,
		})),
	);
}
