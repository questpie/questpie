import { expect, test } from "bun:test";

import { principal } from "questpie";

import {
	linkReactionProjection,
	type LinkedReactionProjection,
} from "../../packages/runtime/src/durable";
import type {
	LinkedPostgresCollectionOperationPlansV1,
	LinkedPostgresMutationTransactionStatements,
} from "../../packages/runtime/src/mutation";
import { createPostgresDatabaseMutationInvoker } from "../../packages/runtime/src/mutation/postgres-database";
import {
	CommittedResultUnavailable,
	type PreparedOperation,
} from "../../packages/runtime/src/operation";
import {
	definePostgresStatement,
	QuestpiePostgresError,
	transactionBrand,
	type PostgresParameter,
	type PostgresStatement,
	type PostgresTransactionRunner,
} from "../../packages/runtime/src/postgres/contract";

const tenantId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0";
const principalId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a4";
const widgetId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b63a0";
const operationTime = new Date("2026-08-22T00:00:00.000Z");

const fixedIdentities = [
	"mutation.dispatch.event.insert",
	"mutation.dispatch.intent.accept",
	"mutation.dispatch.intent.insert",
	"mutation.dispatch.kernel.mark",
	"mutation.dispatch.run.insert",
	"mutation.receipt.claim",
	"mutation.receipt.commit",
	"mutation.receipt.read",
] as const;

function statement(
	name: string,
	parameterCount: number,
): PostgresStatement<readonly PostgresParameter[], readonly never[]> {
	return definePostgresStatement({
		name,
		text: `SELECT ${parameterCount}`,
		parameterCount,
		parameters: (value) => value,
		decode: () => [],
	});
}

function fixedStatements(): LinkedPostgresMutationTransactionStatements {
	const parameterCounts = new Map<string, number>([
		["mutation.dispatch.event.insert", 7],
		["mutation.dispatch.intent.accept", 2],
		["mutation.dispatch.intent.insert", 12],
		["mutation.dispatch.kernel.mark", 0],
		["mutation.dispatch.run.insert", 16],
		["mutation.receipt.claim", 7],
		["mutation.receipt.commit", 8],
		["mutation.receipt.read", 6],
	]);
	const statements = fixedIdentities.map((identity) =>
		Object.freeze({
			identity,
			statement: statement(identity, parameterCounts.get(identity)!),
		}),
	);
	const byIdentity = new Map(
		statements.map((entry) => [entry.identity, entry]),
	);
	return Object.freeze({
		statements,
		get: (identity: string) => byIdentity.get(identity),
	});
}

const authorityStatement = statement("collection.widgets.create.authority", 0);
const writeStatement = statement("collection.widgets.create.write", 1);
const collectionPlan = {
	identity: "mutation:widgets.create",
	target: "collection:widgets",
	member: "create",
	operation: {
		target: "collection:widgets",
		member: "create",
		keyFields: [["id"]],
		callerInputFields: [["id"]],
	},
	candidate: {
		fields: [{ path: ["id"], codec: { kind: "uuid" }, nullable: false }],
	},
	fieldAuthority: {
		checks: [
			{
				path: ["id"],
				sql: "SELECT TRUE",
				parameters: [],
				statement: authorityStatement,
			},
		],
	},
	write: {
		sql: "INSERT WIDGET",
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
				column: "qp_result_0",
				codec: { kind: "uuid" },
				nullable: false,
			},
		],
		statement: writeStatement,
	},
	limits: { rows: 100, durationMilliseconds: 5_000 },
} as const;

const collectionPlans = {
	plans: [collectionPlan],
	byIdentity: new Map([[collectionPlan.identity, collectionPlan]]),
} as unknown as LinkedPostgresCollectionOperationPlansV1;

const emptyReactions = Object.freeze({
	members: new Map(),
	byIdentity: new Map(),
}) as LinkedReactionProjection;

const facts = {
	principal: principal.user({ id: principalId }),
	authority: { kind: "ordinary" as const },
	tenant: { id: tenantId },
	values: {},
	contextInput: {},
	liveQueryObservation: null,
	signal: new AbortController().signal,
	deadline: null,
};

