type JsonRecord = Record<string, unknown>;

const digestPattern = /^[0-9a-f]{64}$/;

const tokenKinds = [
	"contextBootstrapPoint",
	"collectionPoint",
	"collectionRange",
	"orderingBoundary",
	"pageSentinel",
	"policyEvidencePoint",
	"relationEndpoint",
	"relationMiss",
	"tenantPartition",
] as const;

type LiveQueryTokenKind = (typeof tokenKinds)[number];

type LinkedContextObservationSlotV1 = Readonly<{
	kind: "context";
	identity: string;
	projectionDigest: string;
	tokens: readonly LiveQueryTokenKind[];
}>;

export type LinkedStructuralQueryObservationSlotV1 = Readonly<{
	kind: "structuralQuery";
	templateDigest: string;
	policy: string;
	policyProgramDigest: string;
	collections: readonly string[];
	relations: readonly string[];
	tokens: readonly LiveQueryTokenKind[];
}>;

export type LinkedQueryWatchabilityV1 = Readonly<{
	identity: string;
	watchable: boolean;
	inputCodec: unknown;
	outputCodec: unknown;
	contractDigest: string;
	context: LinkedContextObservationSlotV1 | null;
	structuralQueries: ReadonlyMap<
		string,
		LinkedStructuralQueryObservationSlotV1
	>;
	maximumTokensPerPlan: number;
	unsupportedReason: null | "unsupportedRawRead";
}>;

export type LinkedLiveQueryProgramV1 = Readonly<{
	format: "questpie.live-query-program";
	version: 1;
	queries: ReadonlyMap<string, LinkedQueryWatchabilityV1>;
	limits: Readonly<{
		activePerPrincipal: number;
		bufferedBytesPerClient: number;
		dependencyTokensPerPlan: number;
		fanoutPerBatch: number;
		ledgerLagMilliseconds: number;
		resultBytes: number;
		retainedTokensPerPrincipal: number;
		retentionMilliseconds: number;
	}>;
}>;

function fail(message: string): never {
	throw new TypeError(message);
}

function record(value: unknown, path: string): JsonRecord {
	if (value === null || typeof value !== "object" || Array.isArray(value))
		fail(`${path} must be an object`);
	return value as JsonRecord;
}

function exact(value: JsonRecord, keys: readonly string[], path: string): void {
	const actual = Object.keys(value).toSorted();
	const expected = [...keys].toSorted();
	if (
		actual.length !== expected.length ||
		actual.some((key, index) => key !== expected[index])
	)
		fail(`${path} keys are invalid`);
}

function string(value: unknown, path: string): string {
	if (typeof value !== "string" || value.length === 0)
		fail(`${path} must be a nonempty string`);
	return value;
}

function digest(value: unknown, path: string): string {
	const result = string(value, path);
	if (!digestPattern.test(result)) fail(`${path} must be a SHA-256 digest`);
	return result;
}

function literal<T>(value: unknown, expected: T, path: string): T {
	if (value !== expected) fail(`${path} is invalid`);
	return expected;
}

function exactStringArray(
	value: unknown,
	expected: readonly string[],
	path: string,
): readonly string[] {
	if (
		!Array.isArray(value) ||
		value.length !== expected.length ||
		value.some((item, index) => item !== expected[index])
	)
		fail(`${path} is invalid`);
	return Object.freeze([...expected]);
}

function sortedUniqueStrings(value: unknown, path: string): readonly string[] {
	if (!Array.isArray(value)) fail(`${path} must be an array`);
	const result = value.map((item, index) => string(item, `${path}[${index}]`));
	if (
		new Set(result).size !== result.length ||
		result.some((item, index) => index > 0 && result[index - 1]! > item)
	)
		fail(`${path} must be sorted and unique`);
	return Object.freeze(result);
}

function closedTokens(
	value: unknown,
	path: string,
): readonly LiveQueryTokenKind[] {
	const result = sortedUniqueStrings(value, path);
	for (const token of result)
		if (!(tokenKinds as readonly string[]).includes(token))
			fail(`${path} contains an unknown token`);
	return result as readonly LiveQueryTokenKind[];
}

function positiveInteger(
	value: unknown,
	expected: number,
	path: string,
): number {
	if (value !== expected) fail(`${path} is invalid`);
	return expected;
}

