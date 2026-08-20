import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { sql } from "drizzle-orm";

import { collection } from "../../../src/exports/index.js";
import { createDeterministicTextEngine } from "../../../src/server/modules/core/integrated/crdt/deterministic-engine.js";
import { createCrdtManifestDeclarations } from "../../../src/server/modules/core/integrated/crdt/manifest-runtime.js";
import { updateCrdtManifestArtifact } from "../../../src/server/modules/core/integrated/crdt/manifest.js";
import { canonicalCrdtCollectionLocator } from "../../../src/server/modules/core/integrated/crdt/owner-lifecycle.js";
import {
	evaluateQuestpieCrdtOwnerPolicy,
	loadQuestpieCrdtOwnerRecord,
} from "../../../src/server/modules/core/integrated/crdt/questpie-authorization.js";
import { createCrdtRegistry } from "../../../src/server/modules/core/integrated/crdt/registry.js";
import { buildMockApp } from "../../utils/mocks/mock-app-builder.js";
import { createTestContext } from "../../utils/test-context.js";
import { runTestDbMigrations } from "../../utils/test-db.js";

const documents = collection("crdt_policy_documents")
	.options({ schema: "crdt_auth" })
	.fields(({ f }) => ({
		label: f.text().required().localized(),
		status: f
			.select([
				{ value: "draft", label: "Draft" },
				{ value: "published", label: "Published" },
			])
			.required(),
		content: f.textarea().required().default("").crdt({ format: "text" }),
		visible: f
			.boolean()
			.virtual(sql<boolean>`(crdt_policy_documents.status = 'published')`),
		unqualifiedVisible: f
			.boolean()
			.virtual(sql<boolean>`(status = 'published')`),
		schemaVisible: f
			.boolean()
			.virtual(
				sql<boolean>`(crdt_auth.crdt_policy_documents.status = 'published')`,
			),
	}))
	.collaborative()
	.access({
		read: () => ({
			AND: [
				{ label: "Visible" },
				{ status: { in: ["published"] } },
				{ visible: true },
				{ unqualifiedVisible: true },
				{ schemaVisible: true },
				{ content: { ne: "blocked" } },
			],
		}),
		update: true,
	});
const emptyPredicateDocuments = collection("crdt_empty_policy_documents")
	.fields(({ f }) => ({
		content: f.textarea().required().default("").crdt({ format: "text" }),
	}))
	.collaborative()
	.access({
		read: ({ locale }) =>
			locale === "sk"
				? { AND: [{ OR: [] }, { content: { ne: "blocked" } }] }
				: { OR: [{ content: { eq: "blocked" } }, { content: {} }] },
		update: true,
	});
const selfNodes = collection("crdt_self_nodes")
	.fields(({ f }) => ({
		status: f.text().required(),
		parent: f.relation("crdt_self_nodes").relationName("parent"),
		content: f.textarea().required().default("").crdt({ format: "text" }),
	}))
	.collaborative()
	.access({
		read: ({ locale }) =>
			locale === "sk"
				? { parent: { is: { status: { eq: "published" } } } }
				: {
						parent: {
							is: { parent: { is: { status: { eq: "published" } } } },
						},
					},
		update: true,
	});
const identifierDocuments = collection("crdt_identifier_policy_documents")
	.fields(({ f }) => ({
		status: f.text().required().default("published"),
		content: f.textarea().required().default("").crdt({ format: "text" }),
		visible: f
			.boolean()
			.virtual(
				sql<boolean>`(${sql.identifier("content")} <> 'blocked' AND ${sql.identifier("status")} = 'published')`,
			),
	}))
	.collaborative()
	.access({ read: () => ({ visible: true }), update: true });
const scopedIdentifierDocuments = collection("crdt_scoped_identifier_documents")
	.fields(({ f }) => ({
		content: f.textarea().required().default("").crdt({ format: "text" }),
		visible: f.boolean().virtual(sql<boolean>`EXISTS (
			SELECT 1 FROM (VALUES ('private')) AS inner_rows(content)
			WHERE ${sql.identifier("content")} = 'public'
		)`),
	}))
	.collaborative()
	.access({ read: () => ({ visible: true }), update: true });
const foldedIdentifierDocuments = collection("crdt_folded_identifier_documents")
	.fields(({ f }) => ({
		content: f.textarea().required().default("").crdt({ format: "text" }),
		visible: f.boolean().virtual(sql<boolean>`(CONTENT <> 'blocked')`),
	}))
	.collaborative()
	.access({ read: () => ({ visible: true }), update: true });
