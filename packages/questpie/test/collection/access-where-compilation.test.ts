import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { sql } from "drizzle-orm";
import { integer, pgTable, text } from "drizzle-orm/pg-core";

import { collection } from "../../src/exports/index.js";
import { realtimeSubscribe } from "../../src/server/adapters/routes/realtime.js";
import type { CollectionBuilderState } from "../../src/server/collection/builder/types.js";
import { buildWhereClause } from "../../src/server/collection/crud/query-builders/where-builder.js";
import { mergeWhereWithAccess } from "../../src/server/collection/crud/shared/access-control.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder.js";
import { createMockSession, createTestContext } from "../utils/test-context.js";
import { runTestDbMigrations } from "../utils/test-db.js";

const parents = pgTable("access_compile_parents", {
	id: integer("id").primaryKey(),
	tenantId: text("tenant_id").notNull(),
});

const children = pgTable("access_compile_children", {
	id: integer("id").primaryKey(),
	parentId: integer("parent_id").notNull(),
});

const parentState = {
	name: "accessCompileParents",
	localized: [],
	fieldDefinitions: {},
	relations: {
		children: {
			type: "many",
			collection: "accessCompileChildren",
			relationName: "missingReverse",
		},
	},
} as unknown as CollectionBuilderState;

const childState = {
	name: "accessCompileChildren",
	localized: [],
	fieldDefinitions: {},
	relations: {},
} as unknown as CollectionBuilderState;

const app = {
	collections: {
		accessCompileChildren: {
			"~internalRelatedTable": children,
			"~internalI18nTable": null,
			"~internalState": childState,
		},
	},
} as any;

function compile(where: Record<string, unknown>) {
	return buildWhereClause(mergeWhereWithAccess(undefined, where as any)!, {
		table: parents,
		state: parentState,
		i18nCurrentTable: null,
		i18nFallbackTable: null,
		app,
		db: {},
	});
}

describe("access WHERE compilation", () => {
	it("fails closed when a hasMany access predicate has no resolvable reverse relation", () => {
		expect(() => compile({ children: { some: { id: { eq: 1 } } } })).toThrow(
			"Cannot compile access predicate 'accessCompileParents.children'",
		);
	});

	it("keeps malformed access relations fatal through AND, OR, and NOT", () => {
		for (const where of [
			{
				AND: [
					{ tenantId: { eq: "tenant-a" } },
					{ children: { some: { id: { eq: 1 } } } },
				],
			},
			{
				OR: [
					{ tenantId: { eq: "tenant-a" } },
					{ children: { some: { id: { eq: 1 } } } },
				],
			},
			{ NOT: { children: { some: { id: { eq: 1 } } } } },
		]) {
			expect(() => compile(where)).toThrow(
				"Cannot compile access predicate 'accessCompileParents.children'",
			);
		}
	});

	it("fails closed when an access field operator cannot compile", () => {
		expect(() =>
			compile({ tenantId: { unsupportedOperator: "tenant-a" } }),
		).toThrow(
			"Cannot compile access predicate 'accessCompileParents.tenantId' (operator 'unsupportedOperator')",
		);
	});

	it("allows RAW under the access marker", () => {
		expect(
			compile({
				RAW: ({ table }: { table: typeof parents }) =>
					sql`${table.tenantId} = ${"tenant-a"}`,
			}),
		).toBeDefined();
	});

	it("does not apply strict access compilation to an ordinary user where", () => {
		expect(
			buildWhereClause(
				{ children: { some: { id: { eq: 1 } } } },
				{
					table: parents,
					state: parentState,
					i18nCurrentTable: null,
					i18nFallbackTable: null,
					app,
					db: {},
				},
			),
		).toBeUndefined();
	});
});

const securedParents = collection("secured_access_compile_parents")
	.fields(({ f }) => ({
		tenantId: f.text().required(),
		children: f.relation("secured_access_compile_children").hasMany({
			foreignKey: "parent",
			relationName: "missingReverse",
		}),
	}))
	.access({
		create: true,
		read: () =>
			({
				children: { some: { tenantId: { eq: "tenant-a" } } },
			}) as any,
	});

const securedChildren = collection("secured_access_compile_children")
	.fields(({ f }) => ({
		tenantId: f.text().required(),
		parent: f.relation("secured_access_compile_parents").required(),
	}))
	.access({ create: true, read: true });

const validSecuredParents = collection("valid_secured_access_parents")
	.fields(({ f }) => ({
		name: f.text().required(),
		children: f.relation("valid_secured_access_children").hasMany({
			foreignKey: "parent",
			relationName: "parent",
		}),
	}))
	.access({
		create: true,
		read: ({ session }) => ({
			children: { some: { tenantId: { eq: session?.user.id } } },
		}),
	});