function decodeContextSlot(
	value: JsonRecord,
	path: string,
): LinkedContextObservationSlotV1 {
	exact(value, ["kind", "identity", "projectionDigest", "tokens"], path);
	literal(value.kind, "context", `${path}.kind`);
	const tokens = closedTokens(value.tokens, `${path}.tokens`);
	for (const required of ["contextBootstrapPoint", "tenantPartition"])
		if (!tokens.includes(required as LiveQueryTokenKind))
			fail(`${path} is missing ${required}`);
	return Object.freeze({
		kind: "context",
		identity: string(value.identity, `${path}.identity`),
		projectionDigest: digest(
			value.projectionDigest,
			`${path}.projectionDigest`,
		),
		tokens,
	});
}

function decodeStructuralSlot(
	value: JsonRecord,
	path: string,
): LinkedStructuralQueryObservationSlotV1 {
	exact(
		value,
		[
			"kind",
			"templateDigest",
			"policy",
			"policyProgramDigest",
			"collections",
			"relations",
			"tokens",
		],
		path,
	);
	literal(value.kind, "structuralQuery", `${path}.kind`);
	return Object.freeze({
		kind: "structuralQuery",
		templateDigest: digest(value.templateDigest, `${path}.templateDigest`),
		policy: string(value.policy, `${path}.policy`),
		policyProgramDigest: digest(
			value.policyProgramDigest,
			`${path}.policyProgramDigest`,
		),
		collections: sortedUniqueStrings(value.collections, `${path}.collections`),
		relations: sortedUniqueStrings(value.relations, `${path}.relations`),
		tokens: closedTokens(value.tokens, `${path}.tokens`),
	});
}

function decodeWatchability(
	value: unknown,
): ReadonlyMap<string, LinkedQueryWatchabilityV1> {
	const projection = record(value, "Live Query watchability");
	exact(
		projection,
		["format", "version", "queries"],
		"Live Query watchability",
	);
	literal(
		projection.format,
		"questpie.query-watchability-projection",
		"Live Query watchability format",
	);
	literal(projection.version, 1, "Live Query watchability version");
	if (!Array.isArray(projection.queries))
		fail("Live Query watchability queries must be an array");
	const queries = new Map<string, LinkedQueryWatchabilityV1>();
	let prior = "";
	for (const [index, raw] of projection.queries.entries()) {
		const path = `Live Query watchability query ${index}`;
		const query = record(raw, path);
		exact(
			query,
			[
				"artifact",
				"version",
				"query",
				"call",
				"inputCodec",
				"outputCodec",
				"watchable",
				"observation",
				"delivery",
				"result",
				"contractDigest",
				"possibleObservationSlots",
				"possibleObservationSlotsDigest",
				"unsupportedReason",
			],
			path,
		);
		literal(query.artifact, "questpie.query-watchability", `${path}.artifact`);
		literal(query.version, 1, `${path}.version`);
		literal(query.call, "sameGeneratedMethod", `${path}.call`);
		literal(query.result, "completeValidatedQueryOutput", `${path}.result`);
		exactStringArray(
			query.delivery,
			["initial", "reset", "update"],
			`${path}.delivery`,
		);
		const observation = record(query.observation, `${path}.observation`);
		exact(
			observation,
			["declared", "actual", "commit", "failed"],
			`${path}.observation`,
		);
		literal(
			observation.declared,
			"compilerDerivedReadSites",
			`${path}.observation.declared`,
		);
		literal(
			observation.actual,
			"runtimeObservedSupportedReads",
			`${path}.observation.actual`,
		);
		literal(
			observation.commit,
			"replaceAfterSuccessfulRecompute",
			`${path}.observation.commit`,
		);
		literal(
			observation.failed,
			"preserveLastSuccessfulPlan",
			`${path}.observation.failed`,
		);
		if (typeof query.watchable !== "boolean")
			fail(`${path}.watchable is invalid`);
		if (
			query.unsupportedReason !== null &&
			query.unsupportedReason !== "unsupportedRawRead"
		)
			fail(`${path}.unsupportedReason is invalid`);
		if (!Array.isArray(query.possibleObservationSlots))
			fail(`${path}.possibleObservationSlots must be an array`);
		let context: LinkedContextObservationSlotV1 | null = null;
		const structuralQueries = new Map<
			string,
			LinkedStructuralQueryObservationSlotV1
		>();
		for (const [
			slotIndex,
			rawSlot,
		] of query.possibleObservationSlots.entries()) {
			const slotPath = `${path}.possibleObservationSlots[${slotIndex}]`;
			const slot = record(rawSlot, slotPath);
			if (slot.kind === "context") {
				if (context) fail(`${path} has duplicate Context observation slots`);
				context = decodeContextSlot(slot, slotPath);
			} else if (slot.kind === "structuralQuery") {
				const linked = decodeStructuralSlot(slot, slotPath);
				if (structuralQueries.has(linked.templateDigest))
					fail(`${path} has duplicate structural Query observation slots`);
				structuralQueries.set(linked.templateDigest, linked);
			} else fail(`${slotPath}.kind is invalid`);
		}
		if (query.watchable) {
			if (
				query.unsupportedReason !== null ||
				context === null ||
				structuralQueries.size === 0
			)
				fail(`${path} is not an executable watchability contract`);
		} else if (
			query.unsupportedReason !== "unsupportedRawRead" ||
			context !== null ||
			structuralQueries.size !== 0
		)
			fail(`${path} unsupported watchability contract is invalid`);
		const identity = string(query.query, `${path}.query`);
		if (identity <= prior || queries.has(identity))
			fail("Live Query watchability queries must be sorted and unique");
		prior = identity;
		queries.set(
			identity,
			Object.freeze({
				identity,
				watchable: query.watchable,
				inputCodec: query.inputCodec,
				outputCodec: query.outputCodec,
				contractDigest: digest(query.contractDigest, `${path}.contractDigest`),
				context,
				structuralQueries,
				maximumTokensPerPlan: 256,
				unsupportedReason: query.unsupportedReason,
			}),
		);
		digest(
			query.possibleObservationSlotsDigest,
			`${path}.possibleObservationSlotsDigest`,
		);
	}
	return queries;
}

