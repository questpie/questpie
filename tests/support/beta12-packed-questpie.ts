import { cp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "../..");

export async function installQuestpieForTracer(
	applicationRoot: string,
	tarball = process.env.QUESTPIE_PACKED_TARBALL,
): Promise<string> {
	const packageRoot = join(applicationRoot, "node_modules/questpie");
	await rm(packageRoot, { force: true, recursive: true });
	await mkdir(join(packageRoot, "internal"), { recursive: true });
	if (tarball) {
		const extracted = Bun.spawnSync([
			"tar",
			"-xzf",
			resolve(tarball),
			"--strip-components=1",
			"-C",
			packageRoot,
		]);
		if (extracted.exitCode !== 0)
			throw new Error(
				`failed to extract packed questpie: ${extracted.stderr.toString().trim()}`,
			);
		for (const dependency of ["typescript", "@types", "pg"]) {
			const installed = join(applicationRoot, "node_modules", dependency);
			await rm(installed, { force: true, recursive: true });
			await symlink(
				resolve(repositoryRoot, "node_modules", dependency),
				installed,
				"dir",
			);
		}
		return join(packageRoot, "dist/index.js");
	}

	await writeFile(
		join(packageRoot, "package.json"),
		JSON.stringify({
			name: "questpie",
			type: "module",
			exports: {
				".": "./index.ts",
				"./internal/observability": "./internal/observability.ts",
			},
		}),
	);
	await symlink(
		resolve(repositoryRoot, "packages/questpie/src/index.ts"),
		join(packageRoot, "index.ts"),
		"file",
	);
	await symlink(
		resolve(repositoryRoot, "packages/questpie/src/internal/observability.ts"),
		join(packageRoot, "internal/observability.ts"),
		"file",
	);
	return join(packageRoot, "index.ts");
}

export async function installOpenTelemetryForTracer(
	applicationRoot: string,
	tarball = process.env.QUESTPIE_OTEL_PACKED_TARBALL,
): Promise<void> {
	const packageRoot = join(
		applicationRoot,
		"node_modules/@questpie/opentelemetry",
	);
	await rm(packageRoot, { force: true, recursive: true });
	await mkdir(packageRoot, { recursive: true });
	if (tarball) {
		const extracted = Bun.spawnSync([
			"tar",
			"-xzf",
			resolve(tarball),
			"--strip-components=1",
			"-C",
			packageRoot,
		]);
		if (extracted.exitCode !== 0)
			throw new Error(
				`failed to extract packed @questpie/opentelemetry: ${extracted.stderr.toString().trim()}`,
			);
	} else {
		const sourceRoot = resolve(repositoryRoot, "packages/opentelemetry");
		const build = Bun.spawnSync(["bun", "run", "build"], {
			cwd: sourceRoot,
			stderr: "pipe",
			stdout: "pipe",
		});
		if (build.exitCode !== 0)
			throw new Error(
				`failed to build @questpie/opentelemetry: ${build.stderr.toString().trim()}`,
			);
		await cp(join(sourceRoot, "dist"), join(packageRoot, "dist"), {
			recursive: true,
		});
		await cp(
			join(sourceRoot, "package.json"),
			join(packageRoot, "package.json"),
		);
	}
	const dependencies = join(applicationRoot, "node_modules/@opentelemetry");
	await rm(dependencies, { force: true, recursive: true });
	await symlink(
		resolve(
			repositoryRoot,
			"packages/opentelemetry/node_modules/@opentelemetry",
		),
		dependencies,
		"dir",
	);
}

export async function installReactForTracer(
	applicationRoot: string,
): Promise<void> {
	const sourceRoot = resolve(repositoryRoot, "packages/react");
	const packageRoot = join(applicationRoot, "node_modules/@questpie/react");
	const build = Bun.spawnSync(["bun", "run", "build"], {
		cwd: sourceRoot,
		stderr: "pipe",
		stdout: "pipe",
	});
	if (build.exitCode !== 0)
		throw new Error(
			`failed to build @questpie/react: ${build.stderr.toString().trim()}`,
		);
	await rm(packageRoot, { force: true, recursive: true });
	await mkdir(packageRoot, { recursive: true });
	await cp(join(sourceRoot, "dist"), join(packageRoot, "dist"), {
		recursive: true,
	});
	await cp(join(sourceRoot, "package.json"), join(packageRoot, "package.json"));
	for (const dependency of ["react", "react-dom"]) {
		const installed = join(applicationRoot, "node_modules", dependency);
		await rm(installed, { force: true, recursive: true });
		await symlink(
			await realpath(
				resolve(
					repositoryRoot,
					"fixtures/team-support-desk/node_modules",
					dependency,
				),
			),
			installed,
			"dir",
		);
	}
}

export function buildPackedTracer(
	applicationRoot: string,
	tarball = process.env.QUESTPIE_PACKED_TARBALL,
): boolean {
	if (!tarball) return false;
	const result = Bun.spawnSync(
		[
			"bun",
			join(applicationRoot, "node_modules/questpie/dist/cli.js"),
			"build",
		],
		{ cwd: applicationRoot, stdout: "pipe", stderr: "pipe" },
	);
	if (result.exitCode !== 0)
		throw new Error(
			`packed questpie build failed: ${result.stderr.toString().trim()}`,
		);
	return true;
}
