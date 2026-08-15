import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "../..");

describe("BETA-04 relational Query and Policy authoring", () => {
	test("infers one exact Message page and rejects authority-widening expressions", async () => {
		const temporary = await mkdtemp(join(tmpdir(), "questpie-beta04-types-"));
		try {
			const fixture = join(temporary, "authoring.ts");
			await writeFile(
				fixture,
				`import {
	constraint,
	dataQuery,
	defineCollection,
	definePolicy,
	field,
	policy,
	query,
} from "questpie";
import type { DataFieldDescriptor } from "questpie";

type Equal<Left, Right> =
	(<Value>() => Value extends Left ? 1 : 2) extends
	(<Value>() => Value extends Right ? 1 : 2) ? true : false;
type Expect<Value extends true> = Value;

const memberships = defineCollection({
	name: "memberships",
	fields: {
		id: field.uuid({ nullable: false, default: "randomUuid" }),
		companyId: field.uuid({ nullable: false }),
		principalId: field.uuid({ nullable: false }),
		scopeKey: field.text({ nullable: false, maxLength: 200 }),
		status: field.text({ nullable: false, maxLength: 24 }),
	},
	constraints: {
		primary: constraint.primaryKey({ fields: ["id"] }),
	},
});

const messages = defineCollection({
	name: "messages",
	fields: {
		id: field.uuid({ nullable: false, default: "randomUuid" }),
		companyId: field.uuid({ nullable: false }),
		channelId: field.uuid({ nullable: false }),
		authorId: field.uuid({ nullable: false }),
		body: field.text({ nullable: false, maxLength: 8_192 }),
		moderationNote: field.text({ nullable: true, maxLength: 2_000 }),
		createdAt: field.timestamp({
			nullable: false,
			default: "now",
			withTimezone: true,
		}),
	},
	constraints: {
		primary: constraint.primaryKey({ fields: ["id"] }),
	},
});

interface MessageDescriptor {
	readonly name: "messages";
	readonly identity: "collection:messages";
	readonly fields: {
		readonly id: DataFieldDescriptor<
			"collection:messages/field:id",
			{ readonly kind: "uuid" },
			string,
			false,
			true
		>;
		readonly body: DataFieldDescriptor<
			"collection:messages/field:body",
			{ readonly kind: "text" },
			string,
			false,
			false
		>;
		readonly channelId: DataFieldDescriptor<
			"collection:messages/field:channelId",
			{ readonly kind: "uuid" },
			string,
			false,
			false
		>;
		readonly moderationNote: DataFieldDescriptor<
			"collection:messages/field:moderationNote",
			{ readonly kind: "text" },
			string,
			true,
			false
		>;
		readonly createdAt: DataFieldDescriptor<
			"collection:messages/field:createdAt",
			{ readonly kind: "timestamp"; readonly withTimezone: true },
			string,
			false,
			true
		>;
	};
	readonly uniqueConstraints: {
		readonly primary: {
			readonly kind: "primaryKey";
			readonly fields: readonly ["id"];
		};
	};
	readonly relations: {};
}

const readableMessages = policy.rows(
	messages,
	({ row: message, principal, tenant }) =>
		policy.exists(memberships, ({ row: membership }) =>
			query.and(
				message.companyId.equal(tenant.id),
				membership.companyId.equal(message.companyId),
				membership.principalId.equal(principal.id),
				membership.scopeKey.equal("company"),
				membership.status.equal("active"),
			),
		),
);

export const messagePolicy = definePolicy(messages, {
	name: "messages.default",
	read: {
		admit: policy.authenticated(),
		rows: readableMessages,
	},
	fields: {
		output: ({ row, principal }) => ({
			moderationNote: row.authorId.equal(principal.id),
		}),
	},
});

export const messagePage = dataQuery<MessageDescriptor>()({
	from: "messages",
	parameters: {
		channelId: query.parameter.uuid({ nullable: false }),
		first: query.parameter.integer({
			nullable: false,
			minimum: 1,
			maximum: 100,
		}),
		after: query.parameter.cursor({ nullable: true }),
	},
	select: ({ fields }) => {
		// @ts-expect-error Query selection is closed to exact descriptor Fields.
		void fields.unknownField;
		return {
			id: fields.id,
			body: fields.body,
			moderationNote: fields.moderationNote,
			createdAt: fields.createdAt,
		};
	},
	where: ({ fields, parameters }) =>
		fields.channelId.equal(parameters.channelId),
	orderBy: ({ fields }) => [
		fields.createdAt.ascending({ nulls: "last" }),
		fields.id.ascending({ nulls: "last" }),
	],
	page: ({ parameters }) =>
		query.forwardCursor({
			first: parameters.first,
			after: parameters.after,
		}),
});

type _parameters = Expect<
	Equal<
		typeof messagePage.parameters,
		{ channelId: string; first: number; after: string | null }
	>
>;
type _node = Expect<
	Equal<
		(typeof messagePage.result.nodes)[number],
		{
			id: string;
			body: string;
			moderationNote: string | null;
			createdAt: string;
		}
	>
>;

policy.rows(messages, ({ row }) => {
	// @ts-expect-error Text Fields do not accept an integer operand.
	void row.body.equal(42);
	// @ts-expect-error Unknown operators cannot enter the closed Policy program.
	void row.body.contains("secret");
	return policy.public();
});

// @ts-expect-error Evidence reads return a boolean expression, never their row.
policy.exists(memberships, ({ row }) => row);

// @ts-expect-error Foundational structural Queries expose no aggregate count.
void messagePage.count;
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
						paths: {
							questpie: ["packages/questpie/src/index.ts"],
						},
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
