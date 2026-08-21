import { expect, test } from "bun:test";

import { constraint, defineCollection, field } from "questpie";

import { memberships } from "../../fixtures/collaboration/src/memberships";
import type { PostgresTransactionRunner } from "../../packages/runtime/src/postgres";
import {
	createLinkedPostgresContextBootstrapFactory,
	type LinkedPostgresContextBootstrapPlan,
	type LinkedPostgresContextBootstrapPlans,
} from "../../packages/runtime/src/relational/context-bootstrap-database";

const unknownCollection = defineCollection({
	name: "unknownRows",
	fields: { id: field.uuid({ nullable: false }) },
	constraints: { primary: constraint.primaryKey({ fields: ["id"] }) },
});

const incompatibleSameNameCollection = defineCollection({
	name: "memberships",
	fields: { id: field.uuid({ nullable: false }) },
	constraints: { primary: constraint.primaryKey({ fields: ["id"] }) },
});

function harness() {
	const statement = Object.freeze({ name: "context.memberships" });
	const linked = Object.freeze({
		plan: Object.freeze({ collection: "collection:memberships" }),
		statement,
	}) as unknown as LinkedPostgresContextBootstrapPlan;
	const plans = Object.freeze({
		plans: Object.freeze([linked]),
		get: (identity: string) =>
			identity === "collection:memberships" ? linked : undefined,
	}) satisfies LinkedPostgresContextBootstrapPlans;
	const transactions: Array<{
		signal: AbortSignal | undefined;
		statement: unknown;
		lookup: unknown;
	}> = [];
	let transactionCalls = 0;
	const database = {
		transaction: async (input: {
			control?: Readonly<{ signal?: AbortSignal }>;
			use(transaction: {
				execute(statement: unknown, lookup: unknown): Promise<unknown>;
			}): Promise<unknown>;
		}) => {
			transactionCalls += 1;
			return input.use({
				execute: async (executedStatement, lookup) => {
					transactions.push({
						signal: input.control?.signal,
						statement: executedStatement,
						lookup,
					});
					return Object.freeze({ role: "admin" });
				},
			});
		},
	} as unknown as PostgresTransactionRunner;
	return {
		database,
		linked,
		plans,
		statement,
		transactionCalls: () => transactionCalls,
		transactions,
	};
}

test("creates an immutable ContextBootstrap view bound to one root signal", async () => {
	const active = harness();
	const createBootstrap = createLinkedPostgresContextBootstrapFactory({
		database: active.database,
		plans: active.plans,
		collections: [memberships],
	});
	const firstController = new AbortController();
	const secondController = new AbortController();
	const first = createBootstrap(firstController.signal);
	const second = createBootstrap(secondController.signal);

	expect(first).not.toBe(second);
	expect(Object.isFrozen(first)).toBe(true);
	expect(Object.isFrozen(second)).toBe(true);
	const lookup = {
		key: {
			companyId: "11111111-1111-4111-8111-111111111111",
			principalId: "22222222-2222-4222-8222-222222222222",
			scopeKey: "company",
		},
		select: { role: true },
	};
	expect(await first.get(memberships, lookup)).toEqual({ role: "admin" });
	expect(await second.get(memberships, lookup)).toEqual({ role: "admin" });
	expect(active.transactions).toEqual([
		{
			signal: firstController.signal,
			statement: active.statement,
			lookup,
		},
		{
			signal: secondController.signal,
			statement: active.statement,
			lookup,
		},
	]);
	expect(active.transactionCalls()).toBe(2);
});

test("rejects unknown and unbranded Collections before transaction admission", async () => {
	const active = harness();
	const bootstrap = createLinkedPostgresContextBootstrapFactory({
		database: active.database,
		plans: active.plans,
		collections: [memberships],
	})(new AbortController().signal);
	const lookup = { key: { id: crypto.randomUUID() }, select: { id: true } };

	await expect(bootstrap.get(unknownCollection, lookup)).rejects.toThrow(
		"unknown ContextBootstrap Collection",
	);
	await expect(
		bootstrap.get({ name: "memberships" } as never, lookup),
	).rejects.toThrow("unknown ContextBootstrap Collection");
	await expect(
		bootstrap.get(incompatibleSameNameCollection as never, lookup),
	).rejects.toThrow("unknown ContextBootstrap Collection");
	expect(active.transactionCalls()).toBe(0);
});

test("requires an exact one-to-one binding between Collections and linked plans", () => {
	const active = harness();
	const unknownLinked = Object.freeze({
		plan: Object.freeze({ collection: "collection:unknownRows" }),
		statement: Object.freeze({ name: "context.unknownRows" }),
	}) as unknown as LinkedPostgresContextBootstrapPlan;
	const absentLinked = Object.freeze({
		plan: Object.freeze({ collection: "collection:memberships" }),
		statement: active.statement,
	}) as unknown as LinkedPostgresContextBootstrapPlan;
	const create = (
		plans: LinkedPostgresContextBootstrapPlans,
		collections: Parameters<
			typeof createLinkedPostgresContextBootstrapFactory
		>[0]["collections"],
	) =>
		createLinkedPostgresContextBootstrapFactory({
			database: active.database,
			plans,
			collections,
		});
	const mismatch = "ContextBootstrap Collections do not match linked plans";

	expect(() =>
		create(
			{
				plans: [active.linked, unknownLinked],
				get: () => active.linked,
			},
			[memberships, unknownCollection],
		),
	).toThrow(mismatch);
	expect(() =>
		create(
			{
				plans: [active.linked],
				get: () => absentLinked,
			},
			[memberships],
		),
	).toThrow(mismatch);
	expect(() =>
		create(
			{
				plans: [active.linked, active.linked],
				get: () => active.linked,
			},
			[memberships],
		),
	).toThrow(mismatch);
	expect(() => create(active.plans, [])).toThrow(mismatch);
	expect(() => create(active.plans, [memberships, memberships])).toThrow(
		mismatch,
	);
	expect(() => create(active.plans, [memberships, unknownCollection])).toThrow(
		mismatch,
	);
	expect(active.transactionCalls()).toBe(0);
});