function decodeDependencyAlgebra(value: unknown): void {
	const artifact = record(value, "Live Query dependency algebra");
	exact(
		artifact,
		[
			"artifact",
			"version",
			"tokens",
			"reads",
			"matching",
			"maximumTokensPerPlan",
		],
		"Live Query dependency algebra",
	);
	literal(
		artifact.artifact,
		"questpie.live-query-dependency-algebra",
		"Live Query dependency algebra artifact",
	);
	literal(artifact.version, 1, "Live Query dependency algebra version");
	exactStringArray(
		artifact.tokens,
		tokenKinds,
		"Live Query dependency algebra tokens",
	);
	const reads = record(artifact.reads, "Live Query dependency algebra reads");
	exact(
		reads,
		["emptyRange", "miss", "page", "branch", "nested"],
		"Live Query dependency algebra reads",
	);
	literal(reads.emptyRange, "recorded", "Live Query empty range");
	literal(reads.miss, "recorded", "Live Query miss");
	literal(reads.page, "completeOrderAndFirstPlusOne", "Live Query page");
	literal(reads.branch, "executedOnly", "Live Query branch");
	literal(reads.nested, "joinRootObservationScope", "Live Query nested reads");
	literal(
		artifact.matching,
		"conservativeOverlapWithoutFalseNegative",
		"Live Query dependency matching",
	);
	positiveInteger(
		artifact.maximumTokensPerPlan,
		256,
		"Live Query dependency maximum",
	);
}

function decodeLedger(value: unknown): void {
	const artifact = record(value, "Change Ledger");
	exact(
		artifact,
		["artifact", "version", "storage", "writeBoundary", "fact", "wake"],
		"Change Ledger",
	);
	literal(
		artifact.artifact,
		"questpie.change-ledger",
		"Change Ledger artifact",
	);
	literal(artifact.version, 1, "Change Ledger version");
	literal(artifact.storage, "postgresql", "Change Ledger storage");
	literal(
		artifact.writeBoundary,
		"sameBusinessTransaction",
		"Change Ledger write boundary",
	);
	const fact = record(artifact.fact, "Change Ledger fact");
	exact(
		fact,
		["identity", "transaction", "collection", "kind", "keys"],
		"Change Ledger fact",
	);
	literal(fact.identity, "uuid", "Change Ledger fact identity");
	literal(fact.transaction, "xid8", "Change Ledger transaction");
	literal(fact.collection, "resourceIdentity", "Change Ledger collection");
	exactStringArray(
		fact.kind,
		["delete", "insert", "truncate", "update"],
		"Change Ledger kinds",
	);
	literal(
		fact.keys,
		"boundedCanonicalKeySetOrConservativeCollection",
		"Change Ledger keys",
	);
	const wake = record(artifact.wake, "Change Ledger wake");
	exact(wake, ["mechanism", "authority", "tolerates"], "Change Ledger wake");
	literal(wake.mechanism, "listenNotify", "Change Ledger wake mechanism");
	literal(wake.authority, "hintOnly", "Change Ledger wake authority");
	exactStringArray(
		wake.tolerates,
		["absent", "coalesced", "delayed", "duplicate", "reordered"],
		"Change Ledger wake tolerance",
	);
}

