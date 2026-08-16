import { expect, test } from "bun:test";

import type { SQL } from "bun";
import { principal } from "questpie";

import {
	CommittedResultUnavailable,
	linkReactionProjection,
} from "../../packages/runtime/src/mutation";
import { createPostgresMutationInvoker } from "../../packages/runtime/src/mutation/postgres";
import type { PreparedOperation } from "../../packages/runtime/src/operation";

const messageId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b63a0";
const callId = "stable-call-id";

type Row = Readonly<Record<string, unknown>>;

function postgres(commitFails: boolean): Readonly<{
	sql: SQL;
	statements: readonly string[];
}> {
	const statements: string[] = [];
	const rows = (statement: string): readonly Row[] => {
		if (
			statement.startsWith(
				"INSERT INTO questpie_internal.mutation_call_receipts",
			)
		)
			return [
				{
					transactionId: "901",
					operationTime: new Date("2026-08-16T00:00:00.000Z"),
				},
			];
		if (statement.startsWith('INSERT INTO "collaboration"."messages"'))
			return [{ id: messageId }];
		return [];
	};
	const session = {
		unsafe(statement: string) {
			statements.push(statement);
			const promise =
				statement === "COMMIT" && commitFails
					? Promise.reject(new Error("connection lost during COMMIT"))
					: Promise.resolve(rows(statement));
			const query = {
				cancel: () => query,
				execute: () => query,
				// oxlint-disable-next-line unicorn/no-thenable -- Bun PendingQuery is intentionally awaitable.
				then: promise.then.bind(promise),
			};
			return query;
		},
		close: async () => {},
		release: async () => {},
	};
	return {
		statements,
		sql: { reserve: async () => session } as unknown as SQL,
	};
}

const collectionPlans = {
	plans: [
		{
			identity: "mutation:messages.create",
			target: "collection:messages",
			member: "create",
			operation: {
				target: "collection:messages",
				member: "create",
				keyFields: [["id"]],
				callerInputFields: [["id"]],
			},
			candidate: {
				fields: [{ path: ["id"], codec: { kind: "uuid" }, nullable: false }],
			},
			fieldAuthority: { checks: [] },
			write: {
				sql: 'INSERT INTO "collaboration"."messages"',
				parameters: [
					{
						position: 1,
						postgresType: "uuid",
						kind: "callerInput",
						path: ["id"],
						codec: { kind: "uuid" },
					},
				],
				result: [
					{
						path: ["id"],
						column: "id",
						codec: { kind: "uuid" },
						nullable: false,
					},
				],
			},
			limits: { rows: 100, durationMilliseconds: 5_000 },
		},
	],
} as const;

const reactionProjection = {
	format: "questpie.reaction-projection",
	version: 1,
	reactions: [
		{
			identity: "reaction:messagePublished",
			input: {
				kind: "object",
				properties: { messageId: { kind: "uuid" } },
			},
			origin: {
				path: "src/message-published.ts",
				exportName: "messagePublished",
				packageId: null,
			},
		},
	],
} as const;

type MutationView = Readonly<{
	data: Readonly<{
		messages: Readonly<{
			create(input: unknown): Promise<Readonly<{ id: string }>>;
		}>;
	}>;
	dispatch: Readonly<{
		messagePublished(input: unknown): Promise<void>;
	}>;
}>;

const operation = {
	binding: {
		identity: "mutation:message.publish",
		kind: "mutation",
		slot: "handler",
		runtimeGraphDigest: "a".repeat(64),
		bundleExport: "publish",
		execute: async ({
			ctx,
		}: Readonly<{ input: unknown; ctx: MutationView }>) => {
			const created = await ctx.data.messages.create({
				input: { id: messageId },
			});
			await ctx.dispatch.messagePublished({ messageId: created.id });
			return created;
		},
		definition: {
			name: "message.publish",
			handler: () => undefined,
			errors: {},
		},
	},
	inputCodec: { kind: "object", properties: {} },
	output: {
		kind: "object",
		properties: { id: { kind: "uuid" } },
	},
	declaredErrors: [],
	input: {},
} as unknown as PreparedOperation<MutationView>;

function invoker(database: ReturnType<typeof postgres>) {
	return createPostgresMutationInvoker<MutationView>({
		sql: database.sql,
		collectionPlans,
		reactions: linkReactionProjection(reactionProjection),
		application: "application:collaboration",
		facts: {
			principal: principal.user({
				id: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a4",
			}),
			authority: { kind: "ordinary" },
			tenant: { id: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0" },
			values: {},
			signal: new AbortController().signal,
			deadline: null,
		},
	});
}

test("returns a committed result envelope after PostgreSQL acknowledges COMMIT", async () => {
	const database = postgres(false);
	await expect(invoker(database)(operation, callId)).resolves.toEqual({
		committed: true,
		value: { id: messageId },
	});
	expect(
		database.statements.filter((statement) => statement === "COMMIT"),
	).toHaveLength(1);
});

test("classifies an uncertain COMMIT without issuing a false ROLLBACK", async () => {
	const database = postgres(true);
	const failure = invoker(database)(operation, callId);
	await expect(failure).rejects.toBeInstanceOf(CommittedResultUnavailable);
	await expect(failure).rejects.toMatchObject({
		code: "COMMITTED_RESULT_UNAVAILABLE",
		payload: { callId, transactionId: "901" },
	});
	await failure.catch((error: unknown) => {
		expect(Object.isFrozen(error)).toBe(true);
		expect(Object.isFrozen((error as CommittedResultUnavailable).payload)).toBe(
			true,
		);
	});
	expect(database.statements).toContain("COMMIT");
	expect(database.statements).not.toContain("ROLLBACK");
});
