import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "../..");

test("types closed text normalizers for create and sparse update operands", async () => {
	const temporary = await mkdtemp(join(tmpdir(), "questpie-text-normalizers-"));
	try {
		const fixture = join(temporary, "authoring.ts");
		await writeFile(
			fixture,
			`import type { NormalizedValue, ValueProgramOperand } from "questpie";
import { operation } from "questpie";

declare const required: ValueProgramOperand<string>;
declare const optional: ValueProgramOperand<string | undefined>;

const trimmed = operation.text.trim(required);
const trimmedIfPresent = operation.text.trimIfPresent(optional);

const exactTrim: "trim" = trimmed.transform;
const exactTrimIfPresent: "trimIfPresent" = trimmedIfPresent.transform;
const requiredSource: ValueProgramOperand<string> = trimmed.source;
const optionalSource: ValueProgramOperand<string | undefined> =
	trimmedIfPresent.source;
const requiredNormalization: NormalizedValue<string> = trimmed;
const optionalNormalization: NormalizedValue<string | undefined> =
	trimmedIfPresent;

void exactTrim;
void exactTrimIfPresent;
void requiredSource;
void optionalSource;
void requiredNormalization;
void optionalNormalization;

// @ts-expect-error trim cannot silently accept an absent sparse-update value.
operation.text.trim(optional);
`,
		);
		await writeFile(
			join(temporary, "tsconfig.json"),
			JSON.stringify({
				compilerOptions: {
					baseUrl: repositoryRoot,
					ignoreDeprecations: "6.0",
					lib: ["DOM", "ESNext"],
					module: "ESNext",
					moduleResolution: "Bundler",
					noEmit: true,
					paths: { questpie: ["packages/questpie/src/index.ts"] },
					skipLibCheck: true,
					strict: true,
					target: "ESNext",
					types: [],
				},
				files: [fixture],
			}),
		);

		const result = Bun.spawnSync(
			[
				"bun",
				"node_modules/typescript/bin/tsc",
				"-p",
				join(temporary, "tsconfig.json"),
				"--pretty",
				"false",
			],
			{ cwd: repositoryRoot, stderr: "pipe", stdout: "pipe" },
		);
		const output = `${result.stdout.toString()}${result.stderr.toString()}`;
		expect(output).toBe("");
		expect(result.exitCode).toBe(0);
	} finally {
		await rm(temporary, { force: true, recursive: true });
	}
});
