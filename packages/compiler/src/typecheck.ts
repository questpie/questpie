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
		applicationTsconfig: string;
		applicationSourceRoot: string;
		packageCompilations: readonly Readonly<{
			name: string;
			files: readonly string[];
			contractPath: string;
		}>[];
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
			"#questpie/source/*": [join(input.applicationSourceRoot, "*")],
		};
		const typeRoots = [
			resolve(input.compilerRoot, "../../node_modules/@types"),
		];
		for (const [name, resolution] of input.packages)
			paths[`${name}/questpie`] = [resolution.entry];
		const singlePackage =
			input.packageCompilations.length === 1
				? input.packageCompilations[0]
				: undefined;
		if (singlePackage)
			paths["#questpie/package"] = [
				join(temporary, "generated", singlePackage.contractPath),
			];
		const config = {
			extends: input.applicationTsconfig,
			compilerOptions: {
				noEmit: true,
				paths,
				typeRoots,
			},
			files: [
				...input.applicationFiles,
				...(singlePackage?.files ?? []),
				join(temporary, "generated/app.ts"),
				join(temporary, "generated/client.ts"),
			],
			include: [],
		};
		const configs: Array<{ label: string; path: string }> = [];
		const configPath = join(temporary, "tsconfig.application.json");
		await writeFile(configPath, JSON.stringify(config, null, 2));
		configs.push({ label: "application", path: configPath });
		for (const [index, compilation] of input.packageCompilations.entries()) {
			if (singlePackage) continue;
			const packageConfigPath = join(
				temporary,
				`tsconfig.package-${index}.json`,
			);
			await writeFile(
				packageConfigPath,
				JSON.stringify(
					{
						extends: input.applicationTsconfig,
						compilerOptions: {
							noEmit: true,
							paths: {
								questpie: [input.frameworkEntry],
								"#questpie/package": [
									join(temporary, "generated", compilation.contractPath),
								],
							},
							typeRoots,
						},
						files: [
							...compilation.files,
							join(temporary, "generated", compilation.contractPath),
						],
						include: [],
					},
					null,
					2,
				),
			);
			configs.push({ label: compilation.name, path: packageConfigPath });
		}
		const compiler = resolve(
			input.compilerRoot,
			"../../node_modules/typescript/bin/tsc",
		);
		const started = performance.now();
		const outputs: string[] = [];
		let types = 0;
		let instantiations = 0;
		let memoryKiB = 0;
		for (const candidate of configs) {
			const result = Bun.spawnSync(
				[
					"bun",
					compiler,
					"-p",
					candidate.path,
					"--extendedDiagnostics",
					"--pretty",
					"false",
				],
				{ stdout: "pipe", stderr: "pipe" },
			);
			const diagnostics = `${result.stdout.toString()}${result.stderr.toString()}`;
			outputs.push(`## ${candidate.label}\n${diagnostics}`);
			if (result.exitCode !== 0)
				throw new CompilerDiagnosticError(
					"QP-COMPOSE-013",
					"structuralTypeError",
					diagnostics.trim(),
					{ scope: candidate.label },
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
			types += metric("Types");
			instantiations += metric("Instantiations");
			memoryKiB = Math.max(memoryKiB, metric("Memory used"));
		}
		return {
			diagnostics: outputs.join("\n"),
			elapsedMs: performance.now() - started,
			types,
			instantiations,
			memoryKiB,
		};
	} finally {
		await rm(temporary, { force: true, recursive: true });
	}
}
