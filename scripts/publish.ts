/**
 * Publish script that:
 * 1. Applies publishConfig overrides (exports, main, etc.)
 * 2. Converts workspace:* to actual versions
 * 3. Publishes packages in topological order (leaf deps first)
 * 4. Restores original package.json files
 *
 * This is needed because:
 * - changeset publish uses npm which doesn't understand workspace:* protocol
 * - npm doesn't apply publishConfig overrides like bun publish does
 * - bun publish understands both but doesn't support --provenance (trusted publishing)
 * - npm publish resolves dependencies during pack, so inter-workspace deps
 *   must already be on the registry → we publish in dependency order
 */

import { exec } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";

const execAsync = promisify(exec);

const ROOT_DIR = path.join(import.meta.dirname, "..");
const PACKAGES_DIR = path.join(ROOT_DIR, "packages");

interface PackageJson {
	name: string;
	version: string;
	private?: boolean;
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
	publishConfig?: Record<string, unknown>;
	[key: string]: unknown;
}

// Get all package.json data from the monorepo
function getPackages(): Map<string, { dir: string; pkg: PackageJson }> {
	const packages = new Map<string, { dir: string; pkg: PackageJson }>();
	const entries = fs.readdirSync(PACKAGES_DIR, { withFileTypes: true });

	for (const entry of entries) {
		if (!entry.isDirectory()) continue;

		const packageJsonPath = path.join(PACKAGES_DIR, entry.name, "package.json");
		if (!fs.existsSync(packageJsonPath)) continue;

		const pkg: PackageJson = JSON.parse(
			fs.readFileSync(packageJsonPath, "utf-8"),
		);
		if (pkg.private) continue;
		packages.set(pkg.name, { dir: path.join(PACKAGES_DIR, entry.name), pkg });
	}

	return packages;
}

// Get all package versions from the monorepo
function getWorkspaceVersions(
	packages: Map<string, { dir: string; pkg: PackageJson }>,
): Map<string, string> {
	const versions = new Map<string, string>();
	for (const [name, { pkg }] of packages) {
		versions.set(name, pkg.version);
	}
	return versions;
}

// Replace workspace:* with actual versions in a dependencies object
function replaceWorkspaceVersions(
	deps: Record<string, string> | undefined,
	versions: Map<string, string>,
): Record<string, string> | undefined {
	if (!deps) return deps;

	const result: Record<string, string> = {};

	for (const [name, version] of Object.entries(deps)) {
		if (version.startsWith("workspace:")) {
			const actualVersion = versions.get(name);
			if (actualVersion) {
				if (version === "workspace:*" || version === "workspace:^") {
					result[name] = `^${actualVersion}`;
				} else if (version === "workspace:~") {
					result[name] = `~${actualVersion}`;
				} else {
					result[name] = `^${actualVersion}`;
				}
				console.log(`    ${name}: ${version} -> ${result[name]}`);
			} else {
				console.warn(
					`    ⚠️  ${name}: workspace version not found, keeping as-is`,
				);
				result[name] = version;
			}
		} else {
			result[name] = version;
		}
	}

	return result;
}

// Topological sort — returns packages in publish order (leaf deps first)
function topoSort(
	packages: Map<string, { dir: string; pkg: PackageJson }>,
): string[] {
	const names = new Set(packages.keys());
	const visited = new Set<string>();
	const order: string[] = [];

	function visit(name: string) {
		if (visited.has(name)) return;
		visited.add(name);

		const entry = packages.get(name);
		if (!entry) return;

		// Visit all workspace dependencies first
		for (const deps of [
			entry.pkg.dependencies,
			entry.pkg.peerDependencies,
		]) {
			if (!deps) continue;
			for (const dep of Object.keys(deps)) {
				if (names.has(dep)) visit(dep);
			}
		}

		order.push(name);
	}

	for (const name of names) visit(name);
	return order;
}

// Check if a package version is already published on npm
async function isPublished(name: string, version: string): Promise<boolean> {
	try {
		await execAsync(`npm view "${name}@${version}" version`, {
			env: { ...process.env },
		});
		return true;
	} catch {
		return false;
	}
}

