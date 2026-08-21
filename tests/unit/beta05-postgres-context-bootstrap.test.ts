import { expect, test } from "bun:test";

import type { SQL } from "bun";
import { constraint, defineCollection, field } from "questpie";

import { memberships } from "../../fixtures/collaboration/src/memberships";
import { createPostgresContextBootstrap } from "../../packages/runtime/src/relational";

interface DeferredQuery {
	cancel(): DeferredQuery;
	execute(): DeferredQuery;
	then: Promise<readonly Record<string, unknown>[]>["then"];
}

const companyId = "11111111-1111-4111-8111-111111111111";
const principalId = "22222222-2222-4222-8222-222222222222";

const scalarRows = defineCollection({
	name: "scalarRows",
	fields: {
		id: field.uuid({ nullable: false }),
		enabled: field.boolean({ nullable: false }),
		position: field.integer({ nullable: false, minimum: 0, maximum: 10 }),
		seenAt: field.timestamp({ nullable: false, withTimezone: true }),
		note: field.text({ nullable: true, maxLength: 20 }),
	},
	constraints: { primary: constraint.primaryKey({ fields: ["id"] }) },
});

const membershipSchema = {
	format: "questpie.schema-projection",
	version: 1,
	application: { name: "collaboration", postgresSchema: "collaboration" },
	requiredPostgres: {
		minimumMajor: 16,
		databaseCollation: "C.UTF-8",
		databaseCType: "C.UTF-8",
		extensions: [],
	},
	collections: [
		{
			identity: "collection:memberships",
			postgresName: "memberships",
			fields: [
				{
					identity: "collection:memberships/field:companyId",
					path: ["companyId"],
					postgresName: "company_id",
					nullable: false,
					type: { kind: "uuid" },
				},
				{
					identity: "collection:memberships/field:principalId",
					path: ["principalId"],
					postgresName: "principal_id",
					nullable: false,
					type: { kind: "uuid" },
				},
				{
					identity: "collection:memberships/field:role",
					path: ["role"],
					postgresName: "role",
					nullable: false,
					type: {
						kind: "text",
						collation: "questpie.binary",
						minLength: 1,
						maxLength: 32,
					},
				},
				{
					identity: "collection:memberships/field:scopeKey",
					path: ["scopeKey"],
					postgresName: "scope_key",
					nullable: false,
					type: {
						kind: "text",
						collation: "questpie.binary",
						minLength: 1,
						maxLength: 63,
					},
				},
				{
					identity: "collection:memberships/field:status",
					path: ["status"],
					postgresName: "status",
					nullable: false,
					type: {
						kind: "text",
						collation: "questpie.binary",
						minLength: 1,
						maxLength: 16,
					},
				},
			],
			constraints: [
				{
					identity: "collection:memberships/constraint:primary",
					kind: "primaryKey",
					postgresName: "qp_pk_memberships_primary",
					fields: [
						"collection:memberships/field:companyId",
						"collection:memberships/field:principalId",
						"collection:memberships/field:scopeKey",
					],
				},
			],
			indexes: [],
			relations: [],
		},
		{
			identity: "collection:scalarRows",
			postgresName: "scalar_rows",
			fields: [
				{
					identity: "collection:scalarRows/field:enabled",
					path: ["enabled"],
					postgresName: "enabled",
					nullable: false,
					type: { kind: "boolean" },
				},
				{
					identity: "collection:scalarRows/field:id",
					path: ["id"],
					postgresName: "id",
					nullable: false,
					type: { kind: "uuid" },
				},
				{
					identity: "collection:scalarRows/field:note",
					path: ["note"],
					postgresName: "note",
					nullable: true,
					type: { kind: "text", minLength: null, maxLength: 20 },
				},
				{
					identity: "collection:scalarRows/field:position",
					path: ["position"],
					postgresName: "position",
					nullable: false,
					type: { kind: "integer", minimum: 0, maximum: 10 },
				},
				{
					identity: "collection:scalarRows/field:seenAt",
					path: ["seenAt"],
					postgresName: "seen_at",
					nullable: false,
					type: { kind: "timestamp", withTimezone: true },
				},
			],
			constraints: [
				{
					identity: "collection:scalarRows/constraint:primary",
					kind: "primaryKey",
					postgresName: "qp_pk_scalar_rows_primary",
					fields: ["collection:scalarRows/field:id"],
				},
			],
			indexes: [],
			relations: [],
		},
	],
} as const;

function fakeSql(rows: readonly Record<string, unknown>[]) {
	const dataCalls: Array<{
		statement: string;
		parameters: readonly unknown[];
	}> = [];
	const controls: string[] = [];
	let cancellations = 0;
	let closes = 0;
	let block = false;
	let rejectActive: ((reason?: unknown) => void) | undefined;
	let started: (() => void) | undefined;
	const startedPromise = new Promise<void>((resolve) => {
		started = resolve;
	});
	const transaction = {
		async close() {
			closes += 1;
			rejectActive?.(new Error("connection closed"));
		},
		release() {},
		unsafe(
			statement: string,
			parameters: readonly unknown[] = [],
		): DeferredQuery {
			if (
				statement === "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" ||
				statement === "COMMIT" ||
				statement === "ROLLBACK"
			) {
				controls.push(statement);
				const promise = Promise.resolve<readonly Record<string, unknown>[]>([]);
				const query: DeferredQuery = {
					cancel: () => query,
					execute: () => query,
					// oxlint-disable-next-line unicorn/no-thenable -- Bun PendingQuery is intentionally awaitable.
					then: promise.then.bind(promise),
				};
				return query;
			}
			dataCalls.push({ statement, parameters });
			let rejectQuery: (reason?: unknown) => void = () => {};
			const promise = new Promise<readonly Record<string, unknown>[]>(
				(resolve, reject) => {
					rejectQuery = reject;
					if (block) {
						rejectActive = reject;
						started?.();
					} else resolve(rows);
				},
			);
			const query: DeferredQuery = {
				cancel: () => {
					cancellations += 1;
					rejectQuery(new Error("query cancelled"));
					return query;
				},
				execute: () => query,
				// oxlint-disable-next-line unicorn/no-thenable -- Bun PendingQuery is intentionally awaitable.
				then: promise.then.bind(promise),
			};
			return query;
		},
	};
	return {
		dataCalls,
		controls,
		startedPromise,
		get cancellations() {
			return cancellations;
		},
		get closes() {
			return closes;
		},
		setBlock(value: boolean) {
			block = value;
		},
		sql: { reserve: async () => transaction } as unknown as SQL,
	};
}

