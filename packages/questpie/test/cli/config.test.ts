import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadQuestpieConfig } from "../../src/cli/config.js";

const tmpDirs: string[] = [];

async function createTempProject(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "questpie-cli-config-"));
	tmpDirs.push(dir);
	return dir;
}

describe("loadQuestpieConfig", () => {
	afterEach(async () => {
		for (const dir of tmpDirs.splice(0)) {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("loads generated app next to a re-exported AppConfig file", async () => {
		const rootDir = await createTempProject();
		const serverDir = join(rootDir, "src", "questpie", "server");
		const generatedDir = join(serverDir, ".generated");

		await mkdir(generatedDir, { recursive: true });
		await writeFile(
			join(rootDir, "questpie.config.ts"),
			`export { default } from "./src/questpie/server/questpie.config";\n`,
			"utf-8",
		);
		await writeFile(
			join(serverDir, "questpie.config.ts"),
			`
				export default {
					app: { url: "http://localhost:3000" },
					db: { url: "postgres://example" },
					cli: { migrations: { directory: "./custom-migrations" } },
				};
			`,
			"utf-8",
		);
		await writeFile(
			join(generatedDir, "index.ts"),
			`
				export const app = {
					api: {},
					config: { source: "generated" },
				};
			`,
			"utf-8",
		);

		const config = await loadQuestpieConfig(
			join(rootDir, "questpie.config.ts"),
		);

		expect((config.app as any).config.source).toBe("generated");
		expect(config.cli?.migrations?.directory).toBe("./custom-migrations");
	});
});
