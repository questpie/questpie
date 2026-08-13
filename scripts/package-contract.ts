import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";

type PackageJson = {
	name?: string;
	version?: string;
	private?: boolean;
	type?: string;
	files?: string[];
	exports?: Record<string, unknown>;
	scripts?: Record<string, string>;
};

function fail(message: string): never {
	console.error(`package-contract: ${message}`);
	process.exit(1);
}

function packageFiles(root: string): string[] {
	if (!existsSync(root)) return [];
	return readdirSync(root)
		.map((name) => resolve(root, name, "package.json"))
		.filter(existsSync)
		.sort();
}

function targets(value: unknown): string[] {
	if (typeof value === "string") return [value];
	if (!value || typeof value !== "object") return [];
	return Object.values(value).flatMap(targets);
}

const publicPackages = packageFiles(resolve("packages"))
	.map((path) => ({
		path,
		json: JSON.parse(readFileSync(path, "utf8")) as PackageJson,
	}))
	.filter(({ json }) => !json.private);

if (publicPackages.length === 0) {
	console.log("package-contract: no publishable implementation packages yet");
	process.exit(0);
}

for (const { path, json } of publicPackages) {
	const label = json.name ?? path;
	if (!json.name || !json.version)
		fail(`${label}: name and version are required`);
	if (json.type !== "module") fail(`${label}: type must be module`);
	if (!json.scripts?.build) fail(`${label}: a build script is required`);
	if (!json.files?.includes("dist")) fail(`${label}: files must include dist`);
	if (!json.exports || !("." in json.exports))
		fail(`${label}: exports must define the package root`);

	const exportedTargets = targets(json.exports);
	if (!exportedTargets.some((target) => target.endsWith(".d.ts")))
		fail(`${label}: exports must expose declarations`);
	for (const target of exportedTargets.filter((entry) =>
		entry.startsWith("./"),
	)) {
		const artifact = resolve(dirname(path), target);
		if (!existsSync(artifact) || !statSync(artifact).isFile())
			fail(`${label}: missing built export ${target}`);
	}
}

console.log(
	`package-contract: ${publicPackages.length} publishable package(s) valid`,
);
