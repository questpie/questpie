import {
	canonicalBytes,
	compareAscii,
	contentDigest,
	digest,
} from "../canonical";
import {
	projectPostgresChangeCapture,
	type SchemaProjectionV1,
} from "../schema";
import type { NormalizedResource } from "../types";

type JsonRecord = Readonly<Record<string, unknown>>;

export type LiveQueryArtifactFile =
	| "change-capture-boundary.json"
	| "change-ledger.json"
	| "change-reconciliation.json"
	| "live-query-dependency-algebra.json"
	| "live-query-limits.json"
	| "live-query-resume.json"
	| "query-watchability.json";

const dependencyAlgebra = Object.freeze({
	artifact: "questpie.live-query-dependency-algebra",
	version: 1,
	tokens: [
		"contextBootstrapPoint",
		"collectionPoint",
		"collectionRange",
		"orderingBoundary",
		"pageSentinel",
		"policyEvidencePoint",
		"relationEndpoint",
		"relationMiss",
		"tenantPartition",
	],
	reads: {
		emptyRange: "recorded",
		miss: "recorded",
		page: "completeOrderAndFirstPlusOne",
		branch: "executedOnly",
		nested: "joinRootObservationScope",
	},
	matching: "conservativeOverlapWithoutFalseNegative",
	maximumTokensPerPlan: 256,
});

const changeLedger = Object.freeze({
	artifact: "questpie.change-ledger",
	version: 1,
	storage: "postgresql",
	writeBoundary: "sameBusinessTransaction",
	fact: {
		identity: "uuid",
		transaction: "xid8",
		collection: "resourceIdentity",
		kind: ["delete", "insert", "truncate", "update"],
		keys: "boundedCanonicalKeySetOrConservativeCollection",
	},
	wake: {
		mechanism: "listenNotify",
		authority: "hintOnly",
		tolerates: ["absent", "coalesced", "delayed", "duplicate", "reordered"],
	},
});

const reconciliation = Object.freeze({
	artifact: "questpie.change-reconciliation",
	version: 1,
	frontier: {
		kind: "postgresVisibilityHorizon",
		value: "xid8Exclusive",
		advanceTo: "pgSnapshotXmin",
		process: "visibleFactsWithPriorLeXidLtNext",
		atomicWith: "factEffectsAndConsumerFrontier",
	},
	forbiddenFrontiers: ["maxBigserial", "maxTimestamp", "maxTriggerXid"],
	startup: ["listenCommit", "durableReconcile", "consumeWakeHints"],
	retention: "belowMinimumAcknowledgedConsumerHorizonOnly",
	wrap: "fullXid8EpochAware",
	longTransaction: "boundsLagAndCanFailReadiness",
});

const resume = Object.freeze({
	artifact: "questpie.live-query-resume",
	version: 1,
	token: {
		clientVisibility: "opaque",
		authenticated: true,
		bindings: [
			"applicationDeployment",
			"authorityPartition",
			"normalizedInput",
			"queryAndWireVersion",
			"retainedGeneration",
		],
	},
	acknowledgement: "lastClientAcceptedCompleteResult",
	unavailable: "freshAuthorizedReset",
	persistentOfflineResume: false,
	crossQueryAtomicity: false,
});

const captureBoundary = Object.freeze({
	artifact: "questpie.change-capture-boundary",
	version: 1,
	mechanism: "compilerOwnedPostgresqlTriggers",
	supportedWrites: [
		"cascade",
		"copyFrom",
		"externalManagedRole",
		"frameworkMutation",
		"merge",
		"onConflict",
		"rawSqlWrite",
		"truncate",
	],
	unsupported: [
		"disabledOrDroppedTrigger",
		"partitionedReactiveCollection",
		"rawSqlReadWithoutClosedDependency",
		"replicationRoleBypass",
		"superuserBypass",
	],
	drift: "schemaFingerprintFailure",
	indexAuthoring: "foundationalBtreeOnly",
	rls: "notEmitted",
});

const limits = Object.freeze({
	artifact: "questpie.live-query-limits",
	version: 1,
	limits: {
		activePerPrincipal: 64,
		bufferedBytesPerClient: 2_097_152,
		dependencyTokensPerPlan: 256,
		fanoutPerBatch: 1024,
		ledgerLagMilliseconds: 30_000,
		resultBytes: 1_048_576,
		retainedTokensPerPrincipal: 128,
		retentionMilliseconds: 86_400_000,
	},
	slowConsumer: "replacePendingThenResetOrDisconnect",
	hotChanges: "coalesceDirtyWithoutAdvancingUnprocessedFrontier",
});

function record(value: unknown, label: string): JsonRecord {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new TypeError(`${label} must be an object`);
	return value as JsonRecord;
}

function records(value: unknown, label: string): readonly JsonRecord[] {
	if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
	return value.map((item) => record(item, label));
}