type View = Readonly<{
	data: Readonly<{
		widgets: Readonly<{
			create(value: unknown): Promise<Readonly<{ id: string }>>;
		}>;
	}>;
	dispatch: Readonly<{
		notifyWidget(value: unknown): Promise<void>;
	}>;
}>;

const operation = {
	admission: "authenticated",
	binding: {
		identity: "mutation:widgets.publish",
		kind: "mutation",
		slot: "handler",
		runtimeGraphDigest: "a".repeat(64),
		bundleExport: "publish",
		execute: async ({ ctx }: Readonly<{ ctx: View }>) =>
			ctx.data.widgets.create({ input: { id: widgetId } }),
		definition: {
			name: "widgets.publish",
			handler: () => undefined,
			errors: {},
		},
	},
	inputCodec: { kind: "object", properties: {} },
	output: { kind: "object", properties: { id: { kind: "uuid" } } },
	declaredErrors: [],
	input: {},
} as unknown as PreparedOperation<View>;

const reactions = linkReactionProjection({
	format: "questpie.reaction-projection",
	version: 2,
	reactions: [
		{
			identity: "reaction:notifyWidget",
			input: {
				kind: "object",
				properties: { widgetId: { kind: "uuid" } },
			},
			output: { kind: "object", properties: {} },
			declaredErrors: {},
			runAs: { actor: "caller", whenDenied: "fail" },
			retry: {
				maximumAttempts: 3,
				initialDelayMilliseconds: 1_000,
				backoff: "exponential",
				maximumDelayMilliseconds: 60_000,
				jitter: "full",
				horizonMilliseconds: 86_400_000,
			},
			effects: [],
			contractDigest: "c".repeat(64),
			origin: {
				path: "src/reactions.ts",
				exportName: "notifyWidget",
				packageId: null,
			},
		},
	],
});

const dispatchedOperation = {
	...operation,
	binding: {
		...operation.binding,
		execute: async ({ ctx }: Readonly<{ ctx: View }>) => {
			const widget = await ctx.data.widgets.create({ input: { id: widgetId } });
			await ctx.dispatch.notifyWidget({ widgetId: widget.id });
			return widget;
		},
	},
} as unknown as PreparedOperation<View>;

test("executes a fresh Mutation through one static read-committed database transaction", async () => {
	const linked = fixedStatements();
	let controlSignal: AbortSignal | undefined;
	let handlerSignal: AbortSignal | undefined;
	const signalOperation = {
		...operation,
		binding: {
			...operation.binding,
			execute: async ({
				ctx,
			}: Readonly<{ ctx: View & { signal: AbortSignal } }>) => {
				handlerSignal = ctx.signal;
				return ctx.data.widgets.create({ input: { id: widgetId } });
			},
		},
	} as unknown as PreparedOperation<View>;
	const calls: Array<
		Readonly<{ name: string; parameters: readonly unknown[] }>
	> = [];
	let transactionCalls = 0;
	const database: PostgresTransactionRunner = {
		async transaction(input) {
			transactionCalls += 1;
			controlSignal = input.control?.signal;
			expect(input.mode).toEqual({
				isolation: "readCommitted",
				access: "readWrite",
			});
			return input.use({
				[transactionBrand]: true,
				async execute(candidate, value) {
					const parameters = candidate.parameters(value);
					calls.push({ name: candidate.name, parameters });
					if (candidate === linked.get("mutation.receipt.claim")?.statement)
						return [{ transactionId: "901", operationTime }] as never;
					if (candidate === authorityStatement) return [{}] as never;
					if (candidate === writeStatement)
						return [{ qp_result_0: widgetId }] as never;
					return [] as never;
				},
			});
		},
	};
	const invoke = createPostgresDatabaseMutationInvoker<View>({
		database,
		application: "application:generic",
		transactionStatements: linked,
		collectionPlans,
		reactions: emptyReactions,
		contextInputCodec: { kind: "object", properties: {} },
		runtimeBuildDigest: "d".repeat(64),
		facts,
	});

	await expect(
		invoke(signalOperation, "database-static-call"),
	).resolves.toEqual({
		committed: true,
		value: { id: widgetId },
	});
	expect(transactionCalls).toBe(1);
	expect(handlerSignal).toBe(controlSignal);
	expect(calls.map(({ name }) => name)).toEqual([
		"mutation.receipt.claim",
		"collection.widgets.create.authority",
		"collection.widgets.create.write",
		"mutation.receipt.commit",
	]);
	expect(calls[0]?.parameters).toEqual([
		"application:generic",
		tenantId,
		"mutation:widgets.publish",
		"user",
		principalId,
		"database-static-call",
		expect.stringMatching(/^[0-9a-f]{64}$/),
	]);
});

