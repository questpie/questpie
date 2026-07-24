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
import { drizzle } from "drizzle-orm/pglite";

import { createHumanCrdtAuthentication } from "../../../src/server/modules/core/integrated/crdt/authority.js";
import { createCrdtTicketAuthorizationResolverV1 } from "../../../src/server/modules/core/integrated/crdt/authorization-resolver.js";
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

describe("CRDT ticket authorization resolver", () => {
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
	});

	afterEach(async () => {
		await client?.close();
	});

	it("materializes the complete canonical policy record but persists readable grants only", async () => {
		const records: Record<string, unknown>[] = [];
		const resolver = createCrdtTicketAuthorizationResolverV1({
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
			request: new Request("https://api.example.com/api/crdt/ticket"),
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
			audience: "https://api.example.com/api/crdt/socket",
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
		expect(snapshot.authorityExpiresAt).toEqual(
			new Date("2030-01-01T00:00:20.000Z"),
		);
		expect(snapshot.credentialFingerprint).toHaveLength(32);
		expect(await db.select().from(questpieCrdtSubjectTable)).toHaveLength(1);

		const redemption = await resolver({
			purpose: "redeem",
			request: new Request("https://api.example.com/api/crdt/socket"),
			authentication,
			resourceId: snapshot.resourceId,
			requestedMode: "edit",
			effectiveMode: "edit",
			origin: "https://admin.example.com",
			audience: "https://api.example.com/api/crdt/socket",
		});
		expect(redemption).toMatchObject({
			resourceId: snapshot.resourceId,
			subjectId: snapshot.subjectId,
			requestedMode: "edit",
			effectiveMode: "edit",
		});
		expect(redemption.credentialFingerprint).toEqual(
			snapshot.credentialFingerprint,
		);
	});
});

function humanAuthentication() {
	return createHumanCrdtAuthentication({
		kind: "user",
		user: { id: "user-1" } as never,
		session: {
			id: "session-1",
			expiresAt: new Date("2030-01-01T00:01:00.000Z"),
		} as never,
	});
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
