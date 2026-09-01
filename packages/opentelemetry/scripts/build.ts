import { rmSync } from "node:fs";
import { resolve } from "node:path";

const packageRoot = resolve(import.meta.dir, "..");
const projection = Bun.spawnSync(
	[
		"bun",
		resolve(packageRoot, "scripts/generate-signal-projection.ts"),
		"--check",
	],
	{ cwd: packageRoot, stdin: "inherit", stdout: "inherit", stderr: "inherit" },
);
if (projection.exitCode !== 0) process.exit(projection.exitCode);
rmSync(resolve(packageRoot, "dist"), { force: true, recursive: true });
const result = Bun.spawnSync(
	[
		"bun",
		resolve(packageRoot, "../../node_modules/typescript/bin/tsc"),
		"-p",
		resolve(packageRoot, "tsconfig.json"),
	],
	{ cwd: packageRoot, stdin: "inherit", stdout: "inherit", stderr: "inherit" },
);
if (result.exitCode !== 0) process.exit(result.exitCode);
