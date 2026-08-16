import { expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { compileApplication } from "@questpie/compiler";

const fixtureRoot = resolve(import.meta.dir, "../../fixtures/collaboration");
const repositoryRoot = resolve(import.meta.dir, "../..");

test("relocated generated application links Mutation and private Live Query programs", async () => {
	const temporary = await mkdtemp(join(tmpdir(), "questpie-beta06-wiring-"));
	try {
		await cp(fixtureRoot, temporary, {
			recursive: true,
			filter: (source) => !source.endsWith("/node_modules"),
		});
		await mkdir(join(temporary, "node_modules/questpie"), { recursive: true });
		await writeFile(
			join(temporary, "node_modules/questpie/package.json"),
			JSON.stringify({
				name: "questpie",
				type: "module",
				exports: "./index.ts",
			}),
		);
		await symlink(
			resolve(repositoryRoot, "packages/questpie/src/index.ts"),
			join(temporary, "node_modules/questpie/index.ts"),
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
				"collection-operation-programs.json",
				"field-normalizer-programs.json",
				"server-value-programs.json",
				"postgres-collection-operation-plans.json",
				"reaction-projection.json",
			]),
		);
		expect(bundle).toContain("linkCollectionMutationPrograms");
		expect(bundle).toContain("linkPostgresCollectionOperationPlans");
		expect(bundle).toContain("linkReactionProjection");
		expect(linkedApplication).toContain("createPostgresCollectionMutationData");
		expect(bundle).toContain("createPostgresLiveQueryCoordinator");
		expect(bundle).toContain("linkLiveQueryProgram");
		expect(bundle).toContain("input.realtime.hmacKey");
		expect(bundle.indexOf("hmacKey.byteLength")).toBeLessThan(
			bundle.indexOf("new SQL"),
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
			"collection-operation-programs.json",
			"field-normalizer-programs.json",
			"server-value-programs.json",
			"postgres-collection-operation-plans.json",
			"policy-projection.json",
			"reaction-projection.json",
		])
			expect(bundle).toContain(`artifactFiles["${path}"]`);
		expect(linkedApplication).not.toContain("createPostgresMutationData");
		expect(linkedApplication).not.toContain("@questpie/runtime");

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
		await expect(
			internalApplication.createApplication({
				postgres: { url: "postgres://localhost:1/questpie" },
				realtime: { hmacKey: new Uint8Array(31) },
			}),
		).rejects.toThrow("HMAC key must contain at least 32 bytes");
	} finally {
		await rm(temporary, { force: true, recursive: true });
	}
}, 30_000);
