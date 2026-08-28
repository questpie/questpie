import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { collection } from "../../src/exports/index.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { createMockSession, createTestContext } from "../utils/test-context";
import { runTestDbMigrations } from "../utils/test-db";

let authorityInputs: Array<Record<string, unknown>> = [];
let normalizedAuthorityEffects = 0;

const authorityAccounts = collection("authority_accounts")
	.fields(({ f }) => ({ name: f.text().required() }))
	.access({ read: true, create: true });

const authorityDocuments = collection("authority_documents")
	.fields(({ f }) => ({
		owner: f.relation("authorityAccounts").required(),
		title: f.text().required(),
		derivedKey: f.text().required().access({ update: false }),
	}))
	.access({
		read: true,
		create: true,
		update: ({ input, session }) => {
			const authorityInput = (input ?? {}) as Record<string, unknown>;
			authorityInputs.push({ ...authorityInput });
			if (Object.hasOwn(authorityInput, "derivedKey")) return false;

			const nextOwner = authorityInput.owner;
			if (typeof nextOwner === "string" && nextOwner !== session?.user.id) {
				return false;
			}

			return { owner: session?.user.id ?? "__anonymous__" };
		},
	})
	.hooks({
		beforeChange: ({ data, operation }) => {
			if (operation === "update" && typeof data.title === "string") {
				data.derivedKey = `server:${data.title.trim().toLowerCase()}`;
			}
		},
	});

const optimisticAuthorityDocuments = collection(
	"optimistic_authority_documents",
)
	.fields(({ f }) => ({
		owner: f.relation("authorityAccounts").required(),
		title: f.text().required(),
		derivedKey: f.text().required().access({ update: false }),
	}))
	.options({ optimisticConcurrency: true })
	.access({
		read: true,
		create: true,
		update: ({ input, session }) => {
			const authorityInput = (input ?? {}) as Record<string, unknown>;
			authorityInputs.push({ ...authorityInput });
			if (Object.hasOwn(authorityInput, "derivedKey")) return false;

			const nextOwner = authorityInput.owner;
			if (typeof nextOwner === "string" && nextOwner !== session?.user.id) {
				return false;
			}

			return { owner: session?.user.id ?? "__anonymous__" };
		},
	})
	.hooks({
		beforeChange: ({ data, operation }) => {
			if (operation === "update" && typeof data.title === "string") {
				data.derivedKey = `server:${data.title.trim().toLowerCase()}`;
			}
		},
	});

const normalizedAuthorityDocuments = collection(
	"normalized_authority_documents",
)
	.fields(({ f }) => ({
		role: f
			.text()
			.required()
			.zod((schema) => schema.trim()),
	}))
	.access({
		read: true,
		create: true,
		update: ({ input }) =>
			(input as { role?: string } | undefined)?.role !== "admin",
	})
	.hooks({
		beforeChange: ({ operation }) => {
			if (operation === "update") normalizedAuthorityEffects += 1;
		},
	});