function decodeReconciliation(value: unknown): void {
	const artifact = record(value, "Change reconciliation");
	exact(
		artifact,
		[
			"artifact",
			"version",
			"frontier",
			"forbiddenFrontiers",
			"startup",
			"retention",
			"wrap",
			"longTransaction",
		],
		"Change reconciliation",
	);
	literal(
		artifact.artifact,
		"questpie.change-reconciliation",
		"Change reconciliation artifact",
	);
	literal(artifact.version, 1, "Change reconciliation version");
	const frontier = record(artifact.frontier, "Change reconciliation frontier");
	exact(
		frontier,
		["kind", "value", "advanceTo", "process", "atomicWith"],
		"Change reconciliation frontier",
	);
	literal(
		frontier.kind,
		"postgresVisibilityHorizon",
		"Change reconciliation frontier kind",
	);
	literal(
		frontier.value,
		"xid8Exclusive",
		"Change reconciliation frontier value",
	);
	literal(
		frontier.advanceTo,
		"pgSnapshotXmin",
		"Change reconciliation advance",
	);
	literal(
		frontier.process,
		"visibleFactsWithPriorLeXidLtNext",
		"Change reconciliation process",
	);
	literal(
		frontier.atomicWith,
		"factEffectsAndConsumerFrontier",
		"Change reconciliation atomicity",
	);
	exactStringArray(
		artifact.forbiddenFrontiers,
		["maxBigserial", "maxTimestamp", "maxTriggerXid"],
		"Change reconciliation forbidden frontiers",
	);
	exactStringArray(
		artifact.startup,
		["listenCommit", "durableReconcile", "consumeWakeHints"],
		"Change reconciliation startup",
	);
	literal(
		artifact.retention,
		"belowMinimumAcknowledgedConsumerHorizonOnly",
		"Change reconciliation retention",
	);
	literal(artifact.wrap, "fullXid8EpochAware", "Change reconciliation wrap");
	literal(
		artifact.longTransaction,
		"boundsLagAndCanFailReadiness",
		"Change reconciliation long transaction",
	);
}

function decodeResume(value: unknown): void {
	const artifact = record(value, "Live Query resume");
	exact(
		artifact,
		[
			"artifact",
			"version",
			"token",
			"acknowledgement",
			"unavailable",
			"persistentOfflineResume",
			"crossQueryAtomicity",
		],
		"Live Query resume",
	);
	literal(
		artifact.artifact,
		"questpie.live-query-resume",
		"Live Query resume artifact",
	);
	literal(artifact.version, 1, "Live Query resume version");
	const token = record(artifact.token, "Live Query resume token");
	exact(
		token,
		["clientVisibility", "authenticated", "bindings"],
		"Live Query resume token",
	);
	literal(token.clientVisibility, "opaque", "Live Query token visibility");
	literal(token.authenticated, true, "Live Query token authentication");
	exactStringArray(
		token.bindings,
		[
			"applicationDeployment",
			"authorityPartition",
			"normalizedInput",
			"queryAndWireVersion",
			"retainedGeneration",
		],
		"Live Query token bindings",
	);
	literal(
		artifact.acknowledgement,
		"lastClientAcceptedCompleteResult",
		"Live Query acknowledgement",
	);
	literal(
		artifact.unavailable,
		"freshAuthorizedReset",
		"Live Query unavailable resume",
	);
	literal(
		artifact.persistentOfflineResume,
		false,
		"Live Query persistent resume",
	);
	literal(
		artifact.crossQueryAtomicity,
		false,
		"Live Query cross-Query atomicity",
	);
}

