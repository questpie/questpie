import { expect, test } from "bun:test";
import {
	mkdtemp,
	mkdir,
	readFile,
	readdir,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "../..");
const packageRoot = resolve(repositoryRoot, "packages/questpie");
const documentationPath = resolve(
	repositoryRoot,
	"apps/docs/content/docs/v4/data-and-queries.mdx",
);

function run(command: string[], cwd: string): void {
	const result = Bun.spawnSync(command, {
		cwd,
		stderr: "pipe",
		stdout: "pipe",
	});
	expect(
		result.exitCode,
		`${result.stdout.toString()}${result.stderr.toString()}`,
	).toBe(0);
}

function exampleSource(documentation: string, path: string): string {
	const opening = `\`\`\`ts title="${path}"\n`;
	const start = documentation.indexOf(opening);
	if (start === -1) throw new Error(`missing documented example ${path}`);
	const sourceStart = start + opening.length;
	const end = documentation.indexOf("\n```", sourceStart);
	if (end === -1) throw new Error(`unterminated documented example ${path}`);
	return `${documentation.slice(sourceStart, end)}\n`;
}

test("compiles the public inverse-list example against packed questpie", async () => {
	const temporary = await mkdtemp(
		join(tmpdir(), "questpie-inverse-docs-pack-"),
	);
	try {
		run(["bun", "run", "build"], packageRoot);
		run(
			[
				"bun",
				"pm",
				"pack",
				"--destination",
				temporary,
				"--ignore-scripts",
				"--quiet",
			],
			packageRoot,
		);
		const archive = (await readdir(temporary)).find((name) =>
			name.endsWith(".tgz"),
		);
		expect(archive).toBeDefined();

		const consumer = join(temporary, "consumer");
		await mkdir(consumer, { recursive: true });
		await mkdir(join(consumer, "packages"));
		await writeFile(
			join(consumer, "package.json"),
			JSON.stringify({
				name: "questpie-inverse-docs-consumer",
				private: true,
				type: "module",
				dependencies: { questpie: `file:${join(temporary, archive!)}` },
			}),
		);
		await writeFile(
			join(consumer, "questpie.json"),
			JSON.stringify({
				$schema: "https://questpie.dev/schema/application-v1.json",
				version: 1,
				application: { name: "inverseDocs" },
				postgres: {
					schema: "inverse_docs",
					minimumMajor: 16,
					databaseCollation: "C.UTF-8",
					databaseCType: "C.UTF-8",
					extensions: [],
					physicalNames: {},
				},
				source: { root: "src", exclude: [] },
				packages: {},
			}),
		);
		await writeFile(
			join(consumer, "tsconfig.json"),
			JSON.stringify({
				compilerOptions: {
					allowImportingTsExtensions: true,
					module: "ESNext",
					moduleResolution: "Bundler",
					noEmit: true,
					paths: {
						"#questpie/app": ["./.questpie/generated/app.ts"],
						"#questpie/client": ["./.questpie/generated/client.ts"],
						"#questpie/source/*": ["./src/*"],
					},
					skipLibCheck: true,
					strict: true,
					target: "ES2024",
					types: ["bun"],
				},
				include: ["src/**/*.ts", "web/**/*.ts"],
			}),
		);

		const documentation = await readFile(documentationPath, "utf8");
		for (const path of [
			"src/context.ts",
			"src/data/comments.ts",
			"src/data/policies.ts",
			"src/data/tickets.ts",
			"src/queries/ticket-detail.ts",
			"web/client.ts",
		]) {
			const target = join(consumer, path);
			await mkdir(dirname(target), { recursive: true });
			await writeFile(target, exampleSource(documentation, path));
		}

		run(["bun", "install", "--ignore-scripts"], consumer);
		run([join(consumer, "node_modules/.bin/questpie"), "build"], consumer);
		run(
			[
				"bun",
				resolve(repositoryRoot, "node_modules/typescript/bin/tsc"),
				"-p",
				join(consumer, "tsconfig.json"),
				"--pretty",
				"false",
			],
			consumer,
		);
	} finally {
		await rm(temporary, { force: true, recursive: true });
	}
}, 60_000);