describe("update authority input", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;
	const systemContext = createTestContext({ accessMode: "system" });

	beforeEach(async () => {
		authorityInputs = [];
		normalizedAuthorityEffects = 0;
		setup = await buildMockApp({
			collections: {
				authorityAccounts,
				authorityDocuments,
				normalizedAuthorityDocuments,
				optimisticAuthorityDocuments,
			},
		});
		await runTestDbMigrations(setup.app);
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	it("allows server-derived fenced fields while rechecking materialized belongsTo input", async () => {
		const owner = await setup.app.collections.authorityAccounts.create(
			{ name: "Owner" },
			systemContext,
		);
		const document = await setup.app.collections.authorityDocuments.create(
			{
				owner: owner.id,
				title: "Before",
				derivedKey: "server:before",
			},
			systemContext,
		);
		const ownerContext = createTestContext({
			accessMode: "user",
			session: createMockSession({ id: owner.id }),
		});

		const updated = await setup.app.collections.authorityDocuments.updateById(
			{
				id: document.id,
				data: {
					title: " After ",
					owner: { connect: { id: owner.id } },
				},
			},
			ownerContext,
		);

		expect(updated).toMatchObject({
			owner: owner.id,
			title: " After ",
			derivedKey: "server:after",
		});
		expect(
			authorityInputs.some((input) => input.owner === owner.id),
		).toBeTrue();
		expect(
			authorityInputs.every((input) => !("derivedKey" in input)),
		).toBeTrue();
	});

	it("denies a client-authored nested belongsTo change rejected after materialization", async () => {
		const owner = await setup.app.collections.authorityAccounts.create(
			{ name: "Owner" },
			systemContext,
		);
		const foreignOwner = await setup.app.collections.authorityAccounts.create(
			{ name: "Foreign owner" },
			systemContext,
		);
		const document = await setup.app.collections.authorityDocuments.create(
			{
				owner: owner.id,
				title: "Before",
				derivedKey: "server:before",
			},
			systemContext,
		);
		const ownerContext = createTestContext({
			accessMode: "user",
			session: createMockSession({ id: owner.id }),
		});

		await expect(
			setup.app.collections.authorityDocuments.updateById(
				{
					id: document.id,
					data: {
						title: "Hijacked",
						owner: { connect: { id: foreignOwner.id } },
					},
				},
				ownerContext,
			),
		).rejects.toMatchObject({ code: "FORBIDDEN" });

		await expect(
			setup.app.collections.authorityDocuments.findOne(
				{ where: { id: document.id } },
				systemContext,
			),
		).resolves.toMatchObject({
			owner: owner.id,
			title: "Before",
			derivedKey: "server:before",
		});
	});

	it("keeps update:false fields closed to caller-authored values", async () => {
		const owner = await setup.app.collections.authorityAccounts.create(
			{ name: "Owner" },
			systemContext,
		);
		const document = await setup.app.collections.authorityDocuments.create(
			{
				owner: owner.id,
				title: "Before",
				derivedKey: "server:before",
			},
			systemContext,
		);
		const ownerContext = createTestContext({
			accessMode: "user",
			session: createMockSession({ id: owner.id }),
		});

		await expect(
			setup.app.collections.authorityDocuments.updateById(
				{
					id: document.id,
					data: { derivedKey: "client:value" },
				},
				ownerContext,
			),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		await expect(
			setup.app.collections.authorityDocuments.findOne(
				{ where: { id: document.id } },
				systemContext,
			),
		).resolves.toMatchObject({ derivedKey: "server:before" });
	});

	it("allows server-derived fenced fields across every updateMany row", async () => {
		const owner = await setup.app.collections.authorityAccounts.create(
			{ name: "Owner" },
			systemContext,
		);
		await setup.app.collections.authorityDocuments.create(
			{ owner: owner.id, title: "First", derivedKey: "server:first" },
			systemContext,
		);
		await setup.app.collections.authorityDocuments.create(
			{ owner: owner.id, title: "Second", derivedKey: "server:second" },
			systemContext,
		);
		const ownerContext = createTestContext({
			accessMode: "user",
			session: createMockSession({ id: owner.id }),
		});

		const updated = await setup.app.collections.authorityDocuments.updateMany(
			{ where: { owner: owner.id }, data: { title: "Batch" } },
			ownerContext,
		);

		expect(updated).toHaveLength(2);
		expect(updated.map((document) => document.derivedKey)).toEqual([
			"server:batch",
			"server:batch",
		]);
	});

	it("preserves caller provenance through optimistic prelock recursion", async () => {
		const owner = await setup.app.collections.authorityAccounts.create(
			{ name: "Owner" },
			systemContext,
		);
		const document =
			await setup.app.collections.optimisticAuthorityDocuments.create(
				{
					owner: owner.id,
					title: "Before",
					derivedKey: "server:before",
				},
				systemContext,
			);
		authorityInputs = [];

		const updated =
			await setup.app.collections.optimisticAuthorityDocuments.updateById(
				{
					id: document.id,
					expectedRevision: document.revision,
					data: {
						title: "After",
						owner: { connect: { id: owner.id } },
					},
				},
				createTestContext({
					accessMode: "user",
					session: createMockSession({ id: owner.id }),
				}),
			);

		expect(updated).toMatchObject({
			owner: owner.id,
			derivedKey: "server:after",
			revision: document.revision + 1,
		});
		expect(
			authorityInputs.some((input) => input.owner === owner.id),
		).toBeTrue();
		expect(
			authorityInputs.every((input) => !("derivedKey" in input)),
		).toBeTrue();
	});

	it("rechecks authority against schema-normalized caller fields", async () => {
		const document =
			await setup.app.collections.normalizedAuthorityDocuments.create(
				{ role: "member" },
				systemContext,
			);
		normalizedAuthorityEffects = 0;

		await expect(
			setup.app.collections.normalizedAuthorityDocuments.updateById(
				{ id: document.id, data: { role: " admin " } },
				createTestContext({
					accessMode: "user",
					session: createMockSession({ id: crypto.randomUUID() }),
				}),
			),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		expect(normalizedAuthorityEffects).toBe(0);
		await expect(
			setup.app.collections.normalizedAuthorityDocuments.findOne(
				{ where: { id: document.id } },
				systemContext,
			),
		).resolves.toMatchObject({ role: "member" });
	});
});
