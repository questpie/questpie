import { expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { compileApplication } from "@questpie/compiler";

const fixtureRoot = resolve(import.meta.dir, "../../fixtures/collaboration");
const repositoryRoot = resolve(import.meta.dir, "../..");
const publishMutation = `import { codec, operation, policy } from "questpie";
import { defineMutation } from "#questpie/app";

export const publishMessage = defineMutation({
	name: "message.publish",
	network: true,
	input: codec.object({ channelId: codec.uuid(), body: codec.text() }),
	output: codec.object({
		id: codec.uuid(), channelId: codec.uuid(), body: codec.text(),
		createdAt: codec.timestamp(),
	}),
	policy: policy.authenticated(),
	errors: {
		channelUnavailable: operation.error({ code: "CHANNEL_UNAVAILABLE", status: 404 }),
		idempotencyConflict: operation.error({
			code: "IDEMPOTENCY_CONFLICT", status: 409,
			payload: codec.object({ callId: codec.uuid() }),
		}),
	},
	handler: async ({ input, ctx, errors }) => {
		const channel = await ctx.data.channels.get({ key: { id: input.channelId } });
		const space = channel
			? await ctx.data.spaces.get({ key: { id: channel.spaceId } })
			: null;
		if (channel === null || space === null || space.companyId !== ctx.tenant.id)
			throw errors.channelUnavailable();
		const message = await ctx.data.messages.create({ input: {
			channelId: channel.id,
			authorMembershipId: ctx.values.selectedMembershipId,
			body: input.body,
		} });
		if (message.body === undefined) throw errors.channelUnavailable();
		await ctx.data.messageEvents.create({ input: {
			messageId: message.id, kind: "published",
		} });
		await ctx.dispatch.messagePublished({
			companyId: ctx.tenant.id, messageId: message.id,
		});
		return {
			id: message.id, channelId: message.channelId,
			body: message.body, createdAt: message.createdAt,
		};
	},
});
`;

test("relocated generated application links inventoried Mutation programs and plans", async () => {
	const temporary = await mkdtemp(join(tmpdir(), "questpie-beta06-wiring-"));
	try {
		await cp(fixtureRoot, temporary, {
			recursive: true,
			filter: (source) => !source.endsWith("/node_modules"),
		});
		await writeFile(join(temporary, "src/message-publish.ts"), publishMutation);
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
		expect(bundle).toContain("createPostgresCollectionMutationData");
		expect(bundle).toContain('artifactFiles["reaction-projection.json"]');
		expect(bundle).not.toContain("createPostgresMutationData");
		expect(bundle).not.toContain("@questpie/runtime");

		const internalApplication = await import(
			pathToFileURL(
				join(temporary, ".questpie/generated/internal/application.js"),
			).href
		);
		expect(Object.keys(internalApplication).sort()).toEqual([
			"bindIngressPrincipalForRequest",
			"createApplication",
		]);
	} finally {
		await rm(temporary, { force: true, recursive: true });
	}
}, 30_000);
