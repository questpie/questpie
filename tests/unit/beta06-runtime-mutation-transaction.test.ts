import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

import type { SQL } from "bun";
import { principal } from "questpie";

import { linkReactionProjection } from "../../packages/runtime/src/mutation";
import { createPostgresMutationInvoker } from "../../packages/runtime/src/mutation/postgres";
import type { PreparedOperation } from "../../packages/runtime/src/operation";

const tenantId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0";
const principalId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a4";
const widgetId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b63a0";

type Row = Readonly<Record<string, unknown>>;

function postgres(denial: "candidatePolicy" | "fieldAuthority" | null = null) {
	const statements: Array<
		Readonly<{ sql: string; parameters: readonly unknown[] }>
	> = [];
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
		if (
			statement.startsWith("UPDATE questpie_internal.pending_reaction_intents")
		)
			return [{ dispatchId: "e6b69be2-3b11-54b4-a08e-39eac72a9e1c" }];
		if (statement.startsWith("INSERT INTO questpie_internal.durable_runs"))
			return [{ runId: "5b0f6f2c-2b0a-5e7d-9c1f-2a4d6b8c0e12" }];
		if (statement === "CHECK_WIDGET_FIELD")
			return denial === "fieldAuthority" ? [] : [{ allowed: true }];
		if (statement === "INSERT_WIDGET")
			return denial === "candidatePolicy" ? [] : [{ qp_result_0: widgetId }];
		return [];
	};
	const session = {
		unsafe(statement: string, parameters: readonly unknown[] = []) {
			statements.push({ sql: statement, parameters });
			const promise = Promise.resolve(rows(statement));
			const query = {
				cancel: () => query,
				execute: () => query,
				// oxlint-disable-next-line unicorn/no-thenable -- mirrors Bun PendingQuery.
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

const collectionPlanList = [
	{
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
					sql: "CHECK_WIDGET_FIELD",
					parameters: [],
				},
			],
		},
		write: {
			sql: "INSERT_WIDGET",
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
		},
		limits: { rows: 100, durationMilliseconds: 5_000 },
	},
] as const;

const collectionPlans = {
	plans: collectionPlanList,
	byIdentity: new Map(collectionPlanList.map((plan) => [plan.identity, plan])),
};

