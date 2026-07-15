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

import { runMigrationCommand } from "../../src/cli/commands/run.js";
import type { Migration } from "../../src/server/migration/types.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder.js";

setDefaultTimeout(30_000);

const migration: Migration = {
	id: "test_migration",
	async up() {},
	async down() {},
};

describe("runMigrationCommand", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;
	let tempDir: string;
	let configPath: string;

	beforeEach(async () => {
		setup = await buildMockApp({});
		tempDir = await mkdtemp(join(tmpdir(), "questpie-migrate-command-"));
		configPath = join(tempDir, "questpie.config.ts");
		(globalThis as Record<string, unknown>).questpieMigrateTestApp = setup.app;
		await writeFile(
			configPath,
			"export default { app: globalThis.questpieMigrateTestApp };\n",
			"utf8",
		);
	});

	afterEach(async () => {
		delete (globalThis as Record<string, unknown>).questpieMigrateTestApp;
		await setup.cleanup();
		await rm(tempDir, { recursive: true, force: true });
	});

	it("destroys the app for empty, dry-run, and successful migrations", async () => {
		const destroy = spyOn(setup.app, "destroy").mockResolvedValue(undefined);
		const up = spyOn(setup.app.migrations, "up").mockResolvedValue(undefined);
		const log = spyOn(console, "log").mockImplementation(() => {});

		await runMigrationCommand({ action: "up", configPath });
		expect(destroy).toHaveBeenCalledTimes(1);
		expect(up).not.toHaveBeenCalled();

		setup.app.config.migrations = [migration];
		await runMigrationCommand({ action: "up", configPath, dryRun: true });
		expect(destroy).toHaveBeenCalledTimes(2);
		expect(up).not.toHaveBeenCalled();

		await runMigrationCommand({ action: "up", configPath });
		expect(destroy).toHaveBeenCalledTimes(3);
		expect(up).toHaveBeenCalledTimes(1);

		log.mockRestore();
		up.mockRestore();
		destroy.mockRestore();
	});

	it("destroys the app when a migration fails", async () => {
		setup.app.config.migrations = [migration];
		const destroy = spyOn(setup.app, "destroy").mockResolvedValue(undefined);
		const up = spyOn(setup.app.migrations, "up").mockRejectedValue(
			new Error("migration failed"),
		);
		const log = spyOn(console, "log").mockImplementation(() => {});

		await expect(
			runMigrationCommand({ action: "up", configPath }),
		).rejects.toThrow("migration failed");
		expect(destroy).toHaveBeenCalledTimes(1);

		log.mockRestore();
		up.mockRestore();
		destroy.mockRestore();
	});
});
