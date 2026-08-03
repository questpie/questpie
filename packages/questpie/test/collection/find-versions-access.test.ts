import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { collection } from "../../src/exports/index.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { createMockSession, createTestContext } from "../utils/test-context";
import { runTestDbMigrations } from "../utils/test-db";

const tenantDocuments = collection("va_docs")
	.fields(({ f }) => ({
		tenantId: f.text().required(),
		title: f.text().required(),
	}))
	.options({ versioning: true })
	.access({
		read: ({ session }) => {
			if (session?.user.id === "allow-all") return true;
			if (session?.user.id === "deny-all") return false;
			if (session?.user.id === "raw-access") {
				return { RAW: () => true } as never;
			}
			return { tenantId: session?.user.id ?? "__anonymous__" };
		},
	});

const localizedTenantDocuments = collection("localized_va_docs")
	.fields(({ f }) => ({
		tenantId: f.text().required().localized(),
		title: f.text().required().localized(),
	}))
	.options({ versioning: true })
	.access({
		read: ({ session }) => ({ tenantId: session?.user.id ?? "__anonymous__" }),
	});

const relationGuardedDocuments = collection("relation_guarded_va_docs")
	.fields(({ f }) => ({
		title: f.text().required(),
		grants: f.relation("versionAccessGrants").hasMany({
			foreignKey: "document",
			relationName: "document",
		}),
	}))
	.options({ versioning: true })
	.access({
		read: ({ session }) => ({
			grants: { some: { tenantId: { eq: session?.user.id } } },
		}),
	});

const versionAccessGrants = collection("version_access_grants").fields(
	({ f }) => ({
		tenantId: f.text().required(),
		document: f
			.relation("relationGuardedDocuments")
			.required()
			.relationName("document"),
	}),
);

describe("findVersions access predicates", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;
	const system = createTestContext({ accessMode: "system" });
	const tenantB = createTestContext({
		accessMode: "user",
		session: createMockSession({ id: "tenant-b" }),
	});

	beforeEach(async () => {
		setup = await buildMockApp({
			collections: {
				tenantDocuments,
				localizedTenantDocuments,
				relationGuardedDocuments,
				versionAccessGrants,
			},
		});
		await runTestDbMigrations(setup.app);
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	it("filters non-localized snapshots before limit and offset", async () => {
		const documents = setup.app.collections.tenantDocuments;
		const document = await documents.create(
			{ tenantId: "tenant-a", title: "Tenant A" },
			system,
		);
		await documents.updateById(
			{ id: document.id, data: { tenantId: "tenant-b", title: "Tenant B v1" } },
			system,
		);
		await documents.updateById(
			{ id: document.id, data: { tenantId: "tenant-b", title: "Tenant B v2" } },
			system,
		);

		const firstAuthorizedPage = await documents.findVersions(
			{ id: document.id, limit: 1 },
			tenantB,
		);
		const secondAuthorizedPage = await documents.findVersions(
			{ id: document.id, limit: 1, offset: 1 },
			tenantB,
		);

		expect(firstAuthorizedPage).toHaveLength(1);
		expect(firstAuthorizedPage[0]).toMatchObject({
			tenantId: "tenant-b",
			title: "Tenant B v1",
			versionNumber: 2,
		});
		expect(secondAuthorizedPage).toHaveLength(1);
		expect(secondAuthorizedPage[0]).toMatchObject({
			tenantId: "tenant-b",
			title: "Tenant B v2",
			versionNumber: 3,
		});
	});

	it("filters localized snapshots before pagination", async () => {
		const documents = setup.app.collections.localizedTenantDocuments;
		const document = await documents.create(
			{ tenantId: "tenant-a", title: "Tenant A" },
			system,
		);
		await documents.updateById(
			{ id: document.id, data: { tenantId: "tenant-b", title: "Tenant B v1" } },
			system,
		);
		await documents.updateById(
			{ id: document.id, data: { tenantId: "tenant-b", title: "Tenant B v2" } },
			system,
		);

		const versions = await documents.findVersions(
			{ id: document.id, limit: 1 },
			tenantB,
		);

		expect(versions).toHaveLength(1);
		expect(versions[0]).toMatchObject({
			tenantId: "tenant-b",
			title: "Tenant B v1",
			versionNumber: 2,
		});
	});

	it("preserves boolean and system access while failing closed on unsupported predicates", async () => {
		const documents = setup.app.collections.tenantDocuments;
		const document = await documents.create(
			{ tenantId: "tenant-a", title: "Private" },
			system,
		);
		const userContext = (id: string) =>
			createTestContext({
				accessMode: "user",
				session: createMockSession({ id }),
			});

		await expect(
			documents.findVersions({ id: document.id }, userContext("allow-all")),
		).resolves.toHaveLength(1);
		await expect(
			documents.findVersions({ id: document.id }, userContext("deny-all")),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		await expect(
			documents.findVersions({ id: document.id }, userContext("raw-access")),
		).rejects.toThrow("Cannot compile access predicate 'va_docs.RAW'");
		await expect(
			documents.findVersions({ id: document.id }, system),
		).resolves.toHaveLength(1);
	});

	it("fails closed when a current relation predicate has no historical equivalent", async () => {
		const documents = setup.app.collections.relationGuardedDocuments;
		const document = await documents.create({ title: "Private" }, system);
		await setup.app.collections.versionAccessGrants.create(
			{ tenantId: "tenant-b", document: document.id },
			system,
		);

		await expect(
			documents.findVersions({ id: document.id }, tenantB),
		).rejects.toThrow(
			"Cannot compile version-history access predicate 'relation_guarded_va_docs.grants'",
		);
	});
});
