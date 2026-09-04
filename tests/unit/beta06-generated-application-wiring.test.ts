import { expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { compileApplication } from "@questpie/compiler";

const fixtureRoot = resolve(import.meta.dir, "../../fixtures/collaboration");
const repositoryRoot = resolve(import.meta.dir, "../..");

test("relocated generated application owns one PostgreSQL Runtime without Bun SQL", async () => {
	const temporary = await mkdtemp(join(tmpdir(), "questpie-beta06-wiring-"));
	try {
		await cp(fixtureRoot, temporary, {
			recursive: true,
			filter: (source) => !source.endsWith("/node_modules"),
		});
		await mkdir(join(temporary, "node_modules/questpie/internal"), {
			recursive: true,
		});
		await writeFile(
			join(temporary, "node_modules/questpie/package.json"),
			JSON.stringify({
				name: "questpie",
				type: "module",
				exports: {
					".": "./index.ts",
					"./internal/observability": "./internal/observability.ts",
				},
			}),
		);
		await symlink(
			resolve(repositoryRoot, "packages/questpie/src/index.ts"),
			join(temporary, "node_modules/questpie/index.ts"),
			"file",
		);
		await symlink(
			resolve(
				repositoryRoot,
				"packages/questpie/src/internal/observability.ts",
			),
			join(temporary, "node_modules/questpie/internal/observability.ts"),
			"file",
		);

		const compilation = await compileApplication({
			applicationRoot: temporary,
		});
		const bundle = compilation.generatedFiles["internal/application.js"]!;
		const applicationChunks = Object.entries(compilation.generatedFiles)
			.filter(
				([path]) =>
					path.startsWith("internal/application-") && path.endsWith(".js"),
			)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([, bytes]) => bytes)
			.join("\n");
		const linkedApplication = `${bundle}\n${applicationChunks}`;
		const runtimeBuild = JSON.parse(
			compilation.generatedFiles["runtime-build.json"]!,
		) as Readonly<{
			inventory: readonly Readonly<{ path: string }>[];
		}>;

		expect(runtimeBuild.inventory.map(({ path }) => path)).toEqual(
			expect.arrayContaining([
				"collection-operation-adapters.json",
				"collection-operation-programs.json",
				"field-normalizer-programs.json",
				"server-value-programs.json",
				"postgres-collection-operation-plans.json",
				"reaction-projection.json",
			]),
		);
		expect(bundle).toContain("linkCollectionMutationPrograms");
		expect(bundle).toContain("linkCollectionOperationAdapters");
		expect(bundle).toContain("linkPostgresCollectionOperationPlans");
		expect(bundle).toContain("linkReactionProjection");
		expect(linkedApplication).toContain("createCollectionMutationData");
		expect(bundle).toContain("createPostgresLiveQueryCoordinator");
		expect(bundle).toContain("linkLiveQueryProgram");
		expect(bundle).toContain("input.realtime.hmacKey");
		expect(bundle).not.toContain("new SQL");
		expect(linkedApplication).not.toContain('from"bun"');
		expect(linkedApplication.match(/createRuntimePostgres\(\{/g)).toHaveLength(
			1,
		);
		expect(linkedApplication).toContain("max:10");
		expect(linkedApplication).toMatch(/connectTimeoutMs:(?:5e3|5000)/);
		expect(linkedApplication).toMatch(/checkoutTimeoutMs:(?:5e3|5000)/);
		expect(linkedApplication).toContain(
			'Symbol.for("questpie.internal.postgres-facts")',
		);
		expect(linkedApplication).toContain(
			"createLinkedPostgresContextBootstrapFactory",
		);
		expect(linkedApplication).toContain("executePostgresDatabaseQuery");
		expect(linkedApplication).toContain(
			"executionObservationOf(scope)?.execution??null",
		);
		expect(linkedApplication).toContain("observation:queryObservation");
		expect(linkedApplication).toContain(
			"executionObservationOf(actionScope)?.execution??null",
		);
		expect(linkedApplication).not.toContain("queryObservation:ctx");
		expect(
			linkedApplication.match(
				/createPostgresDatabaseDurableAttemptObservation\(\{database\}\)/g,
			),
		).toHaveLength(1);
		expect(linkedApplication).toContain(
			"attemptDatabase:durableAttemptPostgres.database",
		);
		expect(linkedApplication).toContain("durableAttemptPostgres.run({");
		expect(linkedApplication).toContain("work.enter()");
		expect(linkedApplication).toContain(
			"createPostgresDatabaseMutationInvoker",
		);
		expect(linkedApplication).toContain("createPostgresDatabaseDurableKernel");
		expect(linkedApplication).toContain("runtime.workerExecution");
		expect(linkedApplication).toContain("runObservedDurableAttempt");
		expect(linkedApplication).not.toContain("createDurableReactionWorker");
		expect(linkedApplication).toContain(
			"createPostgresDatabaseDurableEffectLedger",
		);
		expect(linkedApplication).toContain(
			"createPostgresDatabaseDurablePrincipalMaintenance",
		);
		expect(linkedApplication.match(/postgresRuntime\.close\(\{/g)).toHaveLength(
			2,
		);
		for (const path of [
			"query-watchability.json",
			"live-query-dependency-algebra.json",
			"change-ledger.json",
			"change-reconciliation.json",
			"live-query-resume.json",
			"change-capture-boundary.json",
			"live-query-limits.json",
		])
			expect(bundle).toContain(`artifactFiles["${path}"]`);
		for (const path of [
			"collection-operation-adapters.json",
			"collection-operation-programs.json",
			"field-normalizer-programs.json",
			"server-value-programs.json",
			"postgres-collection-operation-plans.json",
			"policy-projection.json",
			"reaction-projection.json",
		])
			expect(bundle).toContain(`artifactFiles["${path}"]`);
		expect(linkedApplication).not.toContain("createPostgresMutationData");
		for (const replaced of [
			"createPostgresContextBootstrap",
			"executePostgresQuery",
			"createPostgresMutationInvoker",
			"createPostgresDurableEffectLedger",
			"createPostgresDurableKernel",
			"createPostgresDurableMaintenance",
		])
			expect(bundle).not.toContain(replaced);
		expect(linkedApplication).not.toContain("@questpie/runtime");
		expect(
			linkedApplication.match(/questpie\/internal\/observability/g),
		).toHaveLength(2);
		expect(linkedApplication).not.toContain(
			"Runtime observation handle is already bound",
		);

		const internalApplication = await import(
			pathToFileURL(
				join(temporary, ".questpie/generated/internal/application.js"),
			).href
		);
		for (const path of Object.keys(compilation.generatedFiles).filter(
			(path) =>
				path.startsWith("internal/application-") && path.endsWith(".js"),
		))
			await import(
				pathToFileURL(join(temporary, ".questpie/generated", path)).href
			);
		expect(Object.keys(internalApplication).sort()).toEqual([
			"bindIngressPrincipalForRequest",
			"createApplication",
		]);
		const { createOfficialQuestpieObservability } = await import(
			pathToFileURL(
				join(temporary, "node_modules/questpie/internal/observability.ts"),
			).href
		);
		const received: unknown[] = [];
		const observability = createOfficialQuestpieObservability(
			(metadata: unknown) => {
				received.push(metadata);
				return Object.freeze({
					format: "questpie.runtime-observability",
					version: 1,
					extract: () => null,
					begin: () =>
						Object.freeze({
							context: null,
							run: async <Result>(use: () => Result | Promise<Result>) =>
								await use(),
							event: () => undefined,
							end: () => undefined,
						}),
				});
			},
		);
		await expect(
			internalApplication.createApplication({
				postgres: {
					connectionUrl: "postgres://localhost:1/questpie",
					directConnectionUrl: "postgres://localhost:1/questpie",
				},
				realtime: { hmacKey: new Uint8Array(31) },
				maintenance: { authorize: () => true },
			}),
		).rejects.toThrow("HMAC key must contain at least 32 bytes");
		await expect(
			internalApplication.createApplication({
				postgres: {
					connectionUrl: "postgres://localhost:1/questpie",
					directConnectionUrl: "postgres://localhost:1/questpie",
				},
				realtime: { hmacKey: new Uint8Array(32) },
				maintenance: { authorize: () => true },
				observability,
			}),
		).rejects.toThrow();
		expect(received).toHaveLength(1);
		expect(received[0]).toMatchObject({
			format: "questpie.observation-runtime-metadata",
			version: 1,
			applicationIdentity: "application:collaboration",
			questpieVersion: "4.0.0-beta.2",
		});
	} finally {
		await rm(temporary, { force: true, recursive: true });
	}
}, 30_000);
