import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from "bun:test";

import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { pgTable, text } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";

import type { Principal } from "../../../src/server/config/context.js";
import { createHumanCrdtAuthentication } from "../../../src/server/modules/core/integrated/crdt/authority.js";
import { createCrdtAuthorizationResolverV1 } from "../../../src/server/modules/core/integrated/crdt/authorization-resolver.js";
import { createDeterministicTextEngine } from "../../../src/server/modules/core/integrated/crdt/deterministic-engine.js";
import {
	resolveCrdtDesiredManifest,
	updateCrdtManifestArtifact,
} from "../../../src/server/modules/core/integrated/crdt/manifest.js";
import {
	canonicalCrdtCollectionLocator,
	CrdtOwnerLifecycleTransaction,
	stageCrdtOwnerActivation,
} from "../../../src/server/modules/core/integrated/crdt/owner-lifecycle.js";
import {
	questpieCrdtSubjectTable,
	questpieCrdtTables,
} from "../../../src/server/modules/core/integrated/crdt/schema.js";

const RESOURCE_ID = "00000000-0000-4000-8000-000000000801";
const articlesTable = pgTable("articles", {
	id: text("id").primaryKey(),
	title: text("title").notNull(),
	content: text("content").notNull(),
});
const textEngine = createDeterministicTextEngine();
const declaration = {
	owner: { kind: 1 as const, key: "articles", identityVersion: 1 },
	fields: {
		title: contract(textEngine),
		content: contract(textEngine),
	},
};
const manifest = resolveCrdtDesiredManifest(
	updateCrdtManifestArtifact({
		namespace: "acme-cms",
		declarations: [declaration],
		createStableFieldId: uuidSequence().next,
	}),
	declaration,
);

