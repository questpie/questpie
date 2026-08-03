/**
 * A module's emails/ directory has to reach the mailer.
 *
 * Two halves used to disagree. The module template emitted the raw category
 * name `emails`, and create-app read `emailTemplates` off the root definition
 * only. Either half alone looks right in its own unit test, so this one runs
 * the whole path: write an emails/ file, generate the module, import what was
 * generated, hand it to createApp and render the template.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { runCodegen } from "../../src/cli/codegen/index.js";
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

const EMAIL_FILE = `import { email } from "questpie/services";
import { z } from "zod";

export default email({
	name: "welcome",
	schema: z.object({ who: z.string() }),
	handler: ({ input }) => ({
		subject: \`Hello \${input.who}\`,
		html: "<p>hi</p>",
	}),
});
`;

// The temp module lives inside the package so "questpie/services" resolves the
// same way it does for a real package module. `tmp/` is gitignored, so a run
// that dies before afterAll leaves nothing to commit.
const TMP_PARENT = join(import.meta.dir, "tmp");

describe("a module's emails/ directory reaches the app", () => {
	let moduleRoot: string;
	let generatedCode: string;

	beforeAll(async () => {
		await mkdir(TMP_PARENT, { recursive: true });
		moduleRoot = await mkdtemp(join(TMP_PARENT, "mail-probe-"));
		await mkdir(join(moduleRoot, "emails"), { recursive: true });
		await writeFile(join(moduleRoot, "emails", "welcome.ts"), EMAIL_FILE);

		const result = await runCodegen({
			rootDir: moduleRoot,
			configPath: join(moduleRoot, "questpie.config.ts"),
			outDir: join(moduleRoot, ".generated"),
			plugins: [],
			module: { name: "mail-probe" },
		});
		generatedCode = result.code;
	});

	afterAll(async () => {
		await rm(TMP_PARENT, { recursive: true, force: true });
	});

	it("emits the key create-app reads, not the category name", () => {
		expect(generatedCode).toContain("emailTemplates: {");
		expect(generatedCode).toContain("welcome: _email_welcome");
		expect(generatedCode).not.toContain("\temails:");
	});

	it("renders the template through the app's mailer", async () => {
		const generated = await import(
			pathToFileURL(join(moduleRoot, ".generated", "module.ts")).href
		);
		const mailModule = generated.default as AppModuleInput;
		expect(mailModule.name).toBe("mail-probe");

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
});
