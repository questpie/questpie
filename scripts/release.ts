import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

function fail(message: string): never {
	console.error(`release: ${message}`);
	process.exit(1);
}

if (
	process.env.GITHUB_ACTIONS !== "true" ||
	process.env.GITHUB_REF_TYPE !== "tag"
) {
	fail("publishing requires a tagged GitHub Actions release run");
}

const packagesRoot = resolve("packages");
if (!existsSync(packagesRoot))
	fail("no publishable packages exist in this beta foundation");
const packageDirs = readdirSync(packagesRoot)
	.map((name) => resolve(packagesRoot, name))
	.filter((path) => existsSync(resolve(path, "package.json")))
	.filter(
		(path) =>
			!(
				JSON.parse(readFileSync(resolve(path, "package.json"), "utf8")) as {
					private?: boolean;
				}
			).private,
	);
if (packageDirs.length === 0)
	fail("no non-private package is eligible for release");

for (const path of packageDirs) {
	const result = Bun.spawnSync(
		["npm", "publish", "--provenance", "--access", "public"],
		{
			cwd: path,
			stdin: "inherit",
			stdout: "inherit",
			stderr: "inherit",
		},
	);
	if (result.exitCode !== 0) fail(`npm publish failed for ${path}`);
}
