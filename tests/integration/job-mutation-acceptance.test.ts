import { expect, test } from "bun:test";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { codec, defineContext, defineService } from "questpie";

import { compileApplication } from "@questpie/compiler";

import { createRuntimeApplication } from "../../packages/runtime/src/application";
import { decodeRuntimeArtifacts } from "../../packages/runtime/src/application/artifacts";
import { linkJobProjection } from "../../packages/runtime/src/durable/job-projection";

const fixtureRoot = resolve(import.meta.dir, "../../fixtures/collaboration");

test("starts a compiler-generated Job-only durable application", async () => {
	const temporary = await mkdtemp(join(tmpdir(), "questpie-job-only-"));
	try {
		await cp(fixtureRoot, temporary, { recursive: true });
		await Promise.all([
			rm(join(temporary, "src/delivery-action.ts")),
			rm(join(temporary, "src/message-published.ts")),
			rm(join(temporary, "src/message-publish.ts")),
		]);
		const compilation = await compileApplication({
			applicationRoot: temporary,
		});
		const runtimeBuild = JSON.parse(
			compilation.generatedFiles["runtime-build.json"]!,
		) as Readonly<{
			application: `application:${string}`;
			digest: string;
			inventory: readonly Readonly<{ path: string }>[];
			later: Readonly<{
				durableCompatibilityDigest: string | null;
				jobDigest: string | null;
				reactionDigest: string | null;
			}>;
		}>;
		const runtimeExecutables = JSON.parse(
			compilation.generatedFiles["runtime-executables.json"]!,
		) as Readonly<{
			slots: readonly Readonly<{
				identity: string;
				kind: string;
				slot: string;
				runtimeGraphDigest: string;
				bundleExport: string;
			}>[];
		}>;
		const durableKernel = JSON.parse(
			compilation.generatedFiles["durable-kernel.json"]!,
		) as Readonly<{ digest: string }>;
		const inventory = runtimeBuild.inventory.map(({ path }) => path);

		expect(inventory).toContain("durable-kernel.json");
		expect(inventory).toContain("job-projection.json");
		expect(inventory).not.toContain("reaction-projection.json");
		expect(runtimeBuild.later.durableCompatibilityDigest).toBe(
			durableKernel.digest,
		);
		expect(runtimeBuild.later.jobDigest).toMatch(/^[0-9a-f]{64}$/);
		expect(runtimeBuild.later.reactionDigest).toBeNull();

		const implementations = new Map<string, unknown>();
		const definitions = new Map<string, Readonly<Record<string, unknown>>>();
		const contextSlot = runtimeExecutables.slots.find(
			(slot) => slot.kind === "context",
		);
		if (!contextSlot) throw new TypeError("Job-only fixture requires Context");
		const context = defineContext({
			name: contextSlot.identity.slice("context:".length),
			input: codec.object({}),
			resolve: () => ({ tenant: { id: "tenant:test" }, values: {} }),
		});
		definitions.set(contextSlot.identity, context);

		const services = runtimeExecutables.slots
			.filter((slot) => slot.kind === "service")
			.map((slot) => slot.identity)
			.filter(
				(identity, index, identities) => identities.indexOf(identity) === index,
			)
			.map((identity) => {
				const disposable = runtimeExecutables.slots.some(
					(slot) => slot.identity === identity && slot.slot === "dispose",
				);
				const definition = defineService({
					name: identity.slice("service:".length),
					lifetime: "application",
					effect: "read",
					create: () => Object.freeze({}),
					...(disposable ? { dispose: () => undefined } : {}),
				});
				definitions.set(identity, definition);
				return definition;
			});
		for (const slot of runtimeExecutables.slots) {
			if (definitions.has(slot.identity)) continue;
			const name = slot.identity.slice(slot.kind.length + 1);
			const implementation = () => undefined;
			definitions.set(
				slot.identity,
				Object.freeze(
					slot.kind === "credentialResolver"
						? { name, resolve: implementation }
						: { name, handler: implementation },
				),
			);
		}
		const slots = runtimeExecutables.slots.map((slot) => {
			const definition = definitions.get(slot.identity)!;
			const implementation =
				slot.kind === "context" || slot.kind === "credentialResolver"
					? definition.resolve
					: slot.kind === "service"
						? definition[slot.slot]
						: definition.handler;
			implementations.set(slot.bundleExport, implementation);
			return Object.freeze({
				...slot,
				definition,
				...([
					"action",
					"job",
					"mutation",
					"query",
					"reaction",
					"route",
				].includes(slot.kind)
					? { execute: implementation }
					: {}),
			});
		});
		const artifactFiles = Object.freeze(
			Object.fromEntries(
				runtimeBuild.inventory.map(({ path }) => [
					path,
					compilation.generatedFiles[path]!,
				]),
			),
		);
		const artifacts = {
			runtimeBuild,
			runtimeExecutables,
			operationContracts: JSON.parse(
				compilation.generatedFiles["operation-contracts.json"]!,
			),
			wireContract: JSON.parse(
				compilation.generatedFiles["wire-contract.json"]!,
			),
		};
		expect(
			decodeRuntimeArtifacts(artifacts).runtimeBuild.later
				.durableCompatibilityDigest,
		).toBe(durableKernel.digest);
		const runtime = await createRuntimeApplication({
			artifacts,
			artifactFiles,
			serverExports: Object.freeze(Object.fromEntries(implementations)),
			bindings: {
				application: runtimeBuild.application,
				runtimeBuildDigest: runtimeBuild.digest,
				slots: slots as never,
			},
			program: {
				context,
				services,
				bootstrap: () => ({ get: async () => null }),
				resolvePrincipal: () => null,
				project: () => Object.freeze({}),
				projectMutation: () => async () => {
					throw new Error("Job-only artifact start does not execute Mutations");
				},
				invokeAction: () => {
					throw new Error("Job-only artifact start does not execute Actions");
				},
			},
		});
		await runtime.close({ deadlineAt: Date.now() + 2_000 });
	} finally {
		await rm(temporary, { force: true, recursive: true });
	}
}, 30_000);

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
		'"reports.companyDigest": Readonly<{ accept',
	);
	expect(compilation.generatedFiles["app.ts"]).not.toContain(
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
