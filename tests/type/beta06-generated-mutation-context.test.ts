import { expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { compileApplication } from "@questpie/compiler";

const fixtureRoot = resolve(import.meta.dir, "../../fixtures/collaboration");
const repositoryRoot = resolve(import.meta.dir, "../..");

test("emits only plan-backed Mutation Collection capabilities", async () => {
	const temporary = await mkdtemp(join(tmpdir(), "questpie-beta06-context-"));
	try {
		await cp(fixtureRoot, temporary, {
			recursive: true,
			filter: (source) => !source.startsWith(join(fixtureRoot, "node_modules")),
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
		await compileApplication({ applicationRoot: temporary });
		await writeFile(
			join(temporary, "mutation-context-consumer.ts"),
			`import type { MutationContext } from "#questpie/app";

declare const ctx: MutationContext;
const channel = await ctx.data.channels.get({
	key: { id: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a2" },
});
channel satisfies Readonly<{ id: string; spaceId: string }> | null;
const message = await ctx.data.messages.create({
	input: {
		channelId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a2",
		authorMembershipId: ctx.values.selectedMembershipId,
		body: "hello",
	},
});
message satisfies Readonly<{
	id: string;
	channelId: string;
	body?: string;
	createdAt: Date;
}>;
message.id satisfies string;
message.body satisfies string | undefined;
// @ts-expect-error conditional output denial omits body instead of encoding null
const deniedBody: null = message.body;
// @ts-expect-error output contains only the compiler-fixed selection
message.authorMembershipId;
// @ts-expect-error Membership has no compiled Mutation operation
ctx.data.memberships;
// @ts-expect-error Company has no compiled Mutation operation
ctx.data.companies;
// @ts-expect-error messages.get was not authored
ctx.data.messages.get;
// @ts-expect-error messages.update was not authored
ctx.data.messages.update;
// @ts-expect-error messages.delete was not authored
ctx.data.messages.delete;
// @ts-expect-error channels.create was not authored
ctx.data.channels.create;
// @ts-expect-error messageEvents.get was not authored
ctx.data.messageEvents.get;
// @ts-expect-error key Fields are exact and do not accept non-key Fields
ctx.data.channels.get({ key: { id: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a2", spaceId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a2" } });
// @ts-expect-error id is schema-owned, never caller supplied
ctx.data.messages.create({ input: { id: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a2", channelId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a2", authorMembershipId: ctx.values.selectedMembershipId, body: "hello" } });
// @ts-expect-error createdAt is assigned by the compiled server-value program
ctx.data.messages.create({ input: { channelId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a2", authorMembershipId: ctx.values.selectedMembershipId, body: "hello", createdAt: new Date() } });
// @ts-expect-error caller input is exact and requires every authored create Field
ctx.data.messages.create({ input: { channelId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a2", body: "hello" } });
// @ts-expect-error selection is fixed by the compiler plan
ctx.data.messages.create({ input: { channelId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a2", authorMembershipId: ctx.values.selectedMembershipId, body: "hello" }, select: { id: true } });
`,
		);
		await writeFile(
			join(temporary, "tsconfig.mutation-context.json"),
			JSON.stringify({
				compilerOptions: {
					allowImportingTsExtensions: true,
					module: "ESNext",
					moduleResolution: "Bundler",
					noEmit: true,
					paths: {
						"#questpie/app": ["./.questpie/generated/app.ts"],
						"#questpie/source/*": ["./src/*"],
						"@questpie/collaboration-audit/questpie": [
							"./packages/audit/src/questpie.ts",
						],
						questpie: [
							resolve(repositoryRoot, "packages/questpie/src/index.ts"),
						],
					},
					skipLibCheck: true,
					strict: true,
					target: "ES2024",
					typeRoots: [resolve(repositoryRoot, "node_modules/@types")],
					types: ["bun"],
				},
				include: ["mutation-context-consumer.ts", ".questpie/generated/app.ts"],
			}),
		);
		const typecheck = Bun.spawn(
			[
				"bun",
				resolve(repositoryRoot, "node_modules/typescript/bin/tsc"),
				"-p",
				"tsconfig.mutation-context.json",
			],
			{ cwd: temporary, stdout: "pipe", stderr: "pipe" },
		);
		const [exitCode, stdout, stderr] = await Promise.all([
			typecheck.exited,
			new Response(typecheck.stdout).text(),
			new Response(typecheck.stderr).text(),
		]);
		expect(`${stdout}${stderr}`).toBe("");
		expect(exitCode).toBe(0);
	} finally {
		await rm(temporary, { force: true, recursive: true });
	}
}, 30_000);
