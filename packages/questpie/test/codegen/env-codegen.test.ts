/**
 * Tests: env primitive codegen integration.
 *
 * Covers:
 * 1. `generateTemplate` — env import emitted BEFORE the runtime config import
 * 2. `export const env`, `env:` in the createApp definition, app-type wiring
 * 3. No env.ts → generated output contains no env artifacts (unchanged)
 * 4. `runCodegen` — emits `.generated/env.client.<consumer>.ts` per consumer
 *    with LITERAL prefixed references (bundler-inlinable), server keys absent
 * 5. Regex fallback when env.client.ts cannot be imported
 */
import { afterAll, describe, expect, it } from "bun:test";
import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	unlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	coreCodegenPlugin,
	resolveTargetGraph,
	runCodegen,
} from "../../src/cli/codegen/index.js";
import { generateTemplate as _generateTemplate } from "../../src/cli/codegen/template.js";
import type {
	CategoryDeclaration,
	DiscoveredFile,
	DiscoveryResult,
} from "../../src/cli/codegen/types.js";

// Step-6 multi-file split: generateTemplate returns `{ code, extraFiles }`.
// Concatenate index.ts + layer files so the env-ordering assertions see the
// full emitted surface (env import lives in index.ts/layer preambles).
function generateTemplate(
	opts: Parameters<typeof _generateTemplate>[0],
): string {
	const { code, extraFiles } = _generateTemplate(opts);
	return [code, ...extraFiles.map((f) => f.code)].join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers (same fabricated-DiscoveryResult style as template.test.ts)
// ─────────────────────────────────────────────────────────────────────────────

function coreCategories(): Record<string, CategoryDeclaration> {
	const graph = resolveTargetGraph([coreCodegenPlugin()]);
	return graph.get("server")!.categories;
}

function makeSingle(key: string, importPath: string): DiscoveredFile {
	return {
		absolutePath: `/root/${importPath.replace("../", "")}.ts`,
		key,
		varName: `_${key}`,
		importPath,
		source: `${importPath.replace("../", "")}.ts`,
		exportType: "default",
	};
}

function minimalResult(
	withEnv: boolean,
	withEnvClient = false,
): DiscoveryResult {
	const categories = new Map<string, Map<string, DiscoveredFile>>();
	for (const name of Object.keys(coreCategories())) {
		categories.set(name, new Map());
	}
	const singles = new Map<string, DiscoveredFile>();
	singles.set("modules", makeSingle("modules", "../modules"));
	if (withEnv) singles.set("env", makeSingle("env", "../env"));
	if (withEnvClient) {
		singles.set("envClient", makeSingle("envClient", "../env.client"));
	}
	return { categories, singles, spreads: new Map() };
}

function generate(withEnv: boolean, withEnvClient = false): string {
	return generateTemplate({
		configImportPath: "../questpie.config",
		discovered: minimalResult(withEnv, withEnvClient),
		categories: coreCategories(),
	});
}

// ─────────────────────────────────────────────────────────────────────────────
// Template emission
// ─────────────────────────────────────────────────────────────────────────────

describe("generateTemplate — env.ts wiring", () => {
	const code = generate(true);

	it("imports env BEFORE the runtime config", () => {
		const envIndex = code.indexOf('import _env from "../env";');
		const runtimeIndex = code.indexOf(
			'import _runtime from "../questpie.config";',
		);
		expect(envIndex).toBeGreaterThan(-1);
		expect(runtimeIndex).toBeGreaterThan(-1);
		expect(envIndex).toBeLessThan(runtimeIndex);
	});

	it("re-exports the validated env", () => {
		expect(code).toContain("export const env = _env;");
	});

	it("passes env into the createApp definition", () => {
		expect(code).toContain("env: _env,");
	});

	it("types app.env via the app type composition", () => {
		expect(code).toContain(
			'Omit<_AppQuestpieBase, "collections" | "globals" | "env">',
		);
		expect(code).toContain("env: typeof _env;");
	});
});

describe("generateTemplate — without env.ts", () => {
	const code = generate(false);

	it("emits no env artifacts", () => {
		expect(code).not.toContain('"../env"');
		expect(code).not.toContain("_env");
		expect(code).not.toContain("export const env");
	});

	it("keeps the original app type composition", () => {
		expect(code).toContain(
			'Omit<_AppQuestpieBase, "collections" | "globals"> & {',
		);
	});
});

describe("generateTemplate — env.client.ts", () => {
	it("is never imported by the generated index", () => {
		const code = generate(true, true);
		expect(code).not.toContain("env.client");
		expect(code).not.toContain("_envClient");
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// runCodegen — client env module emission (real files)
// ─────────────────────────────────────────────────────────────────────────────

const tmpDirs: string[] = [];

afterAll(async () => {
	for (const dir of tmpDirs) {
		await rm(dir, { recursive: true, force: true });
	}
});

/**
 * Standard-Schema string stub — keeps fixtures dependency-free so they can
 * be imported from any temp directory (no node_modules lookup involved).
 */
const SCHEMA_STUB = `
const str = (optional) => ({
	"~standard": {
		version: 1,
		vendor: "test",
		validate: (value) =>
			value === undefined && !optional
				? { issues: [{ message: "required" }] }
				: { value },
	},
});
`;

const CLIENT_ENV_SRC = (clientEnvImport: string) => `${clientEnvImport}
${SCHEMA_STUB}
export default clientEnv({
	consumers: ["expo", "vite"],
	vars: {
		APP_URL: str(false),
		POSTHOG_KEY: str(true),
	},
});
`;

async function writeFixtureProject(opts: {
	clientEnvImport: string;
	withEnvClient?: boolean;
}): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "questpie-env-codegen-"));
	tmpDirs.push(dir);
	await writeFile(join(dir, "modules.ts"), "export default [];\n");
	await writeFile(join(dir, "questpie.config.ts"), "export default {};\n");
	await writeFile(join(dir, "env.ts"), "export default {};\n");
	if (opts.withEnvClient !== false) {
		await writeFile(
			join(dir, "env.client.ts"),
			CLIENT_ENV_SRC(opts.clientEnvImport),
		);
	}
	await mkdir(join(dir, ".generated"), { recursive: true });
	return dir;
}

async function runFixtureCodegen(rootDir: string) {
	return runCodegen({
		rootDir,
		configPath: join(rootDir, "questpie.config.ts"),
		outDir: join(rootDir, ".generated"),
	});
}

const CLIENT_ENV_FACTORY_PATH = join(
	import.meta.dir,
	"../../src/shared/env/client-env.ts",
);

describe("runCodegen — client env emission", () => {
	it("emits one module per consumer with literal prefixed references", async () => {
		const dir = await writeFixtureProject({
			clientEnvImport: `import { clientEnv } from "${CLIENT_ENV_FACTORY_PATH}";`,
		});
		await runFixtureCodegen(dir);

		const expo = String(
			await readFile(join(dir, ".generated/env.client.expo.ts"), "utf-8"),
		);
		expect(expo).toContain("process.env.EXPO_PUBLIC_APP_URL");
		expect(expo).toContain("process.env.EXPO_PUBLIC_POSTHOG_KEY");
		expect(expo).toContain(
			'import { resolveClientEnv } from "questpie/env-client";',
		);
		expect(expo).toContain('}, "expo");');
		expect(expo).toContain("export type ClientEnv = typeof env;");
		// Server keys physically absent + no dynamic access
		expect(expo).not.toContain("DATABASE_URL");
		expect(expo).not.toContain("import.meta.env");

		const vite = String(
			await readFile(join(dir, ".generated/env.client.vite.ts"), "utf-8"),
		);
		expect(vite).toContain("import.meta.env.VITE_APP_URL");
		expect(vite).toContain("import.meta.env.VITE_POSTHOG_KEY");
		expect(vite).not.toContain("process.env");
	});

	it("imports env before runtime in the generated index", async () => {
		const dir = await writeFixtureProject({
			clientEnvImport: `import { clientEnv } from "${CLIENT_ENV_FACTORY_PATH}";`,
		});
		const result = await runFixtureCodegen(dir);
		const envIndex = result.code.indexOf('import _env from "../env";');
		const runtimeIndex = result.code.indexOf("import _runtime from");
		expect(envIndex).toBeGreaterThan(-1);
		expect(envIndex).toBeLessThan(runtimeIndex);
	});

	it("falls back to source extraction when env.client.ts is not importable", async () => {
		// "questpie/env" cannot resolve from an os tmpdir (no node_modules) —
		// forces the regex fallback path.
		const dir = await writeFixtureProject({
			clientEnvImport: 'import { clientEnv } from "questpie/env";',
		});
		await runFixtureCodegen(dir);

		const expo = String(
			await readFile(join(dir, ".generated/env.client.expo.ts"), "utf-8"),
		);
		expect(expo).toContain("process.env.EXPO_PUBLIC_APP_URL");
		expect(expo).toContain("process.env.EXPO_PUBLIC_POSTHOG_KEY");
	});

	it("emits nothing without env.client.ts", async () => {
		const dir = await writeFixtureProject({
			clientEnvImport: "",
			withEnvClient: false,
		});
		await runFixtureCodegen(dir);
		expect(
			(await readFile(join(dir, ".generated/index.ts"), "utf-8")).length,
		).toBeGreaterThan(0);
		await expect(
			readFile(join(dir, ".generated/env.client.expo.ts"), "utf-8"),
		).rejects.toThrow();
	});

	it("removes stale client env modules when env.client.ts is deleted", async () => {
		const dir = await writeFixtureProject({
			clientEnvImport: `import { clientEnv } from "${CLIENT_ENV_FACTORY_PATH}";`,
		});
		await runFixtureCodegen(dir);
		await readFile(join(dir, ".generated/env.client.expo.ts"), "utf-8");
		await readFile(join(dir, ".generated/env.client.vite.ts"), "utf-8");

		await unlink(join(dir, "env.client.ts"));
		await runFixtureCodegen(dir);

		await expect(
			readFile(join(dir, ".generated/env.client.expo.ts"), "utf-8"),
		).rejects.toThrow();
		await expect(
			readFile(join(dir, ".generated/env.client.vite.ts"), "utf-8"),
		).rejects.toThrow();
	});
});
