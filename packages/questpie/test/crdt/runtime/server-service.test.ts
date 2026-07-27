import { describe, expect, it } from "bun:test";

import { collection } from "../../../src/exports/index.js";
import { introspectCollection } from "../../../src/server/collection/introspection.js";
import {
	canonicalCrdtAuthoritySubjectKey,
	createCrdtServerOperations,
	orderCrdtAuthorityFencePlans,
} from "../../../src/server/modules/core/integrated/crdt/crdt-operations.js";
import { createDeterministicTextEngine } from "../../../src/server/modules/core/integrated/crdt/deterministic-engine.js";
import { createCrdtManifestDeclarations } from "../../../src/server/modules/core/integrated/crdt/manifest-runtime.js";
import { updateCrdtManifestArtifact } from "../../../src/server/modules/core/integrated/crdt/manifest.js";
import { createCrdtRegistry } from "../../../src/server/modules/core/integrated/crdt/registry.js";
import { drainCrdtProjection } from "../../../src/server/modules/core/integrated/crdt/server-service.js";
import crdtService from "../../../src/server/modules/core/services/crdt.js";
import { buildMockApp } from "../../utils/mocks/mock-app-builder.js";
import { createTestContext } from "../../utils/test-context.js";
import { runTestDbMigrations } from "../../utils/test-db.js";