function decodeCaptureBoundary(value: unknown): void {
	const artifact = record(value, "Change capture boundary");
	exact(
		artifact,
		[
			"artifact",
			"version",
			"mechanism",
			"supportedWrites",
			"unsupported",
			"drift",
			"indexAuthoring",
			"rls",
		],
		"Change capture boundary",
	);
	literal(
		artifact.artifact,
		"questpie.change-capture-boundary",
		"Change capture artifact",
	);
	literal(artifact.version, 1, "Change capture version");
	literal(
		artifact.mechanism,
		"compilerOwnedPostgresqlTriggers",
		"Change capture mechanism",
	);
	exactStringArray(
		artifact.supportedWrites,
		[
			"cascade",
			"copyFrom",
			"externalManagedRole",
			"frameworkMutation",
			"merge",
			"onConflict",
			"rawSqlWrite",
			"truncate",
		],
		"Change capture supported writes",
	);
	exactStringArray(
		artifact.unsupported,
		[
			"disabledOrDroppedTrigger",
			"partitionedReactiveCollection",
			"rawSqlReadWithoutClosedDependency",
			"replicationRoleBypass",
			"superuserBypass",
		],
		"Change capture unsupported writes",
	);
	literal(artifact.drift, "schemaFingerprintFailure", "Change capture drift");
	literal(
		artifact.indexAuthoring,
		"foundationalBtreeOnly",
		"Change capture indexes",
	);
	literal(artifact.rls, "notEmitted", "Change capture RLS");
}

function decodeLimits(value: unknown): LinkedLiveQueryProgramV1["limits"] {
	const artifact = record(value, "Live Query limits");
	exact(
		artifact,
		["artifact", "version", "limits", "slowConsumer", "hotChanges"],
		"Live Query limits",
	);
	literal(
		artifact.artifact,
		"questpie.live-query-limits",
		"Live Query limits artifact",
	);
	literal(artifact.version, 1, "Live Query limits version");
	literal(
		artifact.slowConsumer,
		"replacePendingThenResetOrDisconnect",
		"Live Query slow consumer",
	);
	literal(
		artifact.hotChanges,
		"coalesceDirtyWithoutAdvancingUnprocessedFrontier",
		"Live Query hot changes",
	);
	const limits = record(artifact.limits, "Live Query limits values");
	exact(
		limits,
		[
			"activePerPrincipal",
			"bufferedBytesPerClient",
			"dependencyTokensPerPlan",
			"fanoutPerBatch",
			"ledgerLagMilliseconds",
			"resultBytes",
			"retainedTokensPerPrincipal",
			"retentionMilliseconds",
		],
		"Live Query limits values",
	);
	return Object.freeze({
		activePerPrincipal: positiveInteger(
			limits.activePerPrincipal,
			64,
			"Live Query active watch limit",
		),
		bufferedBytesPerClient: positiveInteger(
			limits.bufferedBytesPerClient,
			2_097_152,
			"Live Query buffer limit",
		),
		dependencyTokensPerPlan: positiveInteger(
			limits.dependencyTokensPerPlan,
			256,
			"Live Query dependency limit",
		),
		fanoutPerBatch: positiveInteger(
			limits.fanoutPerBatch,
			1024,
			"Live Query fanout limit",
		),
		ledgerLagMilliseconds: positiveInteger(
			limits.ledgerLagMilliseconds,
			30_000,
			"Live Query lag limit",
		),
		resultBytes: positiveInteger(
			limits.resultBytes,
			1_048_576,
			"Live Query result limit",
		),
		retainedTokensPerPrincipal: positiveInteger(
			limits.retainedTokensPerPrincipal,
			128,
			"Live Query retained token limit",
		),
		retentionMilliseconds: positiveInteger(
			limits.retentionMilliseconds,
			86_400_000,
			"Live Query retention limit",
		),
	});
}

export function linkLiveQueryProgram(input: unknown): LinkedLiveQueryProgramV1 {
	const artifacts = record(input, "Live Query artifacts");
	exact(
		artifacts,
		[
			"watchability",
			"dependencyAlgebra",
			"changeLedger",
			"reconciliation",
			"resume",
			"captureBoundary",
			"limits",
		],
		"Live Query artifacts",
	);
	decodeDependencyAlgebra(artifacts.dependencyAlgebra);
	decodeLedger(artifacts.changeLedger);
	decodeReconciliation(artifacts.reconciliation);
	decodeResume(artifacts.resume);
	decodeCaptureBoundary(artifacts.captureBoundary);
	const limits = decodeLimits(artifacts.limits);
	const queries = decodeWatchability(artifacts.watchability);
	return Object.freeze({
		format: "questpie.live-query-program",
		version: 1,
		queries,
		limits,
	});
}