describe("CRDT authorization resolver", () => {
	let ddl: string[];
	let client: PGlite;
	let db: ReturnType<typeof drizzle<typeof questpieCrdtTables>>;

	beforeAll(async () => {
		const { generateDrizzleJson, generateMigration } =
			await import("drizzle-kit/api-postgres");
		const empty = {
			id: "00000000-0000-0000-0000-000000000000",
			dialect: "postgres" as const,
			prevIds: [],
			version: "8" as const,
			ddl: [],
			renames: [],
		};
		ddl = await generateMigration(
			empty,
			await generateDrizzleJson(questpieCrdtTables, empty.id),
		);
	});

	beforeEach(async () => {
		client = await PGlite.create();
		db = drizzle(client, { schema: questpieCrdtTables });
		for (const statement of ddl) {
			if (statement.trim()) await db.execute(sql.raw(statement));
		}
		const staged = await stageCrdtOwnerActivation({
			manifest,
			resourceId: RESOURCE_ID,
			values: { title: "Canonical title", content: "Secret policy input" },
			textEngine,
		});
		await db.transaction((tx) =>
			new CrdtOwnerLifecycleTransaction(tx).activate({
				staged,
				owner: {
					locator: canonicalCrdtCollectionLocator("article-1"),
					values: {
						title: "Canonical title",
						content: "Secret policy input",
					},
				},
				mode: "create",
			}),
		);
		await db.execute(sql`
			CREATE TABLE articles (
				id text PRIMARY KEY,
				title text NOT NULL,
				content text NOT NULL
			)
		`);
		await db.insert(articlesTable).values({
			id: "article-1",
			title: "projection-lagged title",
			content: "projection-lagged secret",
		});
	});

	afterEach(async () => {
		await client?.close();
	});

	it("materializes the complete canonical policy record but persists readable grants only", async () => {
		const records: Record<string, unknown>[] = [];
		const resolver = createCrdtAuthorizationResolverV1({
			db,
			namespace: "acme-cms",
			manifests: { collections: { articles: manifest }, globals: {} },
			engines: { text: textEngine },
			loadOwnerRecord: async () => ({
				id: "article-1",
				title: "projection-lagged title",
				content: "projection-lagged secret",
			}),
			authorizePolicy: async ({ record }) => {
				records.push(record);
				return {
					ownerRead: record.content === "Secret policy input",
					ownerEdit: true,
					fields: {
						title: { read: true, edit: true },
						content: { read: false, edit: false },
					},
				};
			},
			now: () => new Date("2029-12-31T23:59:50.000Z"),
		});
		const authentication = humanAuthentication();

		const snapshot = await resolver({
			purpose: "issue",
			request: new Request("https://api.example.com/realtime/crdt/open"),
			authentication,
			target: {
				namespace: "acme-cms",
				owner: {
					kind: "collection",
					key: "articles",
					id: "article-1",
				},
				mode: "edit",
			},
			origin: "https://admin.example.com",
			audience: "https://api.example.com",
		});

		expect(records).toEqual([
			{
				id: "article-1",
				title: "Canonical title",
				content: "Secret policy input",
			},
		]);
		expect(snapshot.bindings).toHaveLength(2);
		expect(snapshot.grants).toHaveLength(1);
		expect(snapshot.grants[0]).toMatchObject({
			stableFieldId: manifest.fields.find(
				(field) => field.sourcePath === "title",
			)!.stableFieldId,
			grant: "edit",
		});
		expect(snapshot.requestedMode).toBe("edit");
		expect(snapshot.effectiveMode).toBe("edit");
		expect(snapshot.offlineSubjectKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(snapshot.clientManifest).toEqual({
			schemaVersion: manifest.version,
			schemaFingerprint: Buffer.from(manifest.fingerprint).toString(
				"base64url",
			),
			awarenessEnabled: false,
			fields: {
				title: {
					fieldSlot: manifest.fields.find(
						(field) => field.sourcePath === "title",
					)!.fieldSlot,
					format: "text",
					formatVersion: textEngine.formatVersion,
					engineId: textEngine.engineId,
					grant: "edit",
				},
			},
		});
		expect(snapshot.authorityExpiresAt).toEqual(
			new Date("2030-01-01T00:01:00.000Z"),
		);
		expect(snapshot.credentialFingerprint).toHaveLength(32);
		expect(await db.select().from(questpieCrdtSubjectTable)).toHaveLength(1);

		const exchange = await resolver({
			purpose: "exchange",
			request: new Request("https://api.example.com/realtime/crdt/exchange"),
			authentication,
			resourceId: snapshot.resourceId,
			requestedMode: "edit",
			effectiveMode: "edit",
			origin: "https://admin.example.com",
			audience: "https://api.example.com",
		});
		expect(exchange).toMatchObject({
			resourceId: snapshot.resourceId,
			subjectId: snapshot.subjectId,
			requestedMode: "edit",
			effectiveMode: "edit",
		});
		expect(exchange.credentialFingerprint).toEqual(
			snapshot.credentialFingerprint,
		);
		expect(exchange.offlineSubjectKey).toBe(snapshot.offlineSubjectKey);
	});

	it("intersects OAuth collection scopes with the normal owner policy", async () => {
		const resolver = createCrdtAuthorizationResolverV1({
			db,
			namespace: "acme-cms",
			manifests: { collections: { articles: manifest }, globals: {} },
			engines: { text: textEngine },
			loadOwnerRecord: async () => ({
				id: "article-1",
				title: "Canonical title",
				content: "Secret policy input",
			}),
			authorizePolicy: async () => ({
				ownerRead: true,
				ownerEdit: true,
				fields: {
					title: { read: true, edit: true },
					content: { read: true, edit: true },
				},
			}),
			now: () => new Date("2029-12-31T23:59:50.000Z"),
		});
		const issue = (scopes: string[]) =>
			resolver({
				purpose: "issue",
				request: new Request("https://api.example.com/realtime/crdt/open"),
				authentication: createHumanCrdtAuthentication({
					kind: "oauth",
					user: { id: "user-1" },
					clientId: "client-1",
					tokenId: `token-${scopes.length}`,
					scopes,
				} as any),
				target: {
					namespace: "acme-cms",
					owner: {
						kind: "collection",
						key: "articles",
						id: "article-1",
					},
					mode: "edit",
				},
				origin: null,
				audience: "https://api.example.com",
			});

		await expect(issue(["collections:articles:write"])).rejects.toThrowError(
			"CRDT authorization rejected",
		);
		await expect(
			issue(["collections:articles:read", "collections:articles:write"]),
		).resolves.toMatchObject({
			effectiveMode: "edit",
			authorityExpiresAt: new Date("2030-01-01T00:01:20.000Z"),
		});
	});
});

function humanAuthentication() {
	return createHumanCrdtAuthentication(humanPrincipal());
}

function humanPrincipal(): Extract<Principal, { kind: "user" }> {
	return {
		kind: "user",
		user: { id: "user-1" } as never,
		session: {
			id: "session-1",
			expiresAt: new Date("2030-01-01T00:01:00.000Z"),
		} as never,
	};
}

function contract(engine: typeof textEngine) {
	return {
		format: "text" as const,
		formatVersion: engine.formatVersion,
		engineId: engine.engineId,
		engineVersion: engine.engineVersion,
		codecFingerprint: engine.codecFingerprint,
	};
}

function uuidSequence() {
	let counter = 0x900;
	return {
		next: () =>
			`00000000-0000-4000-8000-${(++counter).toString(16).padStart(12, "0")}`,
	};
}
