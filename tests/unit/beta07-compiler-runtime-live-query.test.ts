import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { compileApplication } from "@questpie/compiler";

import { linkLiveQueryProgram } from "../../packages/runtime/src/live-query";

const fixtureRoot = resolve(import.meta.dir, "../../fixtures/collaboration");
const temporaryRoots: string[] = [];
let compiledArtifacts:
	| Promise<Record<keyof typeof artifactFiles, unknown>>
	| undefined;

const artifactFiles = {
	watchability: "query-watchability.json",
	dependencyAlgebra: "live-query-dependency-algebra.json",
	changeLedger: "change-ledger.json",
	reconciliation: "change-reconciliation.json",
	resume: "live-query-resume.json",
	captureBoundary: "change-capture-boundary.json",
	limits: "live-query-limits.json",
} as const;

afterAll(async () => {
	await Promise.all(
		temporaryRoots.map((root) => rm(root, { force: true, recursive: true })),
	);
});

async function compileLiveQueryArtifacts(): Promise<
	Record<keyof typeof artifactFiles, unknown>
> {
	compiledArtifacts ??= (async () => {
		const outputDirectory = await mkdtemp(
			join(tmpdir(), "questpie-live-query-link-"),
		);
		temporaryRoots.push(outputDirectory);
		const compilation = await compileApplication({
			applicationRoot: fixtureRoot,
			outputDirectory,
		});
		return Object.fromEntries(
			Object.entries(artifactFiles).map(([key, path]) => {
				const bytes = compilation.generatedFiles[path];
				expect(bytes, `${path} must be emitted`).toBeString();
				return [key, JSON.parse(bytes!)];
			}),
		) as Record<keyof typeof artifactFiles, unknown>;
	})();
	return compiledArtifacts;
}

describe("BETA-07 compiler to Runtime Live Query contract", () => {
	test("links all seven collaboration artifacts into the exact Message program", async () => {
		const artifacts = await compileLiveQueryArtifacts();
		const linked = linkLiveQueryProgram(artifacts);
		const message = linked.queries.get("query:messages.page");

		expect(linked.queries.size).toBe(1);
		expect(message).toMatchObject({
			identity: "query:messages.page",
			watchable: true,
			inputCodec: "operation:messages.page:input",
			outputCodec: "operation:messages.page:output",
			unsupportedReason: null,
			maximumTokensPerPlan: 256,
			context: {
				kind: "context",
				identity: "context:app.context",
				tokens: ["contextBootstrapPoint", "tenantPartition"],
			},
		});
		expect(message?.structuralQueries).toEqual(
			new Map([
				[
					"f8a8863315d764beca14f8bf1fcb9fde233cc12e2325935213a027b91bbc596b",
					expect.objectContaining({
						policy: "policy:messages.default",
						collections: [
							"collection:channels",
							"collection:companies",
							"collection:memberships",
							"collection:messages",
							"collection:spaces",
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

	test("links a compiler-shaped unsupported Query as one-shot only", async () => {
		const artifacts = await compileLiveQueryArtifacts();
		const watchability = structuredClone(artifacts.watchability) as {
			queries: Record<string, unknown>[];
		};
		const message = watchability.queries[0]!;
		watchability.queries.unshift({
			...message,
			query: "query:archives.raw",
			watchable: false,
			possibleObservationSlots: [],
			possibleObservationSlotsDigest: "0".repeat(64),
			unsupportedReason: "unsupportedRawRead",
		});

		const linked = linkLiveQueryProgram({ ...artifacts, watchability });
		expect(linked.queries.get("query:archives.raw")).toMatchObject({
			identity: "query:archives.raw",
			watchable: false,
			unsupportedReason: "unsupportedRawRead",
			context: null,
		});
		expect(
			linked.queries.get("query:archives.raw")?.structuralQueries.size,
		).toBe(0);
	});

	test("rejects a hostile non-watchability artifact before Runtime creation", async () => {
		const artifacts = await compileLiveQueryArtifacts();
		const changeLedger = structuredClone(artifacts.changeLedger) as {
			wake: Record<string, unknown>;
		};
		changeLedger.wake.authority = "durableTruth";

		expect(() => linkLiveQueryProgram({ ...artifacts, changeLedger })).toThrow(
			"Change Ledger wake authority is invalid",
		);
	});
});
