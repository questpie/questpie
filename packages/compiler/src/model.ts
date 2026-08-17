import { canonicalBytes, compareAscii, digest } from "./canonical";
import { compositionContract } from "./composition";
import { CompilerDiagnosticError } from "./diagnostic";
import { normalizeDeclaredErrors } from "./operation-errors";
import { normalizeReactionContract } from "./reaction";
import { normalizeBoundPolicy } from "./relational";
import {
	fieldPath,
	flattenFieldContracts,
	indexField,
	localCheckContract,
} from "./schema";
import type {
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

function constraintContract(value: RecordValue): RecordValue {
	const kind = string(value.kind, "constraint.kind");
	if (kind === "check")
		return {
			kind,
			expression: localCheckContract(
				value.expression,
				"constraint.check expression",
			),
			postgresName:
				typeof value.postgresName === "string" ? value.postgresName : null,
		};
	return {
		kind,
		fields: (value.fields as readonly unknown[]).map(fieldPath),
		postgresName:
			typeof value.postgresName === "string" ? value.postgresName : null,
	};
}

function indexContract(value: RecordValue): RecordValue {
	return {
		kind: "btree",
		fields: (value.fields as readonly unknown[]).map(indexField),
		postgresName:
			typeof value.postgresName === "string" ? value.postgresName : null,
	};
}

function relationContract(value: RecordValue): RecordValue {
	if (value.kind === "toMany") {
		const keys = Object.keys(value).sort(compareAscii);
		if (canonicalBytes(keys) !== canonicalBytes(["inverseOf", "kind"]))
			throw new CompilerDiagnosticError(
				"QP-SCHEMA-001",
				"invalidDefinition",
				"relation.toMany accepts only inverseOf",
			);
		return {
			kind: "toMany",
			inverseOf: string(value.inverseOf, "relation.inverseOf"),
		};
	}
	return {
		kind: "toOne",
		target: value.target,
		fields: (value.fields as readonly unknown[]).map(fieldPath),
		references: (value.references as readonly unknown[]).map(fieldPath),
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
		fields: flattenFieldContracts(value.fields).map(({ contract }) => contract),
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
	if (
		valueBrand.resourceKind === "query" ||
		valueBrand.resourceKind === "mutation"
	)
		return operationContract(valueBrand.resourceKind, value);
	if (valueBrand.resourceKind === "policy")
		return normalizeBoundPolicy(value).program as unknown as RecordValue;
	if (valueBrand.resourceKind === "service")
		return compositionContract("service", value);
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
		.filter((item) => item.value["__questpie"] !== undefined)
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

function codecContract(value: unknown, optionalAllowed = false): unknown {
	const codec = record(value, "codec");
	if (codec.kind === "object") {
		return {
			kind: "object",
			properties: Object.fromEntries(
				Object.entries(record(codec.properties, "codec properties"))
					.sort(([left], [right]) => compareAscii(left, right))
					.map(([key, child]) => [key, codecContract(child, true)]),
			),
		};
	}
	if (codec.kind === "array") {
		return {
			kind: "array",
			items: codecContract(codec.items),
		};
	}
	if (codec.kind === "nullable")
		return { kind: "nullable", codec: codecContract(codec.codec) };
	if (codec.kind === "optional") {
		if (!optionalAllowed)
			throw new CompilerDiagnosticError(
				"QP-COMPOSE-013",
				"structuralTypeError",
				"codec.optional is valid only for an object property",
			);
		return { kind: "optional", codec: codecContract(codec.codec) };
	}
	const kind = string(codec.kind, "codec kind");
	if (!["boolean", "integer", "text", "timestamp", "uuid"].includes(kind))
		throw new CompilerDiagnosticError(
			"QP-COMPOSE-013",
			"structuralTypeError",
			`unsupported codec kind ${kind}`,
		);
	return { kind };
}

function operationContract(
	kind: "mutation" | "query",
	value: RecordValue,
): RecordValue {
	const declaredErrors = normalizeDeclaredErrors(
		value.errors,
		kind,
		codecContract,
	);
	let policyContract: RecordValue | null = null;
	if (kind === "mutation") {
		const policy = record(value.policy, `${kind}.policy`);
		if (
			policy.kind !== "booleanExpression" ||
			policy.operator !== "authenticated" ||
			!Array.isArray(policy.operands) ||
			policy.operands.length !== 0
		)
			throw new CompilerDiagnosticError(
				"QP-COMPOSE-013",
				"structuralTypeError",
				`${kind}.policy is outside the accepted authenticated admission scope`,
			);
		policyContract = { kind: "authenticated" };
	}
	return {
		format: `questpie.${kind}-definition-contract`,
		version: 1,
		name: string(value.name, `${kind}.name`),
		input: codecContract(value.input),
		output: codecContract(value.output),
		...(kind === "mutation" ? { declaredErrors, policy: policyContract } : {}),
		exposure: value.network === true ? "network" : "server",
		executableSlots: ["handler"],
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
		fields: flattenFieldContracts(value.fields).map(({ contract }) => contract),
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
		if (
			(item.value.kind === "dataQuery" ||
				item.value.kind === "collectionOperationSet") &&
			item.value["__questpie"] === undefined
		)
			continue;
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
		} else if (kind === "service" || kind === "context") {
			resources.push({
				identity,
				kind,
				name,
				contract: compositionContract(kind, item.value),
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
		} else if (kind === "query" || kind === "mutation") {
			resources.push({
				identity,
				kind,
				name,
				contract: operationContract(kind, item.value),
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
		} else if (kind === "reaction") {
			resources.push({
				identity,
				kind,
				name,
				contract: normalizeReactionContract(item.value, codecContract),
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
		} else if (kind === "policy") {
			resources.push({
				identity,
				kind,
				name,
				contract: normalizeBoundPolicy(item.value)
					.program as unknown as RecordValue,
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
