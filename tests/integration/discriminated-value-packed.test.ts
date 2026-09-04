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
import { join, resolve } from "node:path";

import ts from "typescript";

const repositoryRoot = resolve(import.meta.dir, "../..");
const packageRoot = resolve(repositoryRoot, "packages/questpie");
const publicSkillReference = resolve(
	repositoryRoot,
	"skills/questpie/references/query-resources-react-and-relations.md",
);
const publicOperationsReference = resolve(
	repositoryRoot,
	"skills/questpie/references/operations-http-openapi-and-mcp.md",
);

async function publicExample(
	reference: string,
	name: string,
	language: "json" | "ts" | "tsx",
): Promise<string> {
	const source = await readFile(reference, "utf8");
	const fence = "```";
	const match = new RegExp(
		`<!-- packed-example: ${name} -->\\s*${fence}${language}\\n([\\s\\S]*?)\\n${fence}`,
		"u",
	).exec(source);
	if (!match?.[1]) throw new Error(`public ${name} example missing`);
	return `${match[1]}\n`;
}

function run(command: string[], cwd: string): string {
	const result = Bun.spawnSync(command, {
		cwd,
		stderr: "pipe",
		stdout: "pipe",
	});
	expect(result.exitCode, result.stderr.toString()).toBe(0);
	return result.stdout.toString();
}

test("packed questpie exposes the three helpers and compiles every public skill example", async () => {
	const temporary = await mkdtemp(
		join(tmpdir(), "questpie-discriminated-pack-"),
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
		const installed = join(consumer, "node_modules/questpie");
		await mkdir(installed, { recursive: true });
		run(
			[
				"tar",
				"-xzf",
				join(temporary, archive!),
				"--strip-components=1",
				"-C",
				installed,
			],
			temporary,
		);

		const declarationPath = join(installed, "dist/discriminated-value.d.ts");
		const declaration = await readFile(declarationPath, "utf8");
		const source = ts.createSourceFile(
			declarationPath,
			declaration,
			ts.ScriptTarget.Latest,
			true,
			ts.ScriptKind.TS,
		);
		const publicNames = source.statements.flatMap((statement) => {
			if (
				!ts.canHaveModifiers(statement) ||
				!ts
					.getModifiers(statement)
					?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
			)
				return [];
			if (
				ts.isTypeAliasDeclaration(statement) ||
				ts.isFunctionDeclaration(statement)
			)
				return statement.name ? [statement.name.text] : [];
			return [];
		});
		expect(publicNames).toEqual([
			"DiscriminatedValue",
			"DiscriminatedReference",
			"matchDiscriminated",
		]);

		await writeFile(
			join(consumer, "package.json"),
			JSON.stringify({
				name: "packed-helper-consumer",
				private: true,
				type: "module",
			}),
		);
		await writeFile(
			join(consumer, "types.ts"),
			await publicExample(
				publicSkillReference,
				"discriminated-reference",
				"ts",
			),
		);
		await writeFile(
			join(consumer, "generated-contract.d.ts"),
			`declare module "#questpie/client" {
  export function createClient(input: { baseUrl: string }): {
    withContext(context: { tenantId: string }): {
      queries: Record<string, (input: { first: number; after: null }) => Promise<unknown>>;
    };
  };
}
`,
		);
		await writeFile(
			join(consumer, "generated-client.ts"),
			`declare const tenantId: string;\n${await publicExample(
				publicOperationsReference,
				"generated-client",
				"ts",
			)}void tickets;\n`,
		);
		await writeFile(
			join(consumer, "react.tsx"),
			`declare const ticketId: string;
declare const api: {
  queries: Record<string, {
    observe(input: { id: string }): {
      getSnapshot(): Readonly<{ status: "pending" }>;
      subscribe(notify: () => void): () => void;
    };
  }>;
};
${await publicExample(
	publicSkillReference,
	"react-query-resource",
	"tsx",
)}void snapshot;
`,
		);
		expect(
			JSON.parse(
				await publicExample(
					publicOperationsReference,
					"projection-config",
					"json",
				),
			),
		).toEqual({ projections: { mcp: true, openapi: true } });
		await writeFile(
			join(consumer, "negative.ts"),
			`import { codec, relation, type DiscriminatedValue } from "questpie";

type Event = DiscriminatedValue<{ opened: { at: Date } }>;
declare const event: Event;
void event;

// @ts-expect-error The helper adds no codec variant.
codec.variant;
// @ts-expect-error The helper adds no polymorphic Relation descriptor.
relation.polymorphic;
`,
		);
		await writeFile(
			join(consumer, "runtime.ts"),
			`import { matchDiscriminated } from "questpie";
console.log(JSON.stringify({
  exports: Object.keys(await import("questpie")).filter((name) => name.toLowerCase().includes("discriminated")),
  value: matchDiscriminated({ kind: "appointment", id: "a-1" }, {
    appointment: ({ id }) => id,
  }),
}));
`,
		);
		await writeFile(
			join(consumer, "tsconfig.json"),
			JSON.stringify({
				compilerOptions: {
					ignoreDeprecations: "6.0",
					lib: ["DOM", "ESNext"],
					module: "ESNext",
					moduleResolution: "Bundler",
					noEmit: true,
					skipLibCheck: true,
					strict: true,
					target: "ESNext",
					types: [],
				},
				files: [
					"generated-contract.d.ts",
					"generated-client.ts",
					"negative.ts",
					"react.tsx",
					"types.ts",
				],
			}),
		);

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
		expect(JSON.parse(run(["bun", "runtime.ts"], consumer))).toEqual({
			exports: ["matchDiscriminated"],
			value: "a-1",
		});
	} finally {
		await rm(temporary, { force: true, recursive: true });
	}
}, 60_000);
