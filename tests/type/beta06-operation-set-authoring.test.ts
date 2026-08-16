import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "../..");

describe("BETA-06 Collection Operation Set authoring", () => {
	test("infers exact Fields and keeps normalization and server values closed", async () => {
		const temporary = await mkdtemp(join(tmpdir(), "questpie-beta06-types-"));
		try {
			const fixture = join(temporary, "authoring.ts");
			await writeFile(
				fixture,
				`import {
	constraint,
	defineCollection,
	defineCollectionOperations,
	definePolicy,
	field,
	mutation,
} from "questpie";
import type { ValueProgramOperand } from "questpie";

type Equal<Left, Right> =
	(<Value>() => Value extends Left ? 1 : 2) extends
	(<Value>() => Value extends Right ? 1 : 2) ? true : false;
type Expect<Value extends true> = Value;

const messages = defineCollection({
	name: "messages",
	fields: {
		id: field.uuid({ nullable: false, default: "randomUuid" }),
		companyId: field.uuid({ nullable: false }),
		title: field.text({ nullable: false, maxLength: 200 }),
		body: field.text({ nullable: false, maxLength: 8_192 }),
		createdAt: field.timestamp({ nullable: false, withTimezone: true }),
	},
	constraints: {
		primary: constraint.primaryKey({ fields: ["id"] }),
	},
});
const messagePolicy = definePolicy(messages, { name: "messages.default" });
const channels = defineCollection({
	name: "channels",
	fields: { id: field.uuid({ nullable: false }) },
	constraints: {
		primary: constraint.primaryKey({ fields: ["id"] }),
	},
});
const channelPolicy = definePolicy(channels, { name: "channels.default" });
const page = { kind: "dataQuery" } as const;

export const messageOperations = defineCollectionOperations(messages, {
	name: "messages",
	policy: messagePolicy,
	network: true,
	list: { data: page },
	get: { select: { id: true, title: true, createdAt: true } },
	create: {
		input: ["title", "body"],
		normalize: ({ input }) => {
			type _title = Expect<
				Equal<typeof input.title, ValueProgramOperand<string>>
			>;
			return { title: input.title };
		},
		values: ({ principal, tenant, operationTime }) => ({
			id: mutation.overwrite(principal.id),
			companyId: mutation.overwrite(tenant.id),
			createdAt: mutation.overwrite(operationTime),
		}),
		select: { id: true, title: true, body: true, createdAt: true },
	},
	update: {
		input: ["title", "body"],
		select: { id: true, title: true, body: true },
	},
	delete: { select: { id: true } },
});

type _name = Expect<Equal<typeof messageOperations.body.name, "messages">>;
type _createInput = Expect<
	Equal<typeof messageOperations.body.create.input, readonly ["title", "body"]>
>;
type _getSelection = Expect<
	Equal<
		typeof messageOperations.body.get.select,
		{ readonly id: true; readonly title: true; readonly createdAt: true }
	>
>;
// @ts-expect-error Operation Sets are compiler shorthand, not branded Resources.
void messageOperations.__questpie;

defineCollectionOperations(messages, {
	name: "invalid-input",
	policy: messagePolicy,
	create: {
		// @ts-expect-error input names are closed to the target Collection Fields.
		input: ["missing"],
		select: { id: true },
	},
});

defineCollectionOperations(messages, {
	name: "invalid-selection",
	policy: messagePolicy,
	// @ts-expect-error selections cannot target an undeclared Field.
	get: { select: { missing: true } },
});

defineCollectionOperations(messages, {
	name: "invalid-member",
	policy: messagePolicy,
	// @ts-expect-error the shorthand has exactly five optional members.
	archive: { select: { id: true } },
});

defineCollectionOperations(messages, {
	name: "invalid-policy-target",
	// @ts-expect-error a Collection Operation Set Policy must target its Collection.
	policy: channelPolicy,
	get: { select: { id: true } },
});
`,
			);
			await writeFile(
				join(temporary, "tsconfig.json"),
				JSON.stringify({
					compilerOptions: {
						baseUrl: repositoryRoot,
						ignoreDeprecations: "6.0",
						lib: ["DOM", "ESNext"],
						module: "ESNext",
						moduleResolution: "Bundler",
						noEmit: true,
						paths: { questpie: ["packages/questpie/src/index.ts"] },
						skipLibCheck: true,
						strict: true,
						target: "ESNext",
						types: [],
					},
					files: [fixture],
				}),
			);

			const result = Bun.spawnSync(
				[
					"bun",
					"node_modules/typescript/bin/tsc",
					"-p",
					join(temporary, "tsconfig.json"),
					"--pretty",
					"false",
				],
				{ cwd: repositoryRoot, stderr: "pipe", stdout: "pipe" },
			);
			const output = `${result.stdout.toString()}${result.stderr.toString()}`;
			expect(output).toBe("");
			expect(result.exitCode).toBe(0);
		} finally {
			await rm(temporary, { force: true, recursive: true });
		}
	});
});
