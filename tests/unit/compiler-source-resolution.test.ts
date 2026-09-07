import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { evaluateModules } from "../../packages/compiler/src/discovery";

test.each([
	{
		label: "ambiguous extension",
		specifier: "./choice",
		files: ["choice.ts", "choice.tsx", "choice/index.ts"],
		expected: "choice.tsx",
	},
	{
		label: "directory",
		specifier: "./choice",
		files: ["choice/index.ts"],
		expected: "choice/index.ts",
	},
	{
		label: "explicit extension",
		specifier: "./choice.ts",
		files: ["choice.ts", "choice.tsx", "choice/index.ts"],
		expected: "choice.ts",
	},
])(
	"structural evaluation preserves Bun's $label local import selection",
	async ({ specifier, files, expected }) => {
		const root = await mkdtemp(join(tmpdir(), "questpie-source-resolution-"));
		try {
			await mkdir(join(root, "choice"));
			await Promise.all(
				["entry.ts", ...files].map((file) =>
					writeFile(
						join(root, file),
						file === "entry.ts"
							? `import { constraint, defineCollection, field } from "questpie";
import { name } from ${JSON.stringify(specifier)};
export const selected = defineCollection({ name,
 fields: { id: field.uuid({ nullable: false }) },
 constraints: { primary: constraint.primaryKey({ fields: ["id"] }) },
});`
							: `export const name = ${JSON.stringify(file)};`,
					),
				),
			);
			const values = await evaluateModules({
				applicationRoot: root,
				files: ["entry.ts", ...files].map((file) => join(root, file)),
				frameworkEntry: resolve(
					import.meta.dir,
					"../../packages/questpie/src/index.ts",
				),
				packages: new Map(),
			});
			expect(
				values.find((value) => value.exportName === "selected")?.value.name,
			).toBe(expected);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	},
);
