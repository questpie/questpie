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

function run(command: string[], cwd: string): string {
	const result = Bun.spawnSync(command, {
		cwd,
		stderr: "pipe",
		stdout: "pipe",
	});
	expect(result.exitCode, result.stderr.toString()).toBe(0);
	return result.stdout.toString();
}

test("packed questpie exposes only the three discriminated helpers", async () => {
	const temporary = await mkdtemp(
		join(tmpdir(), "questpie-discriminated-pack-"),
	);
	try {
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
			`import {
  codec,
  relation,
  type DiscriminatedReference,
  type DiscriminatedValue,
  matchDiscriminated,
} from "questpie";

declare const appointmentBrand: unique symbol;
type AppointmentId = string & { readonly [appointmentBrand]: true };
type Subject = DiscriminatedReference<{ appointment: AppointmentId }>;
declare const subject: Subject;
const id: AppointmentId = matchDiscriminated(subject, {
  appointment: (value) => value.id,
});
type Event = DiscriminatedValue<{ opened: { at: Date } }>;
declare const event: Event;
void [id, event];

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
				files: ["types.ts"],
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
}, 15_000);