const rawDocuments = collection("crdt_raw_policy_documents")
	.fields(({ f }) => ({
		visible: f.boolean().required().default(true),
		content: f.textarea().required().default("").crdt({ format: "text" }),
	}))
	.collaborative()
	.access({
		read: () => ({ RAW: ({ table }) => sql`${table.visible} = true` }),
		update: true,
	});
const emptyRelationNodes = collection("crdt_empty_relation_nodes")
	.fields(({ f }) => ({
		parent: f.relation("crdt_empty_relation_nodes").relationName("parent"),
		content: f.textarea().required().default("").crdt({ format: "text" }),
	}))
	.collaborative()
	.access({ read: () => ({ parent: { is: { OR: [] } } }), update: true });
const setDocuments = collection("crdt_set_policy_documents")
	.fields(({ f }) => ({
		tags: f
			.text({ mode: "text" })
			.array()
			.default([])
			.required()
			.crdt({ format: "set", conflict: "add-wins" }),
	}))
	.collaborative()
	.access({
		read: () => ({ tags: { containsAll: ["allowed"] } }),
		update: true,
	});
const textEngine = createDeterministicTextEngine();
const crdtConfig = {
	namespace: "crdt-policy-test",
	engines: { text: textEngine },
};
const registry = createCrdtRegistry({
	collections: {
		crdt_policy_documents: documents.build(),
		crdt_empty_policy_documents: emptyPredicateDocuments.build(),
		crdt_self_nodes: selfNodes.build(),
		crdt_identifier_policy_documents: identifierDocuments.build(),
		crdt_scoped_identifier_documents: scopedIdentifierDocuments.build(),
		crdt_folded_identifier_documents: foldedIdentifierDocuments.build(),
		crdt_raw_policy_documents: rawDocuments.build(),
		crdt_empty_relation_nodes: emptyRelationNodes.build(),
		crdt_set_policy_documents: setDocuments.build(),
	},
	globals: {},
});
const manifest = updateCrdtManifestArtifact({
	namespace: crdtConfig.namespace,
	declarations: createCrdtManifestDeclarations({
		registry,
		config: crdtConfig,
	}),
	createStableFieldId: uuidSequence().next,
});

