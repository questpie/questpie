import { mkdir, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

export async function copyRuntimeSourceDeclarations(
	sourceRoot: string,
	outputRoot: string,
): Promise<readonly string[]> {
	const declarations = (await readdir(sourceRoot, { recursive: true }))
		.filter((path) => path.endsWith(".d.ts"))
		.sort();
	for (const declaration of declarations) {
		const source = join(sourceRoot, declaration);
		const output = join(outputRoot, declaration);
		await mkdir(dirname(output), { recursive: true });
		await Bun.write(output, Bun.file(source));
	}
	return Object.freeze(
		declarations.map((declaration) =>
			relative(sourceRoot, join(sourceRoot, declaration)),
		),
	);
}

if (import.meta.main) {
	const packageRoot = resolve(import.meta.dir, "..");
	await copyRuntimeSourceDeclarations(
		join(packageRoot, "src"),
		join(packageRoot, "dist"),
	);
}