const reactionProjection = {
	format: "questpie.reaction-projection",
	version: 2,
	reactions: [
		{
			identity: "reaction:notifyWidget",
			input: {
				kind: "object",
				properties: { widgetId: { kind: "uuid" } },
			},
			output: { kind: "object", properties: { id: { kind: "uuid" } } },
			declaredErrors: {},
			runAs: { actor: "caller", whenDenied: "fail" },
			retry: {
				maximumAttempts: 8,
				initialDelayMilliseconds: 1_000,
				backoff: "exponential",
				maximumDelayMilliseconds: 900_000,
				jitter: "full",
				horizonMilliseconds: 86_400_000,
			},
			effects: [],
			contractDigest: "c".repeat(64),
			origin: {
				path: "src/renamed-export.ts",
				exportName: "notTheDispatchMember",
				packageId: null,
			},
		},
	],
} as const;

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
	binding: {
		identity: "mutation:widgets.publish",
		kind: "mutation",
		slot: "handler",
		runtimeGraphDigest: "a".repeat(64),
		bundleExport: "publish",
		execute: async ({ ctx }: Readonly<{ ctx: View }>) => {
			const widget = await ctx.data.widgets.create({ input: { id: widgetId } });
			await ctx.dispatch.notifyWidget({ widgetId: widget.id });
			return widget;
		},
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

test("executes only linked Collection plans and projection-derived Reaction intent", async () => {
	const database = postgres();
	const invoke = createPostgresMutationInvoker<View>({
		sql: database.sql,
		application: "application:generic",
		collectionPlans,
		reactions: linkReactionProjection(reactionProjection),
		contextInputCodec: { kind: "object", properties: {} },
		runtimeBuildDigest: "d".repeat(64),
		facts: {
			principal: principal.user({ id: principalId }),
			authority: { kind: "ordinary" },
			tenant: { id: tenantId },
			values: {},
			contextInput: {},
			liveQueryObservation: null,
			signal: new AbortController().signal,
			deadline: null,
		},
	});

	await expect(invoke(operation, "stable-call-id")).resolves.toEqual({
		committed: true,
		value: { id: widgetId },
	});
	const intent = database.statements.find(({ sql }) =>
		sql.startsWith("INSERT INTO questpie_internal.pending_reaction_intents"),
	);
	expect(intent?.parameters[8]).toBe("reaction:notifyWidget");
	expect(
		database.statements.some(({ sql }) =>
			sql.includes("committed_change_facts"),
		),
	).toBe(false);
});

test("rejects the same non-canonical call identity as the wire adapter", async () => {
	const database = postgres();
	const invoke = createPostgresMutationInvoker<View>({
		sql: database.sql,
		application: "application:generic",
		collectionPlans,
		reactions: linkReactionProjection(reactionProjection),
		contextInputCodec: { kind: "object", properties: {} },
		runtimeBuildDigest: "d".repeat(64),
		facts: {
			principal: principal.user({ id: principalId }),
			authority: { kind: "ordinary" },
			tenant: { id: tenantId },
			values: {},
			contextInput: {},
			liveQueryObservation: null,
			signal: new AbortController().signal,
			deadline: null,
		},
	});

	for (const invalid of ["", "x".repeat(257), "call-e\u0301"])
		await expect(invoke(operation, invalid)).rejects.toThrow(
			"Mutation call identity is invalid",
		);
	expect(database.statements).toHaveLength(0);
});

test("accepts the maximum canonical Mutation call identity", async () => {
	const database = postgres();
	const invoke = createPostgresMutationInvoker<View>({
		sql: database.sql,
		application: "application:generic",
		collectionPlans,
		reactions: linkReactionProjection(reactionProjection),
		contextInputCodec: { kind: "object", properties: {} },
		runtimeBuildDigest: "d".repeat(64),
		facts: {
			principal: principal.user({ id: principalId }),
			authority: { kind: "ordinary" },
			tenant: { id: tenantId },
			values: {},
			contextInput: {},
			liveQueryObservation: null,
			signal: new AbortController().signal,
			deadline: null,
		},
	});

	await expect(invoke(operation, "x".repeat(256))).resolves.toMatchObject({
		committed: true,
	});
});

test("runtime transaction implementation contains no collaboration fixture nouns", async () => {
	const source = await readFile(
		new URL("../../packages/runtime/src/mutation/postgres.ts", import.meta.url),
		"utf8",
	);
	expect(source).not.toMatch(
		/messagePublished|reaction:message|collection === "messages"/,
	);
	expect(source).not.toContain("committed_change_facts");
});

test("rejects payloads outside the compiled Reaction codec before commit", async () => {
	const database = postgres();
	const invalid = {
		...operation,
		binding: {
			...operation.binding,
			execute: async ({ ctx }: Readonly<{ ctx: View }>) => {
				await ctx.dispatch.notifyWidget({ widgetId: "not-a-uuid" });
				return { id: widgetId };
			},
		},
	} as unknown as PreparedOperation<View>;
	const invoke = createPostgresMutationInvoker<View>({
		sql: database.sql,
		application: "application:generic",
		collectionPlans,
		reactions: linkReactionProjection(reactionProjection),
		contextInputCodec: { kind: "object", properties: {} },
		runtimeBuildDigest: "d".repeat(64),
		facts: {
			principal: principal.user({ id: principalId }),
			authority: { kind: "ordinary" },
			tenant: { id: tenantId },
			values: {},
			contextInput: {},
			liveQueryObservation: null,
			signal: new AbortController().signal,
			deadline: null,
		},
	});
	await expect(invoke(invalid, "invalid-payload")).rejects.toThrow(
		"must be a canonical UUID",
	);
	expect(database.statements.map(({ sql }) => sql)).toContain("ROLLBACK");
});

test("rolls back the receipt and every sibling on Field or candidate Policy denial", async () => {
	for (const denial of ["fieldAuthority", "candidatePolicy"] as const) {
		const database = postgres(denial);
		const invoke = createPostgresMutationInvoker<View>({
			sql: database.sql,
			application: "application:generic",
			collectionPlans,
			reactions: linkReactionProjection(reactionProjection),
			facts: {
				principal: principal.user({ id: principalId }),
				authority: { kind: "ordinary" },
				tenant: { id: tenantId },
				values: {},
				signal: new AbortController().signal,
				deadline: null,
			},
		});

		await expect(invoke(operation, `denied:${denial}`)).rejects.toThrow(
			"Collection operation is unavailable",
		);
		const statements = database.statements.map(({ sql }) => sql);
		expect(statements).toContain("ROLLBACK");
		expect(statements).not.toContain(
			expect.stringContaining(
				"INSERT INTO questpie_internal.pending_reaction_intents",
			),
		);
		expect(statements).not.toContain(
			expect.stringContaining("SET outcome = 'committed'"),
		);
		expect(statements.includes("INSERT_WIDGET")).toBe(
			denial === "candidatePolicy",
		);
	}
});

test("strictly rejects widened Reaction projection before root construction", () => {
	expect(() =>
		linkReactionProjection({ ...reactionProjection, runtimeRegistry: {} }),
	).toThrow("Invalid Reaction projection: artifact has invalid keys");
});
