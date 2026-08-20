import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "../..");

export async function installQuestpieForTracer(
	applicationRoot: string,
	tarball = process.env.QUESTPIE_PACKED_TARBALL,
): Promise<string> {
	const packageRoot = join(applicationRoot, "node_modules/questpie");
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
				`failed to extract packed questpie: ${extracted.stderr.toString().trim()}`,
			);
		for (const dependency of ["typescript", "@types"]) {
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
		JSON.stringify({ name: "questpie", type: "module", exports: "./index.ts" }),
	);
	await symlink(
		resolve(repositoryRoot, "packages/questpie/src/index.ts"),
		join(packageRoot, "index.ts"),
		"file",
	);
	return join(packageRoot, "index.ts");
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