const lookup = {
	key: { companyId, principalId, scopeKey: "company" },
	select: {
		companyId: true,
		principalId: true,
		role: true,
		scopeKey: true,
		status: true,
	},
} as const;

test("projects Schema once and binds a ContextBootstrap per execution", () => {
	let schemaReads = 0;
	const schema = new Proxy(membershipSchema, {
		get(target, property, receiver) {
			schemaReads += 1;
			return Reflect.get(target, property, receiver);
		},
	});
	const factory = createPostgresContextBootstrap({
		sql: fakeSql([]).sql,
		schema,
	});
	const projectedReads = schemaReads;
	expect(projectedReads).toBeGreaterThan(0);
	const first = factory(new AbortController().signal);
	const second = factory(new AbortController().signal);
	expect(first).not.toBe(second);
	expect(typeof first.get).toBe("function");
	expect(typeof second.get).toBe("function");
	expect(schemaReads).toBe(projectedReads);
});

test("loads the active membership through one static RR/RO PostgreSQL lookup", async () => {
	const database = fakeSql([
		{
			companyId,
			principalId,
			role: "member",
			scopeKey: "company",
			status: "active",
		},
	]);
	const bootstrap = createPostgresContextBootstrap({
		sql: database.sql,
		schema: membershipSchema,
	})(new AbortController().signal);

	await expect(bootstrap.get(memberships, lookup)).resolves.toEqual({
		companyId,
		principalId,
		role: "member",
		scopeKey: "company",
		status: "active",
	});
	expect(database.dataCalls).toEqual([
		{
			statement:
				'SELECT "company_id" AS "companyId", "principal_id" AS "principalId", "role" AS "role", "scope_key" AS "scopeKey", "status" AS "status"\nFROM "collaboration"."memberships"\nWHERE "company_id" = $1 AND "principal_id" = $2 AND "scope_key" = $3\nLIMIT 1\n',
			parameters: [companyId, principalId, "company"],
		},
	]);
	expect(database.controls).toEqual([
		"BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
		"COMMIT",
	]);
});

test("refuses unknown and inexact key/select shapes before reserving SQL", async () => {
	const database = fakeSql([]);
	const bootstrap = createPostgresContextBootstrap({
		sql: database.sql,
		schema: membershipSchema,
	})(new AbortController().signal);
	const unknownCollection = { ...memberships, name: "missing" };

	await expect(bootstrap.get(unknownCollection, lookup)).rejects.toThrow(
		"unknown ContextBootstrap Collection",
	);
	await expect(
		bootstrap.get(memberships, {
			...lookup,
			key: { ...lookup.key, extra: "hostile" },
		} as never),
	).rejects.toThrow("exact primary key");
	await expect(
		bootstrap.get(memberships, {
			...lookup,
			select: { ...lookup.select, missing: true },
		} as never),
	).rejects.toThrow("unknown selected Field");
	expect(database.dataCalls).toEqual([]);
	expect(database.controls).toEqual([]);
});

test("fails closed on malformed PostgreSQL values", async () => {
	const database = fakeSql([
		{
			companyId: "not-a-uuid",
			principalId,
			role: "member",
			scopeKey: "company",
			status: "active",
		},
	]);
	const bootstrap = createPostgresContextBootstrap({
		sql: database.sql,
		schema: membershipSchema,
	})(new AbortController().signal);

	await expect(bootstrap.get(memberships, lookup)).rejects.toThrow(
		"invalid PostgreSQL ContextBootstrap value",
	);
});

test("decodes boolean, integer, timestamp, and nullable text from the projection", async () => {
	const database = fakeSql([
		{
			enabled: true,
			note: null,
			position: 7,
			seenAt: new Date("2026-08-15T12:34:56.789Z"),
		},
	]);
	const bootstrap = createPostgresContextBootstrap({
		sql: database.sql,
		schema: membershipSchema,
	})(new AbortController().signal);

	await expect(
		bootstrap.get(scalarRows, {
			key: { id: companyId },
			select: { enabled: true, note: true, position: true, seenAt: true },
		}),
	).resolves.toEqual({
		enabled: true,
		note: null,
		position: 7,
		seenAt: "2026-08-15T12:34:56.789Z",
	});
});

test("cancels an active membership lookup through the execution signal", async () => {
	const database = fakeSql([]);
	const controller = new AbortController();
	database.setBlock(true);
	const bootstrap = createPostgresContextBootstrap({
		sql: database.sql,
		schema: membershipSchema,
	})(controller.signal);
	const blocked = bootstrap.get(memberships, lookup);
	await database.startedPromise;
	controller.abort(new Error("execution disconnected"));

	await expect(blocked).rejects.toThrow("query cancelled");
	expect(database.cancellations).toBe(1);
	expect(database.closes).toBe(1);
	expect(database.controls).toContain("ROLLBACK");
});
