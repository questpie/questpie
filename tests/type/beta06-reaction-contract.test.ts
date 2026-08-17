import { expect, test } from "bun:test";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { compileApplication } from "@questpie/compiler";

const fixtureRoot = resolve(import.meta.dir, "../../fixtures/collaboration");

test("types Mutation dispatch from the authored Reaction input", async () => {
	const temporary = await mkdtemp(join(tmpdir(), "questpie-beta06-reaction-"));
	try {
		await cp(fixtureRoot, temporary, { recursive: true });
		await writeFile(
			join(temporary, "src/reaction-contract-consumer.ts"),
			`import type { MutationContext, ReactionDefinition } from "#questpie/app";

declare const ctx: MutationContext;
declare const reaction: ReactionDefinition<"messagePublished", Record<never, never>>;

async function exerciseDispatch() {
	reaction.identity satisfies "reaction:messagePublished";
	await ctx.dispatch.messagePublished({
		channelId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a2",
		companyId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0",
		messageId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a3",
	});

	// @ts-expect-error the Reaction codec requires the tenant identity
	await ctx.dispatch.messagePublished({
		channelId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a2",
		messageId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a3",
	});

	// @ts-expect-error no fixture name may fabricate a dispatch member
	await ctx.dispatch.unknownReaction({ messageId: "x" });
}

void exerciseDispatch;
`,
		);

		const compilation = await compileApplication({
			applicationRoot: temporary,
		});
		expect(compilation.generatedFiles["app.ts"]).not.toContain(
			"unknownReaction",
		);
	} finally {
		await rm(temporary, { force: true, recursive: true });
	}
}, 30_000);