async function main() {
	console.log("🔄 Preparing packages for publish...\n");

	const packages = getPackages();
	const versions = getWorkspaceVersions(packages);
	const originals = new Map<string, string>();

	// Save originals and apply transformations
	for (const [name, { dir }] of packages) {
		const packageJsonPath = path.join(dir, "package.json");
		const original = fs.readFileSync(packageJsonPath, "utf-8");
		originals.set(packageJsonPath, original);

		const packageJson: PackageJson = JSON.parse(original);
		console.log(`📦 ${packageJson.name}`);

		let modified = false;

		// 1. Apply publishConfig overrides
		if (packageJson.publishConfig) {
			console.log("  Applying publishConfig overrides:");
			for (const [key, value] of Object.entries(packageJson.publishConfig)) {
				if (key === "access" || key === "registry" || key === "tag") continue;
				console.log(`    ${key}`);
				packageJson[key] = value;
				modified = true;
			}
		}

		// 2. Convert workspace:* in dependencies
		if (packageJson.dependencies) {
			const hasWorkspace = Object.values(packageJson.dependencies).some((v) =>
				v.startsWith("workspace:"),
			);
			if (hasWorkspace) {
				console.log("  Converting workspace dependencies:");
				packageJson.dependencies = replaceWorkspaceVersions(
					packageJson.dependencies,
					versions,
				);
				modified = true;
			}
		}

		// 3. Convert workspace:* in peerDependencies
		if (packageJson.peerDependencies) {
			const hasWorkspace = Object.values(packageJson.peerDependencies).some(
				(v) => v.startsWith("workspace:"),
			);
			if (hasWorkspace) {
				console.log("  Converting workspace peerDependencies:");
				packageJson.peerDependencies = replaceWorkspaceVersions(
					packageJson.peerDependencies,
					versions,
				);
				modified = true;
			}
		}

		if (modified) {
			fs.writeFileSync(
				packageJsonPath,
				JSON.stringify(packageJson, null, "\t") + "\n",
			);
			console.log("  ✅ Modified\n");
		} else {
			console.log("  (no changes needed)\n");
		}
	}

	// Determine publish order
	const publishOrder = topoSort(packages);
	console.log(
		`\n📋 Publish order: ${publishOrder.map((n) => n.replace("@questpie/", "")).join(" → ")}\n`,
	);

	// Publish packages sequentially in topological order
	console.log("🚀 Publishing packages...\n");

	const published: string[] = [];
	const failed: string[] = [];

	for (const name of publishOrder) {
		const entry = packages.get(name)!;
		const version = entry.pkg.version;

		// Skip if already published
		if (await isPublished(name, version)) {
			console.log(`⏭️  ${name}@${version} — already on npm, skipping`);
			published.push(name);
			continue;
		}

		console.log(`📤 Publishing ${name}@${version}...`);

		try {
			const { stdout, stderr } = await execAsync(
				`npm publish --access public --provenance`,
				{
					cwd: entry.dir,
					env: { ...process.env },
				},
			);
			if (stdout) console.log(`  ${stdout.trim()}`);
			if (stderr && !stderr.includes("npm warn")) {
				console.error(`  ${stderr.trim()}`);
			}
			console.log(`  ✅ ${name}@${version} published\n`);
			published.push(name);
		} catch (error: any) {
			console.error(`  ❌ ${name}@${version} failed`);
			if (error.stderr) console.error(`  ${error.stderr.trim()}`);
			failed.push(name);
		}
	}

	// Restore originals
	console.log("\n🔄 Restoring original package.json files...");
	for (const [packageJsonPath, original] of originals) {
		fs.writeFileSync(packageJsonPath, original);
	}
	console.log("✅ Restored\n");

	// Summary
	if (published.length > 0) {
		console.log(`✅ Published: ${published.join(", ")}`);
	}
	if (failed.length > 0) {
		console.error(`❌ Failed: ${failed.join(", ")}`);
		process.exit(1);
	}

	console.log("\n🎉 All packages published successfully!");
}

main().catch((error) => {
	console.error("Fatal error:", error);
	process.exit(1);
});