describe("QUESTPIE CRDT owner policy", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;

	beforeEach(async () => {
		setup = await buildMockApp(
			{
				collections: {
					crdt_policy_documents: documents,
					crdt_empty_policy_documents: emptyPredicateDocuments,
					crdt_self_nodes: selfNodes,
					crdt_identifier_policy_documents: identifierDocuments,
					crdt_scoped_identifier_documents: scopedIdentifierDocuments,
					crdt_folded_identifier_documents: foldedIdentifierDocuments,
					crdt_raw_policy_documents: rawDocuments,
					crdt_empty_relation_nodes: emptyRelationNodes,
					crdt_set_policy_documents: setDocuments,
				},
				crdtManifest: manifest,
			},
			{ crdt: crdtConfig, secret: "s".repeat(32) },
		);
		await setup.app.db.execute(sql`CREATE SCHEMA IF NOT EXISTS crdt_auth`);
		await runTestDbMigrations(setup.app);
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	it("evaluates collection AccessWhere through SQL operators and virtual fields", async () => {
		const system = createTestContext();
		const published = await setup.app.collections.crdt_policy_documents.create(
			{ label: "Visible", status: "published" },
			system,
		);
		const draft = await setup.app.collections.crdt_policy_documents.create(
			{ label: "Visible", status: "draft" },
			system,
		);
		const context = createTestContext({ accessMode: "user" });

		const evaluate = async (id: string) => {
			const owner = {
				kind: "collection" as const,
				key: "crdt_policy_documents",
				ownerKey: "crdt_policy_documents",
				id,
				locator: canonicalCrdtCollectionLocator(id),
			};
			const record = await loadQuestpieCrdtOwnerRecord(setup.app, owner);
			expect(record).not.toBeNull();
			return evaluateQuestpieCrdtOwnerPolicy(
				setup.app,
				owner,
				record!,
				context,
			);
		};

		expect(await evaluate(published.id)).toMatchObject({
			ownerRead: true,
			fields: { content: { read: true } },
		});
		const publishedOwner = {
			kind: "collection" as const,
			key: "crdt_policy_documents",
			ownerKey: "crdt_policy_documents",
			id: published.id,
			locator: canonicalCrdtCollectionLocator(published.id),
		};
		const projectedRecord = await loadQuestpieCrdtOwnerRecord(
			setup.app,
			publishedOwner,
		);
		expect(projectedRecord?.content).toBe("");
		await expect(
			evaluateQuestpieCrdtOwnerPolicy(
				setup.app,
				publishedOwner,
				{ ...projectedRecord!, content: "blocked" },
				context,
			),
		).resolves.toEqual({ ownerRead: false, ownerEdit: false, fields: {} });
		await expect(evaluate(draft.id)).resolves.toEqual({
			ownerRead: false,
			ownerEdit: false,
			fields: {},
		});
	});

	it("keeps a nested logically empty OR access predicate denied", async () => {
		const created =
			await setup.app.collections.crdt_empty_policy_documents.create(
				{},
				createTestContext(),
			);
		const owner = {
			kind: "collection" as const,
			key: "crdt_empty_policy_documents",
			ownerKey: "crdt_empty_policy_documents",
			id: created.id,
			locator: canonicalCrdtCollectionLocator(created.id),
		};
		const record = await loadQuestpieCrdtOwnerRecord(setup.app, owner);

		for (const locale of ["en", "sk"]) {
			await expect(
				evaluateQuestpieCrdtOwnerPolicy(
					setup.app,
					owner,
					record!,
					createTestContext({ accessMode: "user", locale }),
				),
			).resolves.toEqual({ ownerRead: false, ownerEdit: false, fields: {} });
		}
	});

	it("correlates direct and nested self-relation access to the exact owner", async () => {
		const system = createTestContext();
		const grandparent = await setup.app.collections.crdt_self_nodes.create(
			{ status: "published" },
			system,
		);
		const parent = await setup.app.collections.crdt_self_nodes.create(
			{ status: "published", parent: grandparent.id },
			system,
		);
		const child = await setup.app.collections.crdt_self_nodes.create(
			{ status: "draft", parent: parent.id },
			system,
		);
		const selfLoop = await setup.app.collections.crdt_self_nodes.create(
			{ status: "published" },
			system,
		);
		await setup.app.collections.crdt_self_nodes.updateById(
			{
				id: selfLoop.id,
				expectedRevision: selfLoop.revision,
				data: { parent: selfLoop.id },
			},
			system,
		);
		const unrelated = await setup.app.collections.crdt_self_nodes.create(
			{ status: "draft" },
			system,
		);
		const evaluate = async (id: string, locale: string) => {
			const owner = {
				kind: "collection" as const,
				key: "crdt_self_nodes",
				ownerKey: "crdt_self_nodes",
				id,
				locator: canonicalCrdtCollectionLocator(id),
			};
			const record = await loadQuestpieCrdtOwnerRecord(setup.app, owner);
			return evaluateQuestpieCrdtOwnerPolicy(
				setup.app,
				owner,
				record!,
				createTestContext({ accessMode: "user", locale }),
			);
		};

		expect((await evaluate(child.id, "sk")).ownerRead).toBe(true);
		expect((await evaluate(child.id, "en")).ownerRead).toBe(true);
		expect((await evaluate(unrelated.id, "sk")).ownerRead).toBe(false);
		expect((await evaluate(unrelated.id, "en")).ownerRead).toBe(false);
	});

	it("detects sql.identifier dependencies on current CRDT fields", async () => {
		const created =
			await setup.app.collections.crdt_identifier_policy_documents.create(
				{},
				createTestContext(),
			);
		const owner = {
			kind: "collection" as const,
			key: "crdt_identifier_policy_documents",
			ownerKey: "crdt_identifier_policy_documents",
			id: created.id,
			locator: canonicalCrdtCollectionLocator(created.id),
		};
		const record = await loadQuestpieCrdtOwnerRecord(setup.app, owner);

		const result = await evaluateQuestpieCrdtOwnerPolicy(
			setup.app,
			owner,
			{ ...record!, content: "blocked" },
			createTestContext({ accessMode: "user" }),
		);
		expect(result).toEqual({ ownerRead: false, ownerEdit: false, fields: {} });

		const previouslyBlocked =
			await setup.app.collections.crdt_identifier_policy_documents.create(
				{ content: "blocked" },
				createTestContext(),
			);
		const allowedOwner = {
			...owner,
			id: previouslyBlocked.id,
			locator: canonicalCrdtCollectionLocator(previouslyBlocked.id),
		};
		const blockedRecord = await loadQuestpieCrdtOwnerRecord(
			setup.app,
			allowedOwner,
		);
		await expect(
			evaluateQuestpieCrdtOwnerPolicy(
				setup.app,
				allowedOwner,
				{ ...blockedRecord!, content: "allowed" },
				createTestContext({ accessMode: "user" }),
			),
		).resolves.toMatchObject({ ownerRead: true });
	});

	it("does not rewrite sql.identifier inside a nested SQL scope", async () => {
		const created =
			await setup.app.collections.crdt_scoped_identifier_documents.create(
				{ content: "public" },
				createTestContext(),
			);
		const owner = {
			kind: "collection" as const,
			key: "crdt_scoped_identifier_documents",
			ownerKey: "crdt_scoped_identifier_documents",
			id: created.id,
			locator: canonicalCrdtCollectionLocator(created.id),
		};
		const record = await loadQuestpieCrdtOwnerRecord(setup.app, owner);

		await expect(
			evaluateQuestpieCrdtOwnerPolicy(
				setup.app,
				owner,
				record!,
				createTestContext({ accessMode: "user" }),
			),
		).resolves.toEqual({ ownerRead: false, ownerEdit: false, fields: {} });
	});

	it("fails closed for folded raw identifiers while projection is stale", async () => {
		const created =
			await setup.app.collections.crdt_folded_identifier_documents.create(
				{},
				createTestContext(),
			);
		const owner = {
			kind: "collection" as const,
			key: "crdt_folded_identifier_documents",
			ownerKey: "crdt_folded_identifier_documents",
			id: created.id,
			locator: canonicalCrdtCollectionLocator(created.id),
		};
		const record = await loadQuestpieCrdtOwnerRecord(setup.app, owner);

		await expect(
			evaluateQuestpieCrdtOwnerPolicy(
				setup.app,
				owner,
				{ ...record!, content: "blocked" },
				createTestContext({ accessMode: "user" }),
			),
		).resolves.toEqual({ ownerRead: false, ownerEdit: false, fields: {} });
	});

	it("does not guard CRDT fields absent from a RAW access expression", async () => {
		const created =
			await setup.app.collections.crdt_raw_policy_documents.create(
				{},
				createTestContext(),
			);
		const owner = {
			kind: "collection" as const,
			key: "crdt_raw_policy_documents",
			ownerKey: "crdt_raw_policy_documents",
			id: created.id,
			locator: canonicalCrdtCollectionLocator(created.id),
		};
		const record = await loadQuestpieCrdtOwnerRecord(setup.app, owner);

		await expect(
			evaluateQuestpieCrdtOwnerPolicy(
				setup.app,
				owner,
				{ ...record!, content: "canonical ahead" },
				createTestContext({ accessMode: "user" }),
			),
		).resolves.toMatchObject({ ownerRead: true });
	});

	it("keeps an empty OR inside a relation access predicate denied", async () => {
		const system = createTestContext();
		const parent = await setup.app.collections.crdt_empty_relation_nodes.create(
			{},
			system,
		);
		const child = await setup.app.collections.crdt_empty_relation_nodes.create(
			{ parent: parent.id },
			system,
		);
		const owner = {
			kind: "collection" as const,
			key: "crdt_empty_relation_nodes",
			ownerKey: "crdt_empty_relation_nodes",
			id: child.id,
			locator: canonicalCrdtCollectionLocator(child.id),
		};
		const record = await loadQuestpieCrdtOwnerRecord(setup.app, owner);

		await expect(
			evaluateQuestpieCrdtOwnerPolicy(
				setup.app,
				owner,
				record!,
				createTestContext({ accessMode: "user" }),
			),
		).resolves.toEqual({ ownerRead: false, ownerEdit: false, fields: {} });
	});

	it("binds the current CRDT set value with its PostgreSQL storage type", async () => {
		const created =
			await setup.app.collections.crdt_set_policy_documents.create(
				{},
				createTestContext(),
			);
		const owner = {
			kind: "collection" as const,
			key: "crdt_set_policy_documents",
			ownerKey: "crdt_set_policy_documents",
			id: created.id,
			locator: canonicalCrdtCollectionLocator(created.id),
		};
		const record = await loadQuestpieCrdtOwnerRecord(setup.app, owner);

		const result = await evaluateQuestpieCrdtOwnerPolicy(
			setup.app,
			owner,
			{ ...record!, tags: ["allowed"] },
			createTestContext({ accessMode: "user" }),
		);
		expect(result).toMatchObject({ ownerRead: true });
	});
});

function uuidSequence() {
	let counter = 0x900;
	return {
		next: () =>
			`00000000-0000-4000-8000-${(++counter).toString(16).padStart(12, "0")}`,
	};
}
