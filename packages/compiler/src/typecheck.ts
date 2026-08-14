import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { CompilerDiagnosticError } from "./diagnostic";
import type { PackageResolution } from "./types";

export async function typecheckCurrentContract(
	input: Readonly<{
		applicationFiles: readonly string[];
		generatedFiles: Readonly<Record<string, string>>;
		frameworkEntry: string;
		packages: ReadonlyMap<string, PackageResolution>;
		compilerRoot: string;
	}>,
): Promise<
	Readonly<{
		diagnostics: string;
		elapsedMs: number;
		types: number;
		instantiations: number;
		memoryKiB: number;
	}>
> {
	const temporary = await mkdtemp(join(tmpdir(), "questpie-current-types-"));
	try {
		for (const [path, contents] of Object.entries(input.generatedFiles)) {
			if (!path.endsWith(".ts")) continue;
			const target = join(temporary, "generated", path);
			await mkdir(dirname(target), { recursive: true });
			await writeFile(target, contents);
		}
		const paths: Record<string, string[]> = {
			questpie: [input.frameworkEntry],
			"#questpie/app": [join(temporary, "generated/app.ts")],
			"#questpie/client": [join(temporary, "generated/client.ts")],
		};
		for (const [name, resolution] of input.packages)
			paths[`${name}/questpie`] = [resolution.entry];
		const config = {
			compilerOptions: {
				allowImportingTsExtensions: true,
				forceConsistentCasingInFileNames: true,
				lib: ["ES2024", "DOM"],
				module: "ESNext",
				moduleResolution: "Bundler",
				noEmit: true,
				noUncheckedIndexedAccess: true,
				paths,
				skipLibCheck: true,
				strict: true,
				target: "ES2024",
			},
			files: [
				...input.applicationFiles,
				join(temporary, "generated/app.ts"),
				join(temporary, "generated/client.ts"),
			],
		};
		const configPath = join(temporary, "tsconfig.json");
		await writeFile(configPath, JSON.stringify(config, null, 2));
		const compiler = resolve(
			input.compilerRoot,
			"../../node_modules/typescript/bin/tsc",
		);
		const started = performance.now();
		const result = Bun.spawnSync(
			[
				"bun",
				compiler,
				"-p",
				configPath,
				"--extendedDiagnostics",
				"--pretty",
				"false",
			],
			{ stdout: "pipe", stderr: "pipe" },
		);
		const elapsedMs = performance.now() - started;
		const diagnostics = `${result.stdout.toString()}${result.stderr.toString()}`;
		if (result.exitCode !== 0)
			throw new CompilerDiagnosticError(
				"QP-COMPOSE-013",
				"structuralTypeError",
				diagnostics.trim(),
			);
		const metric = (label: string): number => {
			const match = diagnostics.match(
				new RegExp(`^${label}:\\s+([0-9.]+)`, "m"),
			);
			if (!match?.[1])
				throw new CompilerDiagnosticError(
					"QP-COMPOSE-013",
					"structuralTypeError",
					`canonical TypeScript omitted ${label}`,
				);
			return Number(match[1]);
		};
		return {
			diagnostics,
			elapsedMs,
			types: metric("Types"),
			instantiations: metric("Instantiations"),
			memoryKiB: metric("Memory used"),
		};
	} finally {
		await rm(temporary, { force: true, recursive: true });
	}
}
