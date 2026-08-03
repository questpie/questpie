import { describe, expect, it } from "bun:test";

import { sql } from "drizzle-orm";
import { collection, getContext, type Questpie } from "questpie";
import { createApp } from "questpie/app";
import { migration } from "questpie/migration";
import type {
	AppDefinition,
	QuestpieConfig,
	RuntimeConfig,
} from "questpie/types";

import { createTestApp, type GeneratedAppFactory } from "../src/index.js";

type AppSession = {
	user: {
		id: string;
		email: string;
		name: string;
		role: "editor" | "viewer";
		tenantId: string;
		emailVerified: boolean;
		createdAt: Date;
		updatedAt: Date;
	};
	session: {
		id: string;
		userId: string;
		token: string;
		expiresAt: Date;
		createdAt: Date;
		updatedAt: Date;
	};
};

const documents = collection("testing_actor_documents")
	.fields(({ f }) => ({
		title: f.text().required(),
		secret: f.text().access({ read: false }),
	}))
	.options({ timestamps: false })
	.access({
		read: true,
		create: false,
	});

const schemaMigration = migration({
	id: "testing_actors_001",
	async up({ db }) {
		await db.execute(sql`
			CREATE TABLE testing_actor_documents (
				id uuid PRIMARY KEY,
				title text NOT NULL,
				secret text
			)
		`);
	},
	async down({ db }) {
		await db.execute(sql`DROP TABLE testing_actor_documents`);
	},
});

const definition = {
	modules: [],
	collections: { testing_actor_documents: documents },
	migrations: [schemaMigration],
} satisfies AppDefinition;

type ActorApp = Questpie<
	QuestpieConfig & {
		collections: { testing_actor_documents: typeof documents };
	}
>;
const createActorApp = async (runtime: RuntimeConfig): Promise<ActorApp> =>
	(await createApp(definition, runtime)) as unknown as ActorApp;
const createAppForRuntime: GeneratedAppFactory<ActorApp, AppSession> =
	createActorApp;

const editorSeed = {
	id: "editor-1",
	email: "editor@example.test",
	name: "Editor",
	role: "editor",
	tenantId: "tenant-1",
} as const;

const viewerSeed = {
	id: "viewer-1",
	email: "viewer@example.test",
	name: "Viewer",
	role: "viewer",
	tenantId: "tenant-1",
} as const;

describe("typed test actors", () => {
	it("keeps anonymous, user, OAuth, and system authority explicit", async () => {
		const testApp = await createTestApp({ createApp: createAppForRuntime });

		try {
			const anonymous = testApp.anonymous();
			const editor = testApp.actor({ user: editorSeed });
			const session = await editor.run(({ context }) => context.session);
			const oauth = testApp.oauth({
				session,
				clientId: "test-client",
				scopes: ["collections:testing_actor_documents:read"],
				tokenId: "token-1",
			});
			const system = testApp.system();

			expect(anonymous.kind).toBe("anonymous");
			expect(editor.kind).toBe("user");
			expect(oauth.kind).toBe("oauth");
			expect(system.kind).toBe("system");

			await anonymous.run(({ context }) => {
				expect(context.accessMode).toBe("user");
				expect(context.session).toBeNull();
			});
			await editor.run(({ context }) => {
				expect(context.accessMode).toBe("user");
				expect(context.session?.user.id).toBe("editor-1");
				expect(context.session?.user.emailVerified).toBe(true);
			});
			await oauth.run(({ context }) => {
				expect(context.accessMode).toBe("user");
				expect(context.principal).toEqual({
					kind: "oauth",
					user: session?.user,
					clientId: "test-client",
					scopes: ["collections:testing_actor_documents:read"],
					tokenId: "token-1",
				});
			});
			await system.run(({ context }) => {
				expect(context.accessMode).toBe("system");
				expect(context.principal).toEqual({ kind: "system" });
			});
		} finally {
			await testApp.dispose();
		}
	});

	it("runs exact app operations in production ALS and enforces access", async () => {
		const testApp = await createTestApp({ createApp: createAppForRuntime });
		const editor = testApp.actor({ user: editorSeed });
		const viewer = testApp.actor({ user: viewerSeed });
		const anonymous = testApp.anonymous();

		try {
			const createdId = crypto.randomUUID();
			await testApp.app.db.execute(sql`
				INSERT INTO testing_actor_documents (id, title, secret)
				VALUES (${createdId}, 'Typed actors', 'server-only')
			`);
			await editor.run(({ context }) => {
				expect(getContext<ActorApp>().session).toBe(context.session);
			});

			await expect(
				viewer.run(({ app, context }) =>
					app.collections.testing_actor_documents.create(
						{ id: crypto.randomUUID(), title: "Denied" },
						context,
					),
				),
			).rejects.toThrow();

			await expect(
				anonymous.run(({ app, context }) =>
					app.collections.testing_actor_documents.create(
						{ id: crypto.randomUUID(), title: "Denied" },
						context,
					),
				),
			).rejects.toThrow();

			const unrestricted = await testApp
				.system()
				.run(({ app, context }) =>
					app.collections.testing_actor_documents.find({}, context),
				);
			expect(unrestricted.docs[0]?.secret).toBe("server-only");

			const visible = await viewer.run(({ app, context }) =>
				app.collections.testing_actor_documents.findOne(
					{ where: { id: createdId } },
					context,
				),
			);
			expect(visible?.title).toBe("Typed actors");
			expect(visible).not.toHaveProperty("secret");
		} finally {
			await testApp.dispose();
		}
	});
});