function collectExpressionCollections(
	value: unknown,
	collections: Set<string>,
): boolean {
	if (!value || typeof value !== "object") return false;
	if (Array.isArray(value))
		return value.reduce(
			(found, item) => collectExpressionCollections(item, collections) || found,
			false,
		);
	const expression = value as JsonRecord;
	if (typeof expression.collection === "string")
		collections.add(expression.collection);
	let tenant =
		expression.kind === "executionFact" && expression.source === "tenant";
	for (const child of Object.values(expression))
		tenant = collectExpressionCollections(child, collections) || tenant;
	return tenant;
}

function policyObservation(
	policy: JsonRecord,
): Readonly<{ collections: readonly string[]; tenant: boolean }> {
	const collections = new Set<string>();
	const operations = record(policy.operations, "Policy operations");
	const read =
		operations.read === undefined
			? null
			: record(operations.read, "Policy read");
	let tenant = read
		? collectExpressionCollections(read.rows, collections)
		: false;
	if (policy.fields) {
		const fields = record(policy.fields, "Policy Fields");
		for (const rule of records(
			fields.selectedOutput ?? [],
			"selected output rules",
		))
			tenant = collectExpressionCollections(rule.when, collections) || tenant;
	}
	return { collections: [...collections].sort(compareAscii), tenant };
}

function structuralSlots(
	input: Readonly<{
		contextProjection: JsonRecord;
		dataProjection: JsonRecord;
		policyProjection: JsonRecord;
		queryProjection: JsonRecord;
	}>,
): readonly JsonRecord[] {
	const context =
		input.contextProjection.context === null ||
		input.contextProjection.context === undefined
			? null
			: record(input.contextProjection.context, "Context projection");
	const contextSlot = context
		? {
				kind: "context",
				identity: String(context.identity),
				projectionDigest: digest(
					"questpie-context-projection-v1",
					input.contextProjection,
				),
				tokens: ["contextBootstrapPoint", "tenantPartition"],
			}
		: null;
	const policies = new Map(
		records(input.policyProjection.policies, "Policy projection").map(
			(item) => {
				const program = record(item.program, "Policy program");
				return [String(program.identity), program] as const;
			},
		),
	);
	const relations = new Map<string, JsonRecord>();
	for (const collection of records(
		input.dataProjection.collections,
		"Data Collections",
	))
		for (const relation of records(
			collection.relations ?? [],
			"Collection Relations",
		))
			relations.set(String(relation.identity), relation);
	const querySlots = records(
		input.queryProjection.queries,
		"Query projection",
	).map((query) => {
		const template = record(query.template, "Data Query Template");
		const policyIdentity = String(query.policy);
		const program = policies.get(policyIdentity);
		if (!program)
			throw new TypeError(`Query references unknown ${policyIdentity}`);
		const observed = policyObservation(program);
		const collectionSet = new Set([
			String(template.from),
			...observed.collections,
		]);
		const relationIdentities = records(template.select, "Query selection")
			.filter((selection) => selection.kind === "toOne")
			.map((selection) => String(selection.relation))
			.sort(compareAscii);
		for (const identity of relationIdentities) {
			const relation = relations.get(identity);
			if (!relation)
				throw new TypeError(`Query references unknown ${identity}`);
			collectionSet.add(String(relation.target));
		}
		const tokens = ["collectionRange"];
		if (records(template.order ?? [], "Query order").length > 0)
			tokens.push("orderingBoundary");
		if (template.page) tokens.push("pageSentinel");
		if (observed.collections.length > 0) tokens.push("policyEvidencePoint");
		if (relationIdentities.length > 0)
			tokens.push("relationEndpoint", "relationMiss");
		if (observed.tenant) tokens.push("tenantPartition");
		return {
			kind: "structuralQuery",
			templateDigest: String(query.digest),
			policy: policyIdentity,
			policyProgramDigest: digest("questpie-policy-program-v1", program),
			collections: [...collectionSet].sort(compareAscii),
			relations: relationIdentities,
			tokens,
		};
	});
	querySlots.sort((left, right) =>
		compareAscii(left.templateDigest, right.templateDigest),
	);
	return [...(contextSlot ? [contextSlot] : []), ...querySlots];
}

function hasUnsupportedRead(resource: NormalizedResource): boolean {
	const declared =
		resource.contract.readCapabilities ?? resource.contract.reads;
	if (declared === undefined) return false;
	return (
		!Array.isArray(declared) ||
		declared.some((capability) => capability !== "structuralQuery")
	);
}

