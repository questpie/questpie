import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { compileApplication } from "@questpie/compiler";

import {
	linkCollectionMutationPrograms,
	mutationProgramDigest,
} from "../../packages/runtime/src/mutation/program";

const fixtureRoot = resolve(import.meta.dir, "../../fixtures/collaboration");

export async function runtimePostgresProgramFixture() {
	const temporary = await mkdtemp(join(tmpdir(), "questpie-runtime-program-"));
	await cp(fixtureRoot, temporary, { recursive: true });
	await rm(join(temporary, "src/message-publish.ts"));
	await rm(join(temporary, "src/message-published.ts"));
	await rm(join(temporary, "src/message-record-delivery.ts"));
	await rm(join(temporary, "src/delivery-action.ts"));
	try {
		const generated = (await compileApplication({ applicationRoot: temporary }))
			.generatedFiles;
		const policyProjection = JSON.parse(
			generated["policy-projection.json"] ?? "null",
		) as {
			policies: readonly {
				program: Readonly<{ identity: string; target: string }>;
			}[];
		};
		const lifecyclePrograms = JSON.parse(
			generated["collection-lifecycle-programs.json"] ?? "null",
		);
		const runtimeBuild = JSON.parse(
			generated["runtime-build.json"] ?? "null",
		) as { compilerRuntimeBuildDigest: string };
		return {
			artifact: JSON.parse(
				generated["postgres-collection-operation-plans.json"] ?? "null",
			) as unknown,
			operations: linkCollectionMutationPrograms({
				collectionOperations: JSON.parse(
					generated["collection-operation-programs.json"] ?? "null",
				),
				fieldNormalizers: {
					format: "questpie.field-normalizer-programs",
					version: 1,
					programs: [],
				},
				serverValues: {
					format: "questpie.server-value-programs",
					version: 1,
					programs: [],
				},
				policies: policyProjection.policies.map(({ program }) => ({
					identity: program.identity,
					target: program.target,
				})),
				lifecyclePrograms,
				expectedLifecycleProgramsDigest: mutationProgramDigest(
					"questpie.collection-lifecycle-programs-v1",
					lifecyclePrograms,
				),
				compilerRuntimeBuildDigest: runtimeBuild.compilerRuntimeBuildDigest,
			}),
		};
	} finally {
		await rm(temporary, { force: true, recursive: true });
	}
}
