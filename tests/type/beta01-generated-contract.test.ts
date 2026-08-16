import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { compileApplication } from "@questpie/compiler";

const repositoryRoot = resolve(import.meta.dir, "../..");
const fixtureRoot = resolve(repositoryRoot, "fixtures/collaboration");
const goldenPath = resolve(
	repositoryRoot,
	"tests/goldens/beta01/generated-digests.json",
);
const collaborationAuditContractPath =
	"internal/package-contracts/questpie-collaboration-audit-846963f083917e90c9a1fa4c25d7ac12de3ef0dc1fb82b1c2badd14616c61c0c.ts";
const temporaryRoots: string[] = [];

async function temporaryRoot(label: string): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), `questpie-${label}-`));
	temporaryRoots.push(root);
	return root;
}

afterAll(async () => {
	await Promise.all(
		temporaryRoots.map((root) => rm(root, { force: true, recursive: true })),
	);
});

describe("BETA-01 generated contract", () => {
	test("compiles the relocated collaboration fixture byte-identically", async () => {
		const firstOutput = await temporaryRoot("beta01-first");
		const first = await compileApplication({
			applicationRoot: fixtureRoot,
			outputDirectory: firstOutput,
		});

		const relocatedRoot = await temporaryRoot("beta01-relocated-source");
		await cp(fixtureRoot, relocatedRoot, { recursive: true });
		const relocatedOutput = await temporaryRoot("beta01-relocated-output");
		const relocated = await compileApplication({
			applicationRoot: relocatedRoot,
			outputDirectory: relocatedOutput,
		});

		expect(relocated.generatedFiles).toEqual(first.generatedFiles);
		const workspaceGraph = await Promise.all(
			[
				"packages/questpie",
				"packages/compiler",
				"packages/runtime",
				"packages/testkit",
				"apps/studio",
				"fixtures/collaboration",
				"fixtures/archive",
			].map(async (workspace) => {
				const workspaceManifest = JSON.parse(
					await readFile(
						resolve(repositoryRoot, workspace, "package.json"),
						"utf8",
					),
				);
				return [workspace, workspaceManifest.name];
			}),
		);
		expect(Object.fromEntries(workspaceGraph)).toEqual({
			"apps/studio": "@questpie/studio",
			"fixtures/archive": "@questpie/fixture-archive",
			"fixtures/collaboration": "@questpie/fixture-collaboration",
			"packages/compiler": "@questpie/compiler",
			"packages/questpie": "questpie",
			"packages/runtime": "@questpie/runtime",
			"packages/testkit": "@questpie/testkit",
		});
		expect(Object.keys(first.generatedFiles).sort()).toEqual([
			"app.ts",
			"build-input.json",
			"change-capture-boundary.json",
			"change-ledger.json",
			"change-reconciliation.json",
			"client.ts",
			"collection-operation-explain.json",
			"collection-operation-programs.json",
			"collection-operation-set-projections.json",
			"committed-migrations.json",
			"context-projection.json",
			"execution-composition-explain.json",
			"field-normalizer-programs.json",
			"internal/application-2n9drf0d.js",
			"internal/application-346fcckz.js",
			"internal/application-gn0tssb7.js",
			"internal/application-s44znz36.js",
			"internal/application.d.ts",
			"internal/application.js",
			"internal/checksums.json",
			collaborationAuditContractPath,
			"internal/package-inventories.json",
			"live-query-dependency-algebra.json",
			"live-query-limits.json",
			"live-query-resume.json",
			"manifest.json",
			"mutation-projection.json",
			"mutation-transaction-plans.json",
			"origin-map.json",
			"policy-projection.json",
			"postgres-collection-operation-plans.json",
			"postgres-query-plans.json",
			"query-projection.json",
			"query-watchability.json",
			"reaction-projection.json",
			"realtime-wire-contract.json",
			"relational-explain.json",
			"relational-nondisclosure.json",
			"runtime-build.json",
			"runtime-executables.json",
			"schema-projection.json",
			"server-value-programs.json",
			"service-projection.json",
			"wire-contract.json",
		]);

		const manifest = JSON.parse(
			first.generatedFiles["manifest.json"] ?? "null",
		);
		const buildInput = JSON.parse(
			first.generatedFiles["build-input.json"] ?? "null",
		);
		const originMap = JSON.parse(
			first.generatedFiles["origin-map.json"] ?? "null",
		);
		const packageInventories = JSON.parse(
			first.generatedFiles["internal/package-inventories.json"] ?? "null",
		);
		expect(buildInput).toMatchObject({
			format: "questpie.build-input",
			version: 1,
			inputs: { compilerVersion: "4.0.0-beta.1", bunVersion: "1.3.14" },
		});
		expect(originMap).toMatchObject({
			format: "questpie.origin-map",
			version: 1,
			buildInputDigest: buildInput.digest,
		});
		const messageOrigin = originMap.resources.find(
			(resource: { identity: string }) =>
				resource.identity === "collection:messages",
		);
		expect(messageOrigin.members).toContainEqual({
			identity: "collection:messages/field:auditId",
			contributionIdentity:
				"collection:messages/augmentation:questpie.auditFieldsV1",
			declaredAt: {
				packageId: originMap.packages[0].id,
				path: "src/questpie.ts",
				span: {
					start: { line: 18, column: 3 },
					end: { line: 18, column: 42 },
				},
			},
		});
		expect(messageOrigin.members).toContainEqual({
			identity: "collection:messages/relation:channel",
			contributionIdentity: null,
			declaredAt: {
				packageId: null,
				path: "src/messages.ts",
				span: {
					start: { line: 25, column: 3 },
					end: { line: 29, column: 5 },
				},
			},
		});
		expect(packageInventories).toMatchObject({
			format: "questpie.package-inventories",
			version: 1,
			packages: [
				{
					name: "@questpie/collaboration-audit",
					digest:
						"1a2ace658948831cc4be0cfc7fd2080d5598f2100d9ceb86a3d4729216cf6079",
				},
			],
		});
		expect(
			manifest.composition.resources.map(
				(resource: { identity: string }) => resource.identity,
			),
		).toEqual([
			"collection:channels",
			"collection:companies",
			"collection:memberships",
			"collection:messageEvents",
			"collection:messages",
			"collection:spaces",
			"context:app.context",
			"mutation:message.publish",
			"mutation:messageEvents.create",
			"mutation:messages.create",
			"policy:channels.default",
			"policy:memberships.default",
			"policy:messageEvents.default",
			"policy:messages.default",
			"policy:spaces.default",
			"query:channels.get",
			"query:messages.page",
			"query:spaces.get",
			"reaction:messagePublished",
			"seed:collaboration.authorization.v1",
			"seed:collaboration.demo.v1",
			"service:audit.connection",
			"service:audit.execution",
			"service:questpie.auditReader",
		]);
		const manifestMessage = manifest.composition.resources.find(
			(resource: { identity: string }) =>
				resource.identity === "collection:messages",
		);
		expect(manifestMessage.contributions).toHaveLength(1);
		expect(first.generatedFiles["app.ts"]).toContain("defineQuery");
		expect(first.generatedFiles[collaborationAuditContractPath]).not.toContain(
			"messages:",
		);
		expect(first.generatedFiles["client.ts"]).not.toContain("defineQuery");
		expect(first.generatedFiles["app.ts"]).not.toContain("Name extends string");
		expect(first.generatedFiles[collaborationAuditContractPath]).not.toContain(
			"Name extends string",
		);
		expect(JSON.stringify(first.generatedFiles)).not.toMatch(
			/Drizzle|Kysely|drizzle-orm|(?<!\.)\bany\b/,
		);
		expect(first.measurements.typescriptInstantiations).toBeLessThanOrEqual(
			125_000,
		);
		expect(first.measurements.publicDeclarationBytes).toBeLessThanOrEqual(
			262_144,
		);
		const golden = JSON.parse(await readFile(goldenPath, "utf8"));
		expect(
			Object.fromEntries(
				Object.entries(first.generatedFiles)
					.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
					.map(([path, contents]) => [
						path,
						createHash("sha256").update(contents).digest("hex"),
					]),
			),
		).toEqual(golden.files);
		expect(first.packageInventories).toEqual(golden.inventories);

		const consumer = await readFile(
			resolve(relocatedRoot, "src/consumer.ts"),
			"utf8",
		);
		expect(consumer).toContain('from "#questpie/app"');
	}, 15_000);
});