describe("CRDT request-bound server service", () => {
	it("orders authority subjects and fence rows globally and deterministically", () => {
		const subjects = [
			{ kind: "human" as const, subjectId: "z" },
			{
				kind: "agent" as const,
				issuer: "https://issuer.example",
				subjectId: "a",
			},
			{ kind: "human" as const, subjectId: "a" },
		];
		expect(
			subjects
				.map((subject) => canonicalCrdtAuthoritySubjectKey(subject))
				.sort(),
		).toEqual([
			"agent\u0000https://issuer.example\u0000a",
			"human\u0000a",
			"human\u0000z",
		]);

		expect(
			orderCrdtAuthorityFencePlans([
				{
					resourceId: "resource-b",
					subjectId: "subject-a",
					scopeKind: 1,
					stableFieldId: "field-a",
					capability: "edit",
				},
				{
					resourceId: "resource-a",
					subjectId: "subject-z",
					scopeKind: 2,
					stableFieldId: "field-z",
					capability: "read",
				},
				{
					resourceId: "resource-a",
					subjectId: "subject-a",
					scopeKind: 2,
					stableFieldId: "field-b",
					capability: "edit",
				},
			]).map(({ resourceId, subjectId, stableFieldId }) => [
				resourceId,
				subjectId,
				stableFieldId,
			]),
		).toEqual([
			["resource-a", "subject-a", "field-b"],
			["resource-a", "subject-z", "field-z"],
			["resource-b", "subject-a", "field-a"],
		]);
	});

	it("keeps ordinary context creation safe when CRDT is unavailable", async () => {
		const create = crdtService.state.create!;
		const crdt = create({
			app: {},
			accessMode: "user",
			services: {},
		} as never) as any;
		expect(crdt.collections).toEqual({});
		await expect(
			crdt.withAuthorityMutation([], async () => {}),
		).rejects.toThrow("runtime is unavailable");
	});

	it("creates and introspects a non-CRDT app without an uninitialized singleton", async () => {
		const plain = collection("plain").fields(({ f }) => ({
			title: f.text(),
		}));
		const setup = await buildMockApp({ collections: { plain } });
		try {
			await runTestDbMigrations(setup.app);
			const context = await setup.app.createContext({
				accessMode: "system",
			});
			const schema = await introspectCollection(
				plain as never,
				context as never,
				setup.app,
			);
			expect(schema.name).toBe("plain");
			expect(setup.app.crdtOperations.available).toBeFalse();
		} finally {
			await setup.cleanup();
		}
	});

	it("awaits and deduplicates configured engine shutdown during app destroy", async () => {
		const plain = collection("plain").fields(({ f }) => ({
			title: f.text(),
		}));
		let disposals = 0;
		let markDisposeStarted!: () => void;
		const disposeStarted = new Promise<void>((resolve) => {
			markDisposeStarted = resolve;
		});
		let releaseDispose!: () => void;
		const disposed = new Promise<void>((resolve) => {
			releaseDispose = resolve;
		});
		const setup = await buildMockApp(
			{ collections: { plain } },
			{
				crdt: {
					namespace: "test",
					engines: {
						text: {
							async dispose() {
								disposals++;
								markDisposeStarted();
								await disposed;
							},
						} as never,
					},
				},
			},
		);
		try {
			const destroying = setup.app.destroy();
			await disposeStarted;
			expect(disposals).toBe(1);

			let destroyed = false;
			void destroying.then(() => {
				destroyed = true;
			});
			await Promise.resolve();
			expect(destroyed).toBeFalse();

			releaseDispose();
			await destroying;
			await setup.app.destroy();
			expect(disposals).toBe(1);
		} finally {
			releaseDispose();
			await setup.cleanup();
		}
	});

	it("supplies fresh transaction-bound authorization to field replace", async () => {
		const commitTransaction = {};
		const authorizedDatabases: unknown[] = [];
		const db = queuedSelectDatabase([
			[
				{
					id: "00000000-0000-4000-8000-000000000501",
					status: 1,
					currentEpochId: "00000000-0000-4000-8000-000000000502",
				},
			],
			[
				{
					stableFieldId: "00000000-0000-4000-8000-000000000503",
				},
			],
		]);
		const crdt = createCrdtServerOperations({
			db: db as never,
			owners: {
				collections: {
					articles: {
						ownerName: "articles",
						fields: { title: {} },
					},
				},
				globals: {},
			},
			replace: {
				async replaceField(_input, authorization) {
					await authorization.authorizeCommit(commitTransaction as never);
					throw new Error("stop after commit authorization");
				},
				async replaceAggregate() {},
			},
			authorize: async (_owner, database) => {
				authorizedDatabases.push(database);
				return {
					ownerRead: true,
					ownerEdit: true,
					fields: { title: { read: true, edit: true } },
				};
			},
		});
		const document = crdt.collections.articles.document({ id: "article-1" });

		await expect(
			document.fields.title.replace({
				value: "replacement",
				expected: { fieldEpoch: "1", canonicalRevision: "1" },
				reason: "agent",
			}),
		).rejects.toThrow("stop after commit authorization");
		expect(authorizedDatabases).toEqual([db, commitTransaction]);
	});

	it("creates and resolves text anchors from an authorized server document", async () => {
		const anchorArticles = collection("anchor_articles")
			.fields(({ f }) => ({
				title: f.text().required(),
				body: f.textarea().default("").required().crdt({ format: "text" }),
			}))
			.collaborative();
		const textEngine = createDeterministicTextEngine();
		const crdtConfig = {
			namespace: "server-anchor-test",
			engines: { text: textEngine },
		};
		const registry = createCrdtRegistry({
			collections: { anchorArticles: anchorArticles.build() },
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
		const setup = await buildMockApp(
			{ collections: { anchorArticles }, crdtManifest: manifest },
			{ crdt: crdtConfig, secret: "s".repeat(32) },
		);
		try {
			await runTestDbMigrations(setup.app);
			const article = await setup.app.collections.anchorArticles.create(
				{ title: "Draft", body: "Body" },
				createTestContext({ accessMode: "system" }),
			);
			let authorizations = 0;
			let readable = true;
			const crdt = setup.app.crdtOperations.createRequestOperations({
				authorize: async () => {
					authorizations++;
					return {
						ownerRead: readable,
						ownerEdit: false,
						fields: { body: { read: readable, edit: false } },
					};
				},
			});
			const anchors = crdt.collections.anchorArticles.document({
				id: article.id,
			}).fields.body.anchors;

			const token = await anchors.create({ kind: "point", offset: 2 });

			expect(await anchors.resolve(token)).toEqual({
				status: "resolved",
				kind: "point",
				offset: 2,
			});
			readable = false;
			await expect(anchors.resolve(token)).rejects.toThrow(
				"CRDT authority denied",
			);
			expect(authorizations).toBe(3);
		} finally {
			await setup.cleanup();
		}
	});

	it("supplies fresh transaction-bound authorization for the whole aggregate", async () => {
		const commitTransaction = {};
		const authorizedDatabases: unknown[] = [];
		const db = queuedSelectDatabase([
			[
				{
					id: "00000000-0000-4000-8000-000000000511",
					status: 1,
					currentEpochId: "00000000-0000-4000-8000-000000000512",
				},
			],
		]);
		const crdt = createCrdtServerOperations({
			db: db as never,
			owners: {
				collections: {
					articles: {
						ownerName: "articles",
						fields: { title: {} },
					},
				},
				globals: {},
			},
			replace: {
				async replaceField() {},
				async replaceAggregate(_input, authorization) {
					await authorization.authorizeCommit(commitTransaction as never);
					throw new Error("stop after aggregate commit authorization");
				},
			},
			authorize: async (_owner, database) => {
				authorizedDatabases.push(database);
				return {
					ownerRead: true,
					ownerEdit: true,
					fields: { title: { read: true, edit: true } },
				};
			},
		});

		await expect(
			crdt.collections.articles.document({ id: "article-1" }).replace({
				fields: { title: "replacement" },
				expected: {
					aggregateEpoch: "1",
					canonicalRevisions: { title: "1" },
				},
				reason: "agent",
			}),
		).rejects.toThrow("stop after aggregate commit authorization");
		expect(authorizedDatabases).toEqual([
			db,
			db,
			commitTransaction,
			commitTransaction,
		]);
	});

	it("drains an existing projection backlog without another notice", async () => {
		let remaining = 3;
		let calls = 0;
		const result = await drainCrdtProjection(
			{
				async runOnce() {
					calls++;
					if (remaining === 0) return null;
					remaining--;
					return { status: "applied" };
				},
			},
			new AbortController().signal,
		);
		expect(calls).toBe(4);
		expect(result.nextDueAt).toBeNull();
	});

	it("rejects forged authority targets before opening a transaction", async () => {
		const crdt = createCrdtServerOperations({
			db: {
				transaction() {
					throw new Error("transaction must not start");
				},
			} as never,
			owners: { collections: {}, globals: {} },
			replace: {
				async replaceField() {},
				async replaceAggregate() {},
			},
			authorize: async () => ({
				ownerRead: true,
				ownerEdit: true,
				fields: {},
			}),
		});

		await expect(
			crdt.withAuthorityMutation([{} as never], async () => {}),
		).rejects.toThrow("authority target is invalid");
	});
});

function queuedSelectDatabase(results: unknown[][]) {
	const database = {
		select() {
			const chain = {
				from() {
					return chain;
				},
				innerJoin() {
					return chain;
				},
				where() {
					return Promise.resolve(results.shift() ?? []);
				},
			};
			return chain;
		},
	};
	return database;
}

function uuidSequence() {
	let value = 0;
	return {
		next: () =>
			`00000000-0000-4000-8000-${(++value).toString(16).padStart(12, "0")}`,
	};
}