export function projectLiveQueryCompilation(
	input: Readonly<{
		resources: readonly NormalizedResource[];
		contextProjection: JsonRecord;
		dataProjection: JsonRecord;
		policyProjection: JsonRecord;
		queryProjection: JsonRecord;
	}>,
): Readonly<{
	artifacts: Readonly<Record<LiveQueryArtifactFile, JsonRecord>>;
	bytes: Readonly<Record<LiveQueryArtifactFile, string>>;
	fileDigests: Readonly<Record<LiveQueryArtifactFile, string>>;
	semanticDigests: Readonly<{
		watchability: string;
		dependencyAlgebra: string;
		changeLedger: string;
		reconciliation: string;
		resume: string;
		captureBoundary: string;
		limits: string;
	}>;
}> {
	const queryResources = input.resources.filter(
		(resource) =>
			resource.kind === "query" && resource.contract.exposure === "network",
	);
	const possibleSlots =
		queryResources.length === 0 ? [] : structuralSlots(input);
	const queries = queryResources
		.map((resource) => {
			const unsupported = hasUnsupportedRead(resource);
			const slots = unsupported ? [] : possibleSlots;
			return {
				artifact: "questpie.query-watchability",
				version: 1,
				query: resource.identity,
				call: "sameGeneratedMethod",
				inputCodec: `operation:${resource.name}:input`,
				outputCodec: `operation:${resource.name}:output`,
				contractDigest: digest(
					"questpie-executable-contract-v1",
					resource.contract,
				),
				watchable: !unsupported,
				unsupportedReason: unsupported ? "unsupportedRawRead" : null,
				observation: {
					declared: "compilerDerivedReadSites",
					actual: "runtimeObservedSupportedReads",
					commit: "replaceAfterSuccessfulRecompute",
					failed: "preserveLastSuccessfulPlan",
				},
				delivery: ["initial", "reset", "update"],
				result: "completeValidatedQueryOutput",
				possibleObservationSlots: slots,
				possibleObservationSlotsDigest: digest(
					"questpie-live-query-possible-observation-slots-v1",
					slots,
				),
			};
		})
		.sort((left, right) => compareAscii(left.query, right.query));
	const watchability = {
		format: "questpie.query-watchability-projection",
		version: 1,
		queries,
	};
	const artifacts = {
		"change-capture-boundary.json": captureBoundary,
		"change-ledger.json": changeLedger,
		"change-reconciliation.json": reconciliation,
		"live-query-dependency-algebra.json": dependencyAlgebra,
		"live-query-limits.json": limits,
		"live-query-resume.json": resume,
		"query-watchability.json": watchability,
	} satisfies Record<LiveQueryArtifactFile, JsonRecord>;
	const bytes = Object.fromEntries(
		Object.entries(artifacts).map(([path, artifact]) => [
			path,
			canonicalBytes(artifact),
		]),
	) as Record<LiveQueryArtifactFile, string>;
	const fileDigests = Object.fromEntries(
		Object.entries(bytes).map(([path, value]) => [path, contentDigest(value)]),
	) as Record<LiveQueryArtifactFile, string>;
	return {
		artifacts,
		bytes,
		fileDigests,
		semanticDigests: {
			watchability: digest(
				"questpie:p4:watchabilityProjection:v1",
				watchability,
			),
			dependencyAlgebra: digest(
				"questpie:p4:dependencyAlgebraProjection:v1",
				dependencyAlgebra,
			),
			changeLedger: digest(
				"questpie:p4:changeLedgerProjection:v1",
				changeLedger,
			),
			reconciliation: digest(
				"questpie:p4:reconciliationProjection:v1",
				reconciliation,
			),
			resume: digest("questpie:p4:resumeProjection:v1", resume),
			captureBoundary: digest(
				"questpie:p4:captureBoundaryProjection:v1",
				captureBoundary,
			),
			limits: digest("questpie:p4:limitsProjection:v1", limits),
		},
	};
}

export function projectLiveQueryChangeCapture(
	schema: SchemaProjectionV1,
	projection: ReturnType<typeof projectLiveQueryCompilation>,
) {
	const reactiveIdentities = new Set<string>();
	for (const query of projection.artifacts["query-watchability.json"]
		.queries as readonly Readonly<{
		watchable: boolean;
		possibleObservationSlots: readonly Readonly<{
			kind: string;
			collections?: readonly string[];
		}>[];
	}>[])
		if (query.watchable)
			for (const slot of query.possibleObservationSlots)
				if (slot.kind === "structuralQuery")
					for (const identity of slot.collections ?? [])
						reactiveIdentities.add(identity);
	return projectPostgresChangeCapture({
		applicationName: schema.application.name,
		postgresSchema: schema.application.postgresSchema,
		collections: schema.collections
			.filter((collection) =>
				reactiveIdentities.has(String(collection.identity)),
			)
			.map((collection) => {
				const constraints = collection.constraints as readonly JsonRecord[];
				const fields = collection.fields as readonly JsonRecord[];
				const primary = constraints.find(
					(constraint) => constraint.kind === "primaryKey",
				);
				if (!primary || !Array.isArray(primary.fields))
					throw new TypeError(
						`reactive Collection ${String(collection.identity)} has no primary key`,
					);
				return {
					identity: String(collection.identity),
					postgresName: String(collection.postgresName),
					keyColumns: primary.fields.map((identity) => {
						const field = fields.find(
							(candidate) => candidate.identity === identity,
						);
						if (!field)
							throw new TypeError(
								`reactive Collection key ${String(identity)} is missing`,
							);
						return String(field.postgresName);
					}),
				};
			}),
	});
}