const validSecuredChildren = collection("valid_secured_access_children")
	.fields(({ f }) => ({
		tenantId: f.text().required(),
		parent: f
			.relation("valid_secured_access_parents")
			.required()
			.relationName("parent"),
	}))
	.access({ create: true, read: true });

const rawSecuredParents = collection("raw_secured_access_parents")
	.fields(({ f }) => ({
		name: f.text().required(),
		tenantId: f.text().required(),
	}))
	.access({
		create: true,
		read: ({ session }) => ({
			RAW: ({ table }) => sql`${table.tenantId} = ${session?.user.id}`,
		}),
	});

async function readSseSnapshot(
	response: Response,
): Promise<Record<string, any>> {
	const reader = response.body!.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	try {
		for (;;) {
			const separator = buffer.indexOf("\n\n");
			if (separator !== -1) {
				const frame = buffer.slice(0, separator);
				buffer = buffer.slice(separator + 2);
				const event = frame
					.split("\n")
					.find((line) => line.startsWith("event:"))
					?.slice(6)
					.trim();
				if (event === "session") continue;
				const data = frame
					.split("\n")
					.filter((line) => line.startsWith("data:"))
					.map((line) => line.slice(5).trim())
					.join("");
				return { event, data: JSON.parse(data) };
			}
			const next = await Promise.race([
				reader.read(),
				new Promise<never>((_, reject) =>
					setTimeout(
						() => reject(new Error("Timed out waiting for snapshot")),
						2_000,
					),
				),
			]);
			if (next.done) throw new Error("SSE stream closed before snapshot");
			buffer += decoder.decode(next.value, { stream: true });
		}
	} finally {
		await reader.cancel().catch(() => {});
	}
}

describe("access WHERE CRUD integration", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;

	beforeEach(async () => {
		setup = await buildMockApp({
			collections: {
				secured_access_compile_parents: securedParents,
				secured_access_compile_children: securedChildren,
				valid_secured_access_parents: validSecuredParents,
				valid_secured_access_children: validSecuredChildren,
				raw_secured_access_parents: rawSecuredParents,
			},
		});
		await runTestDbMigrations(setup.app);
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	it("rejects malformed relational access before a normal or hydrated read can reveal rows", async () => {
		await setup.app.collections.secured_access_compile_parents.create(
			{ tenantId: "tenant-b" },
			createTestContext(),
		);
		const context = createTestContext({
			accessMode: "user",
			session: createMockSession({ id: "actor-a" }),
		});

		for (const options of [{}, { with: { children: true } }]) {
			await expect(
				setup.app.collections.secured_access_compile_parents.find(
					options,
					context,
				),
			).rejects.toThrow(
				"Cannot compile access predicate 'secured_access_compile_parents.children'",
			);
		}
	});

	it("keeps a valid reverse-relation access predicate authoritative", async () => {
		const system = createTestContext();
		const parentsCrud = setup.app.collections.valid_secured_access_parents;
		const childrenCrud = setup.app.collections.valid_secured_access_children;
		const parentA = await parentsCrud.create({ name: "A" }, system);
		const parentB = await parentsCrud.create({ name: "B" }, system);
		await childrenCrud.create(
			{ tenantId: "tenant-a", parent: parentA.id },
			system,
		);
		await childrenCrud.create(
			{ tenantId: "tenant-b", parent: parentB.id },
			system,
		);

		const result = await parentsCrud.find(
			{},
			createTestContext({
				accessMode: "user",
				session: createMockSession({ id: "tenant-a" }),
			}),
		);

		expect(result.docs.map((row: { name: string }) => row.name)).toEqual(["A"]);
	});

	it("allows RAW under the access marker for a realtime find subscription", async () => {
		const crud = setup.app.collections.raw_secured_access_parents;
		await crud.create(
			{ name: "Allowed", tenantId: "tenant-a" },
			createTestContext(),
		);
		await crud.create(
			{ name: "Hidden", tenantId: "tenant-b" },
			createTestContext(),
		);

		const response = await realtimeSubscribe(
			setup.app,
			new Request("http://localhost/realtime", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					topics: [
						{
							id: "raw-access",
							resourceType: "collection",
							resource: "raw_secured_access_parents",
							operation: "find",
						},
					],
				}),
			}),
			{},
			undefined,
			{
				accessMode: "user",
				getSession: async () => createMockSession({ id: "tenant-a" }),
			},
		);

		expect(response.status).toBe(200);
		const snapshot = await readSseSnapshot(response);
		expect({
			event: snapshot.event,
			error: snapshot.data.message,
			names: snapshot.data.data?.docs?.map((row: { name: string }) => row.name),
		}).toEqual({ event: "snapshot", error: undefined, names: ["Allowed"] });
	});
});
