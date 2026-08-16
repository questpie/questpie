import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { compileApplication, createMigrationPlan } from "@questpie/compiler";

import { projectLiveQueryCompilation } from "../../packages/compiler/src/live-query";
import { renderMigrationSql } from "../../packages/compiler/src/schema/migration-renderer";
import type { NormalizedResource } from "../../packages/compiler/src/types";

const fixtureRoot = resolve(import.meta.dir, "../../fixtures/collaboration");

const query = {
	identity: "query:messages.page",
	kind: "query",
	name: "messages.page",
	contract: {
		format: "questpie.query-definition-contract",
		version: 1,
		name: "messages.page",
		input: { kind: "object" },
		output: { kind: "object" },
		exposure: "network",
		executableSlots: ["handler"],
	},
	contributions: [],
	origin: {
		logicalPath: "src/consumer.ts",
		exportName: "messagePage",
		packageId: null,
		span: null,
		memberSpans: {},
	},
	value: {},
} satisfies NormalizedResource;

const context = {
	format: "questpie.context-projection",
	version: 1,
	context: { identity: "context:app.context" },
};

const data = {
	format: "questpie.data-contract-projection",
	version: 1,
	collections: [
		{
			identity: "collection:memberships",
			relations: [],
		},
		{
			identity: "collection:messages",
			relations: [
				{
					identity: "collection:messages/relation:author",
					target: "collection:memberships",
				},
			],
		},
	],
};

const policyProgram = {
	format: "questpie.policy-program",
	version: 1,
	identity: "policy:messages.default",
	target: "collection:messages",
	operations: {
		read: {
			rows: {
				kind: "exists",
				collection: "collection:memberships",
				predicate: {
					kind: "equal",
					left: {
						kind: "executionFact",
						source: "tenant",
						path: ["id"],
					},
					right: { kind: "literal", value: "company" },
				},
			},
		},
	},
	fields: { selectedOutput: [] },
};

const policy = {
	format: "questpie.policy-projection",
	version: 1,
	policies: [{ program: policyProgram }],
};

const structuralQuery = {
	format: "questpie.query-projection",
	version: 1,
	queries: [
		{
			digest: "a".repeat(64),
			policy: "policy:messages.default",
			template: {
				from: "collection:messages",
				select: [
					{
						kind: "toOne",
						relation: "collection:messages/relation:author",
					},
				],
				order: [
					{
						field: "collection:messages/field:id",
						direction: "desc",
						nulls: "last",
					},
				],
				page: { kind: "forwardCursor" },
			},
		},
	],
};

function project(resource: NormalizedResource = query) {
	return projectLiveQueryCompilation({
		resources: [resource],
		contextProjection: context,
		dataProjection: data,
		policyProjection: policy,
		queryProjection: structuralQuery,
	});
}