test("refuses a malformed receipt transaction identity before the handler", async () => {
	const linked = fixedStatements();
	let handlerCalls = 0;
	const invalidOperation = {
		...operation,
		binding: {
			...operation.binding,
			execute: async () => {
				handlerCalls += 1;
				return { id: widgetId };
			},
		},
	} as unknown as PreparedOperation<View>;
	const database: PostgresTransactionRunner = {
		transaction: (input) =>
			input.use({
				[transactionBrand]: true,
				execute: async (candidate) =>
					(candidate === linked.get("mutation.receipt.claim")?.statement
						? [{ transactionId: "not-xid", operationTime }]
						: []) as never,
			}),
	};
	const invoke = createPostgresDatabaseMutationInvoker<View>({
		database,
		application: "application:generic",
		transactionStatements: linked,
		collectionPlans,
		reactions: emptyReactions,
		contextInputCodec: { kind: "object", properties: {} },
		runtimeBuildDigest: "d".repeat(64),
		facts,
	});

	await expect(invoke(invalidOperation, "invalid-xid")).rejects.toThrow(
		"transaction id must be a PostgreSQL xid8",
	);
	expect(handlerCalls).toBe(0);
});

test("refuses a surplus fixed statement before entering a transaction", () => {
	const linked = fixedStatements();
	let transactionCalls = 0;
	const database: PostgresTransactionRunner = {
		transaction: async () => {
			transactionCalls += 1;
			throw new Error("unreachable");
		},
	};
	expect(() =>
		createPostgresDatabaseMutationInvoker({
			database,
			application: "application:generic",
			transactionStatements: Object.freeze({
				...linked,
				statements: Object.freeze([
					...linked.statements,
					linked.statements[0]!,
				]),
			}),
			collectionPlans,
			reactions: emptyReactions,
			contextInputCodec: { kind: "object", properties: {} },
			runtimeBuildDigest: "d".repeat(64),
			facts,
		}),
	).toThrow("PostgreSQL Mutation fixed statements are incomplete");
	expect(transactionCalls).toBe(0);
});

test("joins one projected Reaction dispatch to the same static transaction", async () => {
	const linked = fixedStatements();
	const calls: Array<
		Readonly<{ name: string; parameters: readonly unknown[] }>
	> = [];
	const database: PostgresTransactionRunner = {
		transaction: (input) =>
			input.use({
				[transactionBrand]: true,
				async execute(candidate, value) {
					const parameters = candidate.parameters(value);
					calls.push({ name: candidate.name, parameters });
					if (candidate === linked.get("mutation.receipt.claim")?.statement)
						return [{ transactionId: "902", operationTime }] as never;
					if (candidate === authorityStatement) return [{}] as never;
					if (candidate === writeStatement)
						return [{ qp_result_0: widgetId }] as never;
					if (
						candidate === linked.get("mutation.dispatch.kernel.mark")?.statement
					)
						return [{ enabled: "on" }] as never;
					if (
						candidate ===
						linked.get("mutation.dispatch.intent.accept")?.statement
					)
						return [{ dispatchId: parameters[1] }] as never;
					if (
						candidate === linked.get("mutation.dispatch.run.insert")?.statement
					)
						return [{ runId: parameters[1] }] as never;
					return [] as never;
				},
			}),
	};
	const invoke = createPostgresDatabaseMutationInvoker<View>({
		database,
		application: "application:generic",
		transactionStatements: linked,
		collectionPlans,
		reactions,
		contextInputCodec: { kind: "object", properties: {} },
		runtimeBuildDigest: "d".repeat(64),
		facts,
	});

	await expect(
		invoke(dispatchedOperation, "database-dispatch-call"),
	).resolves.toMatchObject({ committed: true, value: { id: widgetId } });
	expect(calls.map(({ name }) => name)).toEqual([
		"mutation.receipt.claim",
		"collection.widgets.create.authority",
		"collection.widgets.create.write",
		"mutation.dispatch.kernel.mark",
		"mutation.dispatch.intent.insert",
		"mutation.dispatch.kernel.mark",
		"mutation.dispatch.intent.accept",
		"mutation.dispatch.run.insert",
		"mutation.dispatch.event.insert",
		"mutation.receipt.commit",
	]);
	expect(calls[4]?.parameters).toHaveLength(12);
	expect(calls[6]?.parameters[1]).toBe(calls[4]?.parameters[7]);
	expect(calls[7]?.parameters).toHaveLength(16);
	expect(calls[8]?.parameters[1]).toBe(calls[7]?.parameters[1]);
});

