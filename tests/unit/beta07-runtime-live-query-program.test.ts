import { describe, expect, test } from "bun:test";

import { linkLiveQueryProgram } from "../../packages/runtime/src/live-query";

const sha = (digit: string) => digit.repeat(64);

const artifacts = {
	watchability: {
		format: "questpie.query-watchability-projection",
		version: 1,
		queries: [
			{
				artifact: "questpie.query-watchability",
				version: 1,
				query: "query:archives.raw",
				call: "sameGeneratedMethod",
				inputCodec: { kind: "object", fields: {} },
				outputCodec: { kind: "object", fields: {} },
				watchable: false,
				observation: {
					declared: "compilerDerivedReadSites",
					actual: "runtimeObservedSupportedReads",
					commit: "replaceAfterSuccessfulRecompute",
					failed: "preserveLastSuccessfulPlan",
				},
				delivery: ["initial", "reset", "update"],
				result: "completeValidatedQueryOutput",
				contractDigest: sha("0"),
				possibleObservationSlots: [],
				possibleObservationSlotsDigest: sha("0"),
				unsupportedReason: "unsupportedRawRead",
			},
			{
				artifact: "questpie.query-watchability",
				version: 1,
				query: "query:messages.page",
				call: "sameGeneratedMethod",
				inputCodec: { kind: "object", fields: {} },
				outputCodec: { kind: "object", fields: {} },
				watchable: true,
				observation: {
					declared: "compilerDerivedReadSites",
					actual: "runtimeObservedSupportedReads",
					commit: "replaceAfterSuccessfulRecompute",
					failed: "preserveLastSuccessfulPlan",
				},
				delivery: ["initial", "reset", "update"],
				result: "completeValidatedQueryOutput",
				contractDigest: sha("1"),
				possibleObservationSlots: [
					{
						kind: "context",
						identity: "context:request",
						projectionDigest: sha("2"),
						tokens: ["contextBootstrapPoint", "tenantPartition"],
					},
					{
						kind: "structuralQuery",
						templateDigest: sha("3"),
						policy: "policy:messages.default",
						policyProgramDigest: sha("4"),
						collections: [
							"collection:channels",
							"collection:memberships",
							"collection:messages",
						],
						relations: ["collection:messages/relation:author"],
						tokens: [
							"collectionRange",
							"orderingBoundary",
							"pageSentinel",
							"policyEvidencePoint",
							"relationEndpoint",
							"relationMiss",
							"tenantPartition",
						],
					},
				],
				possibleObservationSlotsDigest: sha("5"),
				unsupportedReason: null,
			},
		],
	},
	dependencyAlgebra: {
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
	},
	changeLedger: {
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
	},
	reconciliation: {
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
	},
	resume: {
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
	},
	captureBoundary: {
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
	},
	limits: {
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
	},
} as const;

describe("BETA-07 Runtime Live Query program", () => {
	test("links the exact watchable Query and accepted P4 limits", () => {
		const linked = linkLiveQueryProgram(artifacts);

		expect(linked.queries.get("query:messages.page")?.watchable).toBe(true);
		expect(linked.queries.get("query:archives.raw")?.watchable).toBe(false);
		expect(
			linked.queries.get("query:messages.page")?.structuralQueries,
		).toEqual(
			new Map([
				[
					sha("3"),
					expect.objectContaining({
						policy: "policy:messages.default",
						collections: [
							"collection:channels",
							"collection:memberships",
							"collection:messages",
						],
					}),
				],
			]),
		);
		expect(linked.limits).toEqual({
			activePerPrincipal: 64,
			bufferedBytesPerClient: 2_097_152,
			dependencyTokensPerPlan: 256,
			fanoutPerBatch: 1024,
			ledgerLagMilliseconds: 30_000,
			resultBytes: 1_048_576,
			retainedTokensPerPrincipal: 128,
			retentionMilliseconds: 86_400_000,
		});
	});

	test("rejects an artifact widened beyond the accepted P4 contract", () => {
		expect(() =>
			linkLiveQueryProgram({
				...artifacts,
				limits: { ...artifacts.limits, provider: "redis" },
			}),
		).toThrow("Live Query limits keys are invalid");
	});
});