test("projects a closed network Query into the accepted P4 artifact set", () => {
	const result = project();

	expect(Object.keys(result.artifacts)).toEqual([
		"change-capture-boundary.json",
		"change-ledger.json",
		"change-reconciliation.json",
		"live-query-dependency-algebra.json",
		"live-query-limits.json",
		"live-query-resume.json",
		"query-watchability.json",
	]);
	expect(result.artifacts["query-watchability.json"]).toEqual({
		format: "questpie.query-watchability-projection",
		version: 1,
		queries: [
			expect.objectContaining({
				artifact: "questpie.query-watchability",
				version: 1,
				query: "query:messages.page",
				call: "sameGeneratedMethod",
				inputCodec: "operation:messages.page:input",
				outputCodec: "operation:messages.page:output",
				watchable: true,
				unsupportedReason: null,
				delivery: ["initial", "reset", "update"],
				result: "completeValidatedQueryOutput",
				possibleObservationSlots: [
					expect.objectContaining({
						kind: "context",
						identity: "context:app.context",
						tokens: ["contextBootstrapPoint", "tenantPartition"],
					}),
					expect.objectContaining({
						kind: "structuralQuery",
						templateDigest: "a".repeat(64),
						policy: "policy:messages.default",
						collections: ["collection:memberships", "collection:messages"],
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
					}),
				],
			}),
		],
	});
	expect(result.semanticDigests).toMatchObject({
		dependencyAlgebra:
			"ccb39ddbff40d44e72c114e3a6af00052bcf91ee5d2b69251932c0b57141b146",
		changeLedger:
			"140fd7ffb43699f9b8b2e986446058acfa679d2d18a33214d559c4bcd0c849e7",
		reconciliation:
			"0c8e66dc1f1ef404f815ebfde97268b326799ce5ba25459b3b8f0ecfcfe236e3",
		resume: "1c7a0eb0a83ea78a447889351da9342cd90830e6deb3bc2c28abe397ec322095",
		captureBoundary:
			"4e0f30ca4727e72bfee8f1452b93a3b8d9e48fdbd787667b35a1294bab7d4cfc",
		limits: "61528429a1fca9131f2458e60ab312c99f95b65a29c4e1ebb278e28612c0793b",
	});
	for (const digest of Object.values(result.fileDigests))
		expect(digest).toMatch(/^[0-9a-f]{64}$/);
	expect(
		createHash("sha256")
			.update(result.bytes["query-watchability.json"]!)
			.digest("hex"),
	).toBe(result.fileDigests["query-watchability.json"]);
});

test("keeps a Query with declared raw reads one-shot only", () => {
	const rawQuery = {
		...query,
		contract: { ...query.contract, readCapabilities: ["rawSql"] },
	};
	const result = project(rawQuery);
	const watchability = result.artifacts["query-watchability.json"] as {
		queries: readonly Record<string, unknown>[];
	};

	expect(watchability.queries).toContainEqual(
		expect.objectContaining({
			query: "query:messages.page",
			watchable: false,
			unsupportedReason: "unsupportedRawRead",
			possibleObservationSlots: [],
		}),
	);
});

