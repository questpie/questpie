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

import {
	assertPackagesRegistered,
	isNpmPackageVersionPublished,
} from "./npm-package-preflight";
import { preparePublishManifest } from "./publish-manifest";

const execAsync = promisify(exec);

const ROOT_DIR = path.join(import.meta.dirname, "..");
const PACKAGES_DIR = path.join(ROOT_DIR, "packages");
const PUBLISH_SUMMARY_PATH = path.join(
	ROOT_DIR,
	".changeset",
	"publish-summary.json",
);

export function npmReleaseCommand(dryRun: boolean): string {
	return dryRun
		? "npm pack --dry-run --json"
		: "npm publish --access public --provenance";
}

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

interface PublishedPackageSummary {
	name: string;
	version: string;
	dir: string;
}

interface PublishSummary {
	packages: PublishedPackageSummary[];
	generatedAt: string;
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
		for (const deps of [entry.pkg.dependencies, entry.pkg.peerDependencies]) {
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

async function main() {
	const dryRun = process.argv.includes("--dry-run");
	console.log("🔄 Preparing packages for publish...\n");
	if (dryRun) {
		console.log(
			"🔍 Dry run: packages will be packed and validated, never published\n",
		);
	}

	const packages = getPackages();
	console.log("🔎 Verifying npm package registration...\n");
	await assertPackagesRegistered(packages.keys());
	console.log("✅ Every public workspace package is registered on npm\n");

	const publishedVersions = new Map(
		await Promise.all(
			[...packages].map(
				async ([name, { pkg }]) =>
					[
						name,
						await isNpmPackageVersionPublished(name, pkg.version),
					] as const,
			),
		),
	);

	if (!dryRun) fs.rmSync(PUBLISH_SUMMARY_PATH, { force: true });
	const versions = getWorkspaceVersions(packages);
	const originals = new Map<string, string>();
	const publishedNow: PublishedPackageSummary[] = [];
	const validated: string[] = [];
	const skipped: string[] = [];
	const failed: string[] = [];

	try {
		// Save originals and apply transformations
		for (const [, { dir }] of packages) {
			const packageJsonPath = path.join(dir, "package.json");
			const original = fs.readFileSync(packageJsonPath, "utf-8");
			originals.set(packageJsonPath, original);

			const sourcePackageJson: PackageJson = JSON.parse(original);
			const prepared = preparePublishManifest(sourcePackageJson, versions);
			const packageJson = prepared.manifest;
			console.log(`📦 ${packageJson.name}`);

			if (prepared.appliedPublishConfigKeys.length > 0) {
				console.log("  Applying publishConfig overrides:");
				for (const key of prepared.appliedPublishConfigKeys) {
					console.log(`    ${key}`);
				}
			}

			for (const key of prepared.resolvedWorkspaceSections) {
				console.log(`  Converting workspace ${key}:`);
			}

			if (
				prepared.appliedPublishConfigKeys.length > 0 ||
				prepared.resolvedWorkspaceSections.length > 0
			) {
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

		for (const name of publishOrder) {
			const entry = packages.get(name)!;
			const version = entry.pkg.version;

			// Skip if already published
			if (publishedVersions.get(name)) {
				console.log(`⏭️  ${name}@${version} — already on npm, skipping`);
				skipped.push(name);
				continue;
			}

			console.log(
				dryRun
					? `🔍 Validating ${name}@${version}...`
					: `📤 Publishing ${name}@${version}...`,
			);

			try {
				const { stdout, stderr } = await execAsync(npmReleaseCommand(dryRun), {
					cwd: entry.dir,
					env: { ...process.env },
				});
				if (stdout) console.log(`  ${stdout.trim()}`);
				if (stderr && !stderr.includes("npm warn")) {
					console.error(`  ${stderr.trim()}`);
				}
				if (dryRun) {
					console.log(`  ✅ ${name}@${version} package is publishable\n`);
					validated.push(name);
				} else {
					console.log(`  ✅ ${name}@${version} published\n`);
					publishedNow.push({
						name,
						version,
						dir: path.relative(ROOT_DIR, entry.dir),
					});
				}
			} catch (error: any) {
				console.error(`  ❌ ${name}@${version} failed`);
				if (error.stderr) console.error(`  ${error.stderr.trim()}`);
				failed.push(name);
			}
		}
	} finally {
		// Always restore transformed manifests, including unexpected failures.
		console.log("\n🔄 Restoring original package.json files...");
		for (const [packageJsonPath, original] of originals) {
			fs.writeFileSync(packageJsonPath, original);
		}
		console.log("✅ Restored\n");
	}

	if (publishedNow.length > 0) {
		const summary: PublishSummary = {
			packages: publishedNow,
			generatedAt: new Date().toISOString(),
		};
		fs.writeFileSync(
			PUBLISH_SUMMARY_PATH,
			JSON.stringify(summary, null, "\t") + "\n",
		);
		console.log(`📝 Wrote publish summary to ${PUBLISH_SUMMARY_PATH}`);
	}

	// Summary
	if (publishedNow.length > 0) {
		console.log(
			`✅ Published: ${publishedNow.map(({ name }) => name).join(", ")}`,
		);
	}
	if (validated.length > 0) {
		console.log(`✅ Dry-run validated: ${validated.join(", ")}`);
	}
	if (skipped.length > 0) {
		console.log(`⏭️  Already published: ${skipped.join(", ")}`);
	}
	if (failed.length > 0) {
		console.error(`❌ Failed: ${failed.join(", ")}`);
		process.exit(1);
	}

	console.log(
		dryRun
			? "\n🎉 Release dry run completed without publishing!"
			: "\n🎉 All packages published successfully!",
	);
}

if (import.meta.main) {
	main().catch((error) => {
		console.error("Fatal error:", error);
		process.exit(1);
	});
}
