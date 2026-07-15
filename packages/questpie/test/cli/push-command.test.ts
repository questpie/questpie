import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	setDefaultTimeout,
	spyOn,
} from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sql } from "drizzle-orm";

import { pushCommand } from "../../src/cli/commands/push.js";
import { collection } from "../../src/exports/index.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder.js";

setDefaultTimeout(30_000);

const articles = collection("articles").fields(({ f }) => ({
	title: f.text(255).required(),
}));

describe("pushCommand", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;
	let tempDir: string;

	beforeEach(async () => {
		setup = await buildMockApp({ collections: { articles } });
		await setup.app.db.execute(
			sql.raw("CREATE EXTENSION IF NOT EXISTS pg_trgm"),
		);

		tempDir = await mkdtemp(join(tmpdir(), "questpie-push-command-"));
		(globalThis as Record<string, unknown>).questpiePushTestApp = setup.app;
		await writeFile(
			join(tempDir, "questpie.config.ts"),
			"export default { app: globalThis.questpiePushTestApp };\n",
			"utf8",
		);
	});

	afterEach(async () => {
		delete (globalThis as Record<string, unknown>).questpiePushTestApp;
		await setup.cleanup();
		await rm(tempDir, { recursive: true, force: true });
	});

	it("destroys the app after successful and already-up-to-date pushes", async () => {
		const destroy = spyOn(setup.app, "destroy").mockResolvedValue(undefined);
		const log = spyOn(console, "log").mockImplementation(() => {});
		const options = {
			configPath: join(tempDir, "questpie.config.ts"),
			force: true,
		};

		await pushCommand(options);
		expect(destroy).toHaveBeenCalledTimes(1);

		await pushCommand(options);
		expect(destroy).toHaveBeenCalledTimes(2);
		expect(log).toHaveBeenCalledWith(
			expect.stringContaining("Never run it against production"),
		);

		log.mockRestore();
		destroy.mockRestore();
	});

	it("destroys the app when push fails after loading the config", async () => {
		const destroy = spyOn(setup.app, "destroy").mockResolvedValue(undefined);
		const getSchema = spyOn(setup.app, "getSchema").mockImplementation(() => {
			throw new Error("schema introspection failed");
		});
		const log = spyOn(console, "log").mockImplementation(() => {});

		await expect(
			pushCommand({
				configPath: join(tempDir, "questpie.config.ts"),
				force: true,
			}),
		).rejects.toThrow("schema introspection failed");
		expect(destroy).toHaveBeenCalledTimes(1);

		log.mockRestore();
		getSchema.mockRestore();
		destroy.mockRestore();
	});
});