test("wraps only a caller-resolvable commit outcome after learning the xid", async () => {
	for (const phase of ["commit", "statement"] as const) {
		const linked = fixedStatements();
		const failure = new QuestpiePostgresError({
			code: "commitOutcomeUnknown",
			phase,
			retry: "callerMustResolveCommit",
		});
		const database: PostgresTransactionRunner = {
			async transaction(input) {
				await input.use({
					[transactionBrand]: true,
					async execute(candidate) {
						if (candidate === linked.get("mutation.receipt.claim")?.statement)
							return [{ transactionId: "903", operationTime }] as never;
						if (candidate === authorityStatement) return [{}] as never;
						if (candidate === writeStatement)
							return [{ qp_result_0: widgetId }] as never;
						return [] as never;
					},
				});
				throw failure;
			},
		};
		const invoke = createPostgresDatabaseMutationInvoker<View>({
			database,
			application: "application:generic",
			transactionStatements: linked,
			collectionPlans,
			reactions: emptyReactions,
			contextInputCodec: { kind: "object", properties: {} },
			runtimeBuildDigest: "d".repeat(64),
			facts,
		});

		try {
			await invoke(operation, `ambiguous-${phase}`);
			throw new Error("expected invocation to reject");
		} catch (error) {
			if (phase === "commit") {
				expect(error).toBeInstanceOf(CommittedResultUnavailable);
				expect(error).toMatchObject({
					payload: { callId: "ambiguous-commit", transactionId: "903" },
				});
			} else expect(error).toBe(failure);
		}
	}
});

test("replays a committed receipt without handler, Collection, dispatch, or receipt update", async () => {
	const linked = fixedStatements();
	const calls: string[] = [];
	let handlerCalls = 0;
	let claimedDigest = "";
	const replayOperation = {
		...operation,
		binding: {
			...operation.binding,
			execute: async () => {
				handlerCalls += 1;
				return { id: widgetId };
			},
		},
	} as unknown as PreparedOperation<View>;
	const resultBytes = new TextEncoder().encode(
		JSON.stringify({ id: widgetId }),
	);
	const database: PostgresTransactionRunner = {
		transaction: (input) =>
			input.use({
				[transactionBrand]: true,
				async execute(candidate, value) {
					calls.push(candidate.name);
					if (candidate === linked.get("mutation.receipt.claim")?.statement) {
						claimedDigest = value[6] as string;
						return [] as never;
					}
					if (candidate === linked.get("mutation.receipt.read")?.statement)
						return [
							{
								inputDigest: claimedDigest,
								outcome: "committed",
								resultBytes,
								transactionId: "904",
							},
						] as never;
					throw new Error("unexpected statement");
				},
			}),
	};
	const invoke = createPostgresDatabaseMutationInvoker<View>({
		database,
		application: "application:generic",
		transactionStatements: linked,
		collectionPlans,
		reactions,
		contextInputCodec: { kind: "object", properties: {} },
		runtimeBuildDigest: "d".repeat(64),
		facts,
	});

	await expect(invoke(replayOperation, "replay-call")).resolves.toEqual({
		committed: true,
		value: { id: widgetId },
	});
	expect(calls).toEqual(["mutation.receipt.claim", "mutation.receipt.read"]);
	expect(handlerCalls).toBe(0);
});
