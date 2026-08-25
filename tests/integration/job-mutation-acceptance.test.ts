import { expect, test } from "bun:test";
import { resolve } from "node:path";

import { compileApplication } from "@questpie/compiler";

import { linkJobProjection } from "../../packages/runtime/src/durable/job-projection";

const fixtureRoot = resolve(import.meta.dir, "../../fixtures/collaboration");

test("projects one Mutation-owned Job acceptance without a second durable runtime", async () => {
	const compilation = await compileApplication({
		applicationRoot: fixtureRoot,
	});
	const manifest = JSON.parse(compilation.generatedFiles["manifest.json"]!);
	const jobs = JSON.parse(compilation.generatedFiles["job-projection.json"]!);
	const runtimeBuild = JSON.parse(
		compilation.generatedFiles["runtime-build.json"]!,
	);

	expect(manifest.composition.resources).toContainEqual(
		expect.objectContaining({ identity: "job:reports.companyDigest" }),
	);
	expect(jobs).toMatchObject({
		format: "questpie.job-projection",
		version: 1,
		jobs: [
			{
				identity: "job:reports.companyDigest",
				semanticVersion: 1,
				signals: {},
				schedule: null,
			},
		],
	});
	expect(runtimeBuild.internalProtocol).toBe("questpie.internal.v7");
	expect(runtimeBuild.inventory).toContainEqual(
		expect.objectContaining({ path: "job-projection.json" }),
	);
	expect(compilation.generatedFiles["app.ts"]).toContain(
		'"reports.companyDigest": Readonly<{ dispatch',
	);
	expect(compilation.generatedFiles["client.ts"]).not.toContain(
		"reports.companyDigest",
	);

	const withDeclaredError = structuredClone(jobs);
	withDeclaredError.jobs[0].declaredErrors = {
		DIGEST_REJECTED: {
			code: "DIGEST_REJECTED",
			status: 422,
			payload: { kind: "object", properties: { reason: { kind: "text" } } },
		},
	};
	expect(
		linkJobProjection(withDeclaredError).members.get("reports.companyDigest")
			?.declaredErrors.DIGEST_REJECTED?.status,
	).toBe(422);
	const invalidOrigin = structuredClone(jobs);
	invalidOrigin.jobs[0].origin.extra = true;
	expect(() => linkJobProjection(invalidOrigin)).toThrow(
		"job 0 origin has invalid keys",
	);
});