test("emits Message watchability and inventories every live-query artifact", async () => {
	const temporary = await mkdtemp(join(tmpdir(), "questpie-live-query-"));
	try {
		await cp(fixtureRoot, temporary, { recursive: true });
		const compilation = await compileApplication({
			applicationRoot: temporary,
			outputDirectory: join(temporary, ".questpie/generated"),
		});
		const watchability = JSON.parse(
			compilation.generatedFiles["query-watchability.json"]!,
		);
		const runtimeBuild = JSON.parse(
			compilation.generatedFiles["runtime-build.json"]!,
		);
		const schema = JSON.parse(
			compilation.generatedFiles["schema-projection.json"]!,
		);
		const message = watchability.queries.find(
			(entry: { query: string }) => entry.query === "query:messages.page",
		);
		const structural = message.possibleObservationSlots.find(
			(entry: { kind: string }) => entry.kind === "structuralQuery",
		);

		expect(message).toMatchObject({
			watchable: true,
			inputCodec: "operation:messages.page:input",
			outputCodec: "operation:messages.page:output",
		});
		expect(structural.collections).toEqual([
			"collection:channels",
			"collection:companies",
			"collection:memberships",
			"collection:messages",
			"collection:spaces",
		]);
		expect(structural.collections).not.toContain("collection:messageEvents");
		expect(structural.relations).toEqual([
			"collection:messages/relation:author",
		]);
		expect(schema.changeCapture).toMatchObject({
			version: 1,
			applicationName: "collaboration",
			collections: [
				expect.objectContaining({ identity: "collection:channels" }),
				expect.objectContaining({ identity: "collection:companies" }),
				expect.objectContaining({ identity: "collection:memberships" }),
				expect.objectContaining({ identity: "collection:messages" }),
				expect.objectContaining({ identity: "collection:spaces" }),
			],
		});
		expect(schema.changeCapture.collections).not.toContainEqual(
			expect.objectContaining({ identity: "collection:messageEvents" }),
		);
		const baseSchema = JSON.parse(
			await readFile(
				resolve(
					fixtureRoot,
					"questpie/migrations/000003_publish-message-transaction/target-schema.json",
				),
				"utf8",
			),
		);
		const migration = createMigrationPlan({
			baseSchema,
			targetSchema: schema,
			baseMigration: "000003_publish-message-transaction",
			slug: "watch-message-query",
		});
		expect(migration.status).toBe("planned");
		if (migration.status !== "planned") throw new Error("expected migration");
		expect(migration.plan.steps).toEqual([
			expect.objectContaining({
				kind: "addChangeCapture",
				targetIdentity: "application:collaboration/changeCapture",
			}),
		]);
		const sql = renderMigrationSql(migration.plan, schema, baseSchema);
		expect(sql).toContain(
			"AFTER INSERT OR UPDATE OR DELETE ON collaboration.messages",
		);
		expect(sql).toContain("'collaboration', 'collection:messages', 'id'");
		expect(sql).not.toContain("collaboration.message_events");
		expect(message).toMatchObject({
			contractDigest:
				"0c372ac93ba55280f20ec7646d408fdd0edf5c4f5717b92201432693da2ad94f",
			possibleObservationSlotsDigest:
				"6e3eb85ad01d30b2f10d12b7ba4f2f3e82800b6e61949f9b7f17eeb65d75c219",
		});
		expect(
			Object.fromEntries(
				[
					"query-watchability.json",
					"change-ledger.json",
					"live-query-dependency-algebra.json",
					"change-reconciliation.json",
					"live-query-resume.json",
					"change-capture-boundary.json",
					"live-query-limits.json",
				].map((path) => [
					path,
					createHash("sha256")
						.update(compilation.generatedFiles[path]!)
						.digest("hex"),
				]),
			),
		).toEqual({
			"query-watchability.json":
				"5e4868f7a744f7692901f49cda961dae42543d11848436e1fba525e83de243f5",
			"change-ledger.json":
				"e6f31477481424bdf9ddf9e9ae1816fe1ef816843193bd0a37dba97eaa840373",
			"live-query-dependency-algebra.json":
				"cd0f12a8f6b6e1e89c6d028cb1a6d7352e320291d8eb849e13dac1b4ebbac297",
			"change-reconciliation.json":
				"72cd859d26d6928f3f8d9c23ea0ed603945be4bd4a0c6fecaad38c522eb2ed26",
			"live-query-resume.json":
				"40345f2dd108f7a66eab46f596f7f169fcd079a98316937abbda86e021f9db38",
			"change-capture-boundary.json":
				"92053364915e56b609c0fa504584f28cac2d1ca70f50bcb8985897946827f410",
			"live-query-limits.json":
				"ea014adf2ea687100f3a5ae56108fa9c4cc6b3c5dd6d4cb37db75e1eb7d39bed",
		});
		expect(
			runtimeBuild.inventory
				.map((item: { path: string }) => item.path)
				.filter(
					(path: string) =>
						path.includes("live-query") ||
						path.includes("change-") ||
						path === "query-watchability.json" ||
						path === "realtime-wire-contract.json",
				),
		).toEqual([
			"change-capture-boundary.json",
			"change-ledger.json",
			"change-reconciliation.json",
			"live-query-dependency-algebra.json",
			"live-query-limits.json",
			"live-query-resume.json",
			"query-watchability.json",
			"realtime-wire-contract.json",
		]);
		expect(runtimeBuild).toMatchObject({
			internalProtocol: "questpie.internal.v3",
			realtimeWireDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
			later: {
				changeLedgerDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
				resumeDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
			},
		});
		const realtime = JSON.parse(
			compilation.generatedFiles["realtime-wire-contract.json"]!,
		);
		expect(realtime).toMatchObject({
			format: "questpie.realtime-wire",
			version: 1,
			watchableQueries: [
				expect.objectContaining({ identity: "query:messages.page" }),
			],
			digest: runtimeBuild.realtimeWireDigest,
		});
		expect(compilation.generatedFiles["internal/application.js"]).toContain(
			"observer:facts.liveQueryObservation??undefined",
		);
	} finally {
		await rm(temporary, { force: true, recursive: true });
	}
});
