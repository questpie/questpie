import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const packagesDir = join(ROOT, "packages");

function collectMjs(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return collectMjs(path);
		return entry.isFile() && entry.name.endsWith(".mjs") ? [path] : [];
	});
}

const files = readdirSync(packagesDir, { withFileTypes: true }).flatMap(
	(entry) => {
		if (!entry.isDirectory()) return [];
		const dist = join(packagesDir, entry.name, "dist");
		try {
			return collectMjs(dist);
		} catch {
			return [];
		}
	},
);

if (files.length === 0) {
	console.error(
		"✗ no package dist/*.mjs files found; run the package build first",
	);
	process.exit(1);
}

for (const file of files) {
	const result = Bun.spawnSync({
		cmd: ["node", "--check", file],
		cwd: ROOT,
		stdout: "inherit",
		stderr: "inherit",
	});
	if (result.exitCode !== 0) process.exit(result.exitCode);
}

console.log(`✓ ${files.length} dist modules passed node --check`);
