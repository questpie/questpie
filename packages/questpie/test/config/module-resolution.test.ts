import { describe, expect, it } from "bun:test";

import { z } from "zod";

import { createApp } from "../../src/server/config/create-app.js";
import type {
	AppModuleInput,
	RuntimeConfig,
} from "../../src/server/config/module-types.js";
import type { MailerService } from "../../src/server/modules/core/integrated/mailer/service.js";
import { MockKVAdapter } from "../utils/mocks/kv.adapter.js";
import { MockLogger } from "../utils/mocks/logger.adapter.js";
import { MockMailAdapter } from "../utils/mocks/mailer.adapter.js";
import { MockQueueAdapter } from "../utils/mocks/queue.adapter.js";
import { createTestDb } from "../utils/test-db.js";

const testRuntime = (db: Awaited<ReturnType<typeof createTestDb>>) =>
	({
		app: { url: "http://localhost:3000" },
		db: { pglite: db },
		email: { adapter: new MockMailAdapter() },
		queue: { adapter: new MockQueueAdapter() },
		kv: { adapter: new MockKVAdapter() },
		logger: { adapter: new MockLogger() },
	}) as unknown as RuntimeConfig;

describe("createApp — module resolution order", () => {
	/**
	 * The diamond. `shared` is reached twice, once under each dependent.
	 * Keeping the last occurrence put it AFTER both dependents, so a dependent
	 * that extends a shared collection lost to the plain version it extended.
	 * `mergeOrder` is an unknown extension key, so it concatenates and reads
	 * back as the literal merge order.
	 */
	it("merges a shared dependency once, ahead of both dependents", async () => {
		const shared = { name: "shared", mergeOrder: ["shared"] } as AppModuleInput;
		const left = {
			name: "left",
			modules: [shared],
			mergeOrder: ["left"],
		} as AppModuleInput;
		const right = {
			name: "right",
			modules: [shared],
			mergeOrder: ["right"],
		} as AppModuleInput;

		const db = await createTestDb();
		try {
			const app = await createApp({ modules: [left, right] }, testRuntime(db));
			try {
				expect((app.state as Record<string, unknown>).mergeOrder).toEqual([
					"shared",
					"left",
					"right",
				]);
			} finally {
				await app.destroy();
			}
		} finally {
			await db.close();
		}
	});

	it("rejects two different modules sharing one name, naming both positions", async () => {
		// The live instance of this is the admin server module and the admin
		// client module, both called "questpie-admin". Separate arrays today, so
		// nothing breaks yet. In one array, one of them used to just disappear.
		const serverAdmin = { name: "questpie-admin" } as AppModuleInput;
		const clientAdmin = { name: "questpie-admin" } as AppModuleInput;

		// Throws in resolveModules, before anything touches the database.
		const boot = createApp(
			{ modules: [serverAdmin, clientAdmin] },
			{} as RuntimeConfig,
		);

		await expect(boot).rejects.toThrow(
			/both named "questpie-admin", at positions 1 and 2/,
		);
	});

	it("accepts the same module object listed twice", async () => {
		const shared = { name: "shared" } as AppModuleInput;
		const dependent = {
			name: "dependent",
			modules: [shared],
		} as AppModuleInput;

		const db = await createTestDb();
		try {
			// An app listing a module it also gets transitively. Common, and there
			// is nothing the app author could do about the nested copy anyway.
			const app = await createApp(
				{ modules: [dependent, shared] },
				testRuntime(db),
			);
			await app.destroy();
		} finally {
			await db.close();
		}
	});
});

describe("createApp — email templates", () => {
	const welcome = {
		name: "welcome",
		schema: z.object({ who: z.string() }),
		handler: ({ input }: { input: { who: string } }) => ({
			subject: `Hello ${input.who}`,
			html: "<p>hi</p>",
		}),
	};

	it("carries a module's email templates through to the mailer", async () => {
		// create-app used to read emailTemplates off the root definition only, so
		// a package that ships an emails/ directory reached nothing.
		const mailModule = {
			name: "mail-module",
			emailTemplates: { welcome },
		} as AppModuleInput;

		const db = await createTestDb();
		try {
			const app = await createApp({ modules: [mailModule] }, testRuntime(db));
			try {
				expect(app.config.email?.templates).toHaveProperty("welcome");

				const mailer = app.resolveService("email") as MailerService<any>;
				const rendered = await mailer.renderTemplate({
					template: "welcome",
					input: { who: "world" },
				});
				expect(rendered.subject).toBe("Hello world");
			} finally {
				await app.destroy();
			}
		} finally {
			await db.close();
		}
	});

	it("still carries the app's own email templates", async () => {
		const db = await createTestDb();
		try {
			// Root entities ride in the synthetic __user module, so they arrive
			// through the same merge.
			const app = await createApp(
				{ modules: [], emailTemplates: { welcome } },
				testRuntime(db),
			);
			try {
				expect(app.config.email?.templates).toHaveProperty("welcome");
			} finally {
				await app.destroy();
			}
		} finally {
			await db.close();
		}
	});
});
