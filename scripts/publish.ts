/**
 * Publish script that converts workspace:* to actual versions before running changeset publish.
 *
 * This is needed because:
 * - changeset publish uses npm which doesn't understand workspace:* protocol
 * - bun publish understands workspace:* but doesn't support --provenance (trusted publishing)
 *
 * What it does:
 * 1. Reads all package.json files and saves originals
 * 2. Replaces workspace:* with actual versions from the monorepo
 * 3. Runs changeset publish (which uses npm with provenance)
 * 4. Restores original package.json files
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(exec)

const ROOT_DIR = path.join(import.meta.dirname, '..')
const PACKAGES_DIR = path.join(ROOT_DIR, 'packages')

interface PackageJson {
  name: string
  version: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  [key: string]: unknown
}

// Get all package versions from the monorepo
function getWorkspaceVersions(): Map<string, string> {
  const versions = new Map<string, string>()
  const entries = fs.readdirSync(PACKAGES_DIR, { withFileTypes: true })

  for (const entry of entries) {
    if (!entry.isDirectory()) continue

    const packageJsonPath = path.join(PACKAGES_DIR, entry.name, 'package.json')
    if (!fs.existsSync(packageJsonPath)) continue

    const packageJson: PackageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))
    versions.set(packageJson.name, packageJson.version)
  }

  return versions
}

// Replace workspace:* with actual versions in a dependencies object
function replaceWorkspaceVersions(
  deps: Record<string, string> | undefined,
  versions: Map<string, string>
): Record<string, string> | undefined {
  if (!deps) return deps

  const result: Record<string, string> = {}

  for (const [name, version] of Object.entries(deps)) {
    if (version.startsWith('workspace:')) {
      const actualVersion = versions.get(name)
      if (actualVersion) {
        // workspace:* -> ^actualVersion
        // workspace:^ -> ^actualVersion
        // workspace:~ -> ~actualVersion
        if (version === 'workspace:*' || version === 'workspace:^') {
          result[name] = `^${actualVersion}`
        } else if (version === 'workspace:~') {
          result[name] = `~${actualVersion}`
        } else {
          result[name] = `^${actualVersion}`
        }
        console.log(`  ${name}: ${version} -> ${result[name]}`)
      } else {
        console.warn(`  ⚠️  ${name}: workspace version not found, keeping as-is`)
        result[name] = version
      }
    } else {
      result[name] = version
    }
  }

  return result
}

// Get all package.json paths
function getPackageJsonPaths(): string[] {
  const paths: string[] = []
  const entries = fs.readdirSync(PACKAGES_DIR, { withFileTypes: true })

  for (const entry of entries) {
    if (!entry.isDirectory()) continue

    const packageJsonPath = path.join(PACKAGES_DIR, entry.name, 'package.json')
    if (fs.existsSync(packageJsonPath)) {
      paths.push(packageJsonPath)
    }
  }

  return paths
}

async function main() {
  console.log('🔄 Converting workspace:* to actual versions...\n')

  const versions = getWorkspaceVersions()
  const packageJsonPaths = getPackageJsonPaths()
  const originals = new Map<string, string>()

  // Save originals and convert workspace:* references
  for (const packageJsonPath of packageJsonPaths) {
    const original = fs.readFileSync(packageJsonPath, 'utf-8')
    originals.set(packageJsonPath, original)

    const packageJson: PackageJson = JSON.parse(original)
    console.log(`📦 ${packageJson.name}`)

    let modified = false

    if (packageJson.dependencies) {
      const newDeps = replaceWorkspaceVersions(packageJson.dependencies, versions)
      if (JSON.stringify(newDeps) !== JSON.stringify(packageJson.dependencies)) {
        packageJson.dependencies = newDeps
        modified = true
      }
    }

    if (packageJson.peerDependencies) {
      const newPeerDeps = replaceWorkspaceVersions(packageJson.peerDependencies, versions)
      if (JSON.stringify(newPeerDeps) !== JSON.stringify(packageJson.peerDependencies)) {
        packageJson.peerDependencies = newPeerDeps
        modified = true
      }
    }

    // Note: we don't convert devDependencies as they're not included in published packages

    if (modified) {
      fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, '\t') + '\n')
    } else {
      console.log('  (no workspace:* references)')
    }
  }

  console.log('\n🚀 Running changeset publish...\n')

  try {
    const { stdout, stderr } = await execAsync('bunx changeset publish', {
      cwd: ROOT_DIR,
      env: { ...process.env },
    })

    if (stdout) console.log(stdout)
    if (stderr) console.error(stderr)

    console.log('\n✅ Publish completed successfully')
  } catch (error: any) {
    console.error('\n❌ Publish failed:', error.message)
    if (error.stdout) console.log('stdout:', error.stdout)
    if (error.stderr) console.error('stderr:', error.stderr)
  } finally {
    // Always restore originals
    console.log('\n🔄 Restoring original package.json files...')
    for (const [packageJsonPath, original] of originals) {
      fs.writeFileSync(packageJsonPath, original)
    }
    console.log('✅ Restored')
  }
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
