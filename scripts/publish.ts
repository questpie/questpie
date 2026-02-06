/**
 * Publish script that:
 * 1. Applies publishConfig overrides (exports, main, etc.)
 * 2. Converts workspace:* to actual versions
 * 3. Runs changeset publish (npm with provenance/trusted publishing)
 * 4. Restores original package.json files
 *
 * This is needed because:
 * - changeset publish uses npm which doesn't understand workspace:* protocol
 * - npm doesn't apply publishConfig overrides like bun publish does
 * - bun publish understands both but doesn't support --provenance (trusted publishing)
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

const ROOT_DIR = path.join(import.meta.dirname, "..");
const PACKAGES_DIR = path.join(ROOT_DIR, "packages");

interface PackageJson {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  publishConfig?: Record<string, unknown>;
  [key: string]: unknown;
}

// Get all package versions from the monorepo
function getWorkspaceVersions(): Map<string, string> {
  const versions = new Map<string, string>();
  const entries = fs.readdirSync(PACKAGES_DIR, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const packageJsonPath = path.join(PACKAGES_DIR, entry.name, "package.json");
    if (!fs.existsSync(packageJsonPath)) continue;

    const packageJson: PackageJson = JSON.parse(
      fs.readFileSync(packageJsonPath, "utf-8"),
    );
    versions.set(packageJson.name, packageJson.version);
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
        // workspace:* -> ^actualVersion
        // workspace:^ -> ^actualVersion
        // workspace:~ -> ~actualVersion
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

// Get all package.json paths
function getPackageJsonPaths(): string[] {
  const paths: string[] = [];
  const entries = fs.readdirSync(PACKAGES_DIR, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const packageJsonPath = path.join(PACKAGES_DIR, entry.name, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      paths.push(packageJsonPath);
    }
  }

  return paths;
}

async function main() {
  console.log("🔄 Preparing packages for publish...\n");

  const versions = getWorkspaceVersions();
  const packageJsonPaths = getPackageJsonPaths();
  const originals = new Map<string, string>();

  // Save originals and apply transformations
  for (const packageJsonPath of packageJsonPaths) {
    const original = fs.readFileSync(packageJsonPath, "utf-8");
    originals.set(packageJsonPath, original);

    const packageJson: PackageJson = JSON.parse(original);
    console.log(`📦 ${packageJson.name}`);

    let modified = false;

    // 1. Apply publishConfig overrides (like bun publish does)
    if (packageJson.publishConfig) {
      console.log("  Applying publishConfig overrides:");
      for (const [key, value] of Object.entries(packageJson.publishConfig)) {
        // Skip npm-specific fields that aren't overrides
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

    // Note: we don't convert devDependencies as they're not included in published packages

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

  console.log("🚀 Running changeset publish...\n");

  let publishSuccess = false;

  try {
    const { stdout, stderr } = await execAsync("bunx changeset publish", {
      cwd: ROOT_DIR,
      env: { ...process.env },
    });

    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);

    console.log("\n✅ Publish completed successfully");
    publishSuccess = true;
  } catch (error: any) {
    console.error("\n❌ Publish failed:", error.message);
    if (error.stdout) console.log("stdout:", error.stdout);
    if (error.stderr) console.error("stderr:", error.stderr);
  } finally {
    // Always restore originals
    console.log("\n🔄 Restoring original package.json files...");
    for (const [packageJsonPath, original] of originals) {
      fs.writeFileSync(packageJsonPath, original);
    }
    console.log("✅ Restored");
  }

  if (!publishSuccess) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
