import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { collection } from "../../src/exports/index.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { createMockSession, createTestContext } from "../utils/test-context";
import { runTestDbMigrations } from "../utils/test-db";

let nestedCreateEffects = 0;

const sideEffectAccounts = collection("side_effect_accounts")
	.fields(({ f }) => ({ name: f.text().required() }))
	.access({ read: true, create: true })
	.hooks({
		beforeChange: () => {
			nestedCreateEffects += 1;
		},
	});

const guardedRelationDocuments = collection("guarded_relation_documents")
	.fields(({ f }) => ({
		owner: f
			.relation("sideEffectAccounts")
			.required()
			.access({ update: false }),
		title: f.text().required(),
	}))
	.access({ read: true, create: true, update: true });

describe("nested relation field access", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;
	const systemContext = createTestContext({ accessMode: "system" });
	const userContext = createTestContext({
		accessMode: "user",
		session: createMockSession({ id: crypto.randomUUID() }),
	});

	beforeEach(async () => {
		nestedCreateEffects = 0;
		setup = await buildMockApp({
			collections: { guardedRelationDocuments, sideEffectAccounts },
		});
		await runTestDbMigrations(setup.app);
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	it("denies fenced nested creation before target hooks can run", async () => {
		const owner = await setup.app.collections.sideEffectAccounts.create(
			{ name: "Owner" },
			systemContext,
		);
		const document =
			await setup.app.collections.guardedRelationDocuments.create(
				{ owner: owner.id, title: "Before" },
				systemContext,
			);
		nestedCreateEffects = 0;

		await expect(
			setup.app.collections.guardedRelationDocuments.updateById(
				{
					id: document.id,
					data: { owner: { create: { name: "Must not run" } } },
				},
				userContext,
			),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		expect(nestedCreateEffects).toBe(0);

		await expect(
			setup.app.collections.guardedRelationDocuments.updateById(
				{
					id: document.id,
					data: {
						owner: {
							connectOrCreate: {
								where: { name: "Missing" },
								create: { name: "Must not run either" },
							},
						},
					},
				},
				userContext,
			),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		expect(nestedCreateEffects).toBe(0);
	});

	it("allows an unchanged connect and denies a different target", async () => {
		const owner = await setup.app.collections.sideEffectAccounts.create(
			{ name: "Owner" },
			systemContext,
		);
		const foreignOwner = await setup.app.collections.sideEffectAccounts.create(
			{ name: "Foreign owner" },
			systemContext,
		);
		const document =
			await setup.app.collections.guardedRelationDocuments.create(
				{ owner: owner.id, title: "Before" },
				systemContext,
			);

		await expect(
			setup.app.collections.guardedRelationDocuments.updateById(
				{
					id: document.id,
					data: {
						owner: { connect: { id: owner.id } },
						title: "Same owner",
					},
				},
				userContext,
			),
		).resolves.toMatchObject({ owner: owner.id, title: "Same owner" });

		await expect(
			setup.app.collections.guardedRelationDocuments.updateById(
				{
					id: document.id,
					data: { owner: { connect: { id: foreignOwner.id } } },
				},
				userContext,
			),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		await expect(
			setup.app.collections.guardedRelationDocuments.findOne(
				{ where: { id: document.id } },
				systemContext,
			),
		).resolves.toMatchObject({ owner: owner.id });
	});
});
