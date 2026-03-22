#!/usr/bin/env bun
/**
 * QuestPie monorepo validation runner.
 *
 * Stages (in order): codegen -> build -> types -> exports -> tests
 * Each stage runs packages in topological (dependency) order.
 *
 * Usage:
 *   bun validate                      # run all stages
 *   bun validate --stage build        # run a single stage
 *   bun validate --skip tests         # skip stages (comma-separated)
 *   bun validate --package questpie   # run only a specific package
 *   bun validate --filter quest       # filter packages by name substring
 *   bun validate --types-only         # shorthand for --stage types
 *   bun validate --no-build           # skip codegen + build
 *   bun validate --verbose            # show output for passing stages too
 *   bun validate --json               # output machine-readable JSON
 *   bun validate --test-pattern "hook"  # pass pattern to test runner
 */

import { readFileSync, existsSync, readdirSync } from "node:fs"
import { resolve, join } from "node:path"
import { spawnSync } from "node:child_process"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WorkspacePackage {
  dir: string
  path: string
  name: string
  localDeps: string[]
  scripts: Record<string, string>
  /** package.json exports field */
  exports?: Record<string, unknown>
}

type Stage = "codegen" | "build" | "types" | "exports" | "tests"

interface StageResult {
  stage: Stage
  pkg: string
  ok: boolean
  skipped: boolean
  durationMs: number
  output?: string
}

interface JsonOutput {
  ok: boolean
  stages: Stage[]
  packages: string[]
  results: StageResult[]
  summary: {
    passed: number
    failed: number
    skipped: number
    durationMs: number
  }
}

const STAGE_SCRIPT: Record<Stage, string | null> = {
  codegen: "questpie:generate",
  build: "build",
  types: "check-types",
  exports: null, // custom validation, not a script
  tests: "test",
}

const ALL_STAGES: Stage[] = ["codegen", "build", "types", "exports", "tests"]

// ---------------------------------------------------------------------------
// Workspace discovery
// ---------------------------------------------------------------------------

function discoverWorkspaces(rootDir: string): WorkspacePackage[] {
  const packagesDir = join(rootDir, "packages")

  const dirs: string[] = []
  for (const entry of readdirSync(packagesDir)) {
    const pkgJsonPath = join(packagesDir, entry, "package.json")
    if (existsSync(pkgJsonPath)) {
      dirs.push(entry)
    }
  }

  const packages: WorkspacePackage[] = []
  for (const dir of dirs) {
    const pkgPath = join(packagesDir, dir)
    const pkgJson = JSON.parse(readFileSync(join(pkgPath, "package.json"), "utf-8"))
    const allDeps = {
      ...pkgJson.dependencies,
      ...pkgJson.devDependencies,
      ...pkgJson.peerDependencies,
    }
    const localDeps = Object.entries(allDeps)
      .filter(([_, v]) => typeof v === "string" && (v as string).startsWith("workspace:"))
      .map(([k]) => k)

    packages.push({
      dir,
      path: pkgPath,
      name: pkgJson.name,
      localDeps,
      scripts: pkgJson.scripts ?? {},
      exports: pkgJson.exports,
    })
  }

  return packages
}

// ---------------------------------------------------------------------------
// Topological sort (Kahn's algorithm)
// ---------------------------------------------------------------------------

function topoSort(packages: WorkspacePackage[]): WorkspacePackage[] {
  const byName = new Map(packages.map((p) => [p.name, p]))
  const inDegree = new Map(packages.map((p) => [p.name, 0]))

  const dependents = new Map<string, string[]>()
  for (const pkg of packages) {
    for (const dep of pkg.localDeps) {
      if (byName.has(dep)) {
        inDegree.set(pkg.name, (inDegree.get(pkg.name) ?? 0) + 1)
        const list = dependents.get(dep) ?? []
        list.push(pkg.name)
        dependents.set(dep, list)
      }
    }
  }

  const queue: string[] = []
  for (const [name, degree] of inDegree) {
    if (degree === 0) queue.push(name)
  }
  queue.sort()

  const sorted: WorkspacePackage[] = []
  while (queue.length > 0) {
    const current = queue.shift()!
    sorted.push(byName.get(current)!)

    for (const dep of (dependents.get(current) ?? []).sort()) {
      const newDeg = (inDegree.get(dep) ?? 1) - 1
      inDegree.set(dep, newDeg)
      if (newDeg === 0) {
        const idx = queue.findIndex((q) => q > dep)
        if (idx === -1) queue.push(dep)
        else queue.splice(idx, 0, dep)
      }
    }
  }

  if (sorted.length !== packages.length) {
    const missing = packages.filter((p) => !sorted.includes(p)).map((p) => p.name)
    throw new Error(`Cyclic dependency detected involving: ${missing.join(", ")}`)
  }

  return sorted
}

// ---------------------------------------------------------------------------
// Export validation
// ---------------------------------------------------------------------------

function validateExports(pkg: WorkspacePackage): StageResult {
  const start = performance.now()
  const errors: string[] = []

  // Check that package.json exports field exists
  if (!pkg.exports || Object.keys(pkg.exports).length === 0) {
    return { stage: "exports", pkg: pkg.dir, ok: true, skipped: true, durationMs: 0 }
  }

  // Validate each export entry points to an existing file
  // Skip glob/wildcard patterns (e.g., "./*")
  for (const [key, value] of Object.entries(pkg.exports)) {
    if (key.includes("*")) continue // glob pattern — skip

    if (typeof value === "string") {
      if (!value.includes("*")) {
        const filePath = join(pkg.path, value)
        if (!existsSync(filePath)) {
          errors.push(`Export "${key}" → "${value}" — file not found`)
        }
      }
    } else if (typeof value === "object" && value !== null) {
      for (const [condition, target] of Object.entries(value as Record<string, string>)) {
        if (typeof target === "string" && !target.includes("*")) {
          const filePath = join(pkg.path, target)
          if (!existsSync(filePath)) {
            errors.push(`Export "${key}".${condition} → "${target}" — file not found`)
          }
        }
      }
    }
  }

  // Check .generated/ files exist and are parseable
  const generatedDirs = findGeneratedDirs(pkg.path)
  for (const genDir of generatedDirs) {
    const moduleFile = join(genDir, "module.ts")
    if (existsSync(moduleFile)) {
      try {
        const content = readFileSync(moduleFile, "utf-8")
        // Basic check: file has the auto-generated header
        if (!content.includes("AUTO-GENERATED")) {
          errors.push(`${moduleFile.replace(pkg.path + "/", "")} — missing AUTO-GENERATED header`)
        }
        // Check it has a default export
        if (!content.includes("export default") && !content.includes("export {")) {
          errors.push(`${moduleFile.replace(pkg.path + "/", "")} — no export found`)
        }
      } catch (e) {
        errors.push(`${moduleFile.replace(pkg.path + "/", "")} — failed to read: ${e}`)
      }
    }
  }

  const durationMs = Math.round(performance.now() - start)

  if (errors.length > 0) {
    return {
      stage: "exports",
      pkg: pkg.dir,
      ok: false,
      skipped: false,
      durationMs,
      output: errors.join("\n"),
    }
  }

  return { stage: "exports", pkg: pkg.dir, ok: true, skipped: false, durationMs }
}

function findGeneratedDirs(pkgPath: string): string[] {
  const results: string[] = []
  const srcDir = join(pkgPath, "src")
  if (!existsSync(srcDir)) return results

  function walk(dir: string) {
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (entry.name === ".generated") {
            results.push(join(dir, entry.name))
          } else if (!entry.name.startsWith("node_modules")) {
            walk(join(dir, entry.name))
          }
        }
      }
    } catch {}
  }

  walk(srcDir)
  return results
}

// ---------------------------------------------------------------------------
// Stage runner
// ---------------------------------------------------------------------------

function runStage(stage: Stage, pkg: WorkspacePackage, testPattern?: string): StageResult {
  // Export validation is custom (not a script)
  if (stage === "exports") {
    return validateExports(pkg)
  }

  const scriptName = STAGE_SCRIPT[stage]
  if (!scriptName || !(scriptName in pkg.scripts)) {
    return { stage, pkg: pkg.dir, ok: true, skipped: true, durationMs: 0 }
  }

  const start = performance.now()

  // Build command args
  const args = ["run", scriptName]
  if (stage === "tests" && testPattern) {
    args.push("--", "--test-name-pattern", testPattern)
  }

  const result = spawnSync("bun", args, {
    cwd: pkg.path,
    stdio: "pipe",
    env: { ...process.env, QUESTPIE_MIGRATIONS_SILENT: "1" },
    timeout: 5 * 60 * 1000,
  })
  const durationMs = Math.round(performance.now() - start)

  const stdout = result.stdout?.toString() ?? ""
  const stderr = result.stderr?.toString() ?? ""
  const output = (stdout + "\n" + stderr).trim()

  return {
    stage,
    pkg: pkg.dir,
    ok: result.status === 0,
    skipped: false,
    durationMs,
    output: result.status !== 0 ? output : (undefined as string | undefined),
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface ParsedArgs {
  stages: Stage[]
  filterPackage: string | null
  filterSubstring: string | null
  verbose: boolean
  json: boolean
  testPattern: string | null
}

function parseArgs(args: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    stages: [...ALL_STAGES],
    filterPackage: null,
    filterSubstring: null,
    verbose: false,
    json: false,
    testPattern: null,
  }

  const skipStages: Stage[] = []

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === "--stage" && args[i + 1]) {
      parsed.stages = [args[++i] as Stage]
    } else if (arg === "--skip" && args[i + 1]) {
      skipStages.push(...(args[++i].split(",") as Stage[]))
    } else if (arg === "--package" && args[i + 1]) {
      parsed.filterPackage = args[++i]
    } else if (arg === "--filter" && args[i + 1]) {
      parsed.filterSubstring = args[++i]
    } else if (arg === "--types-only") {
      parsed.stages = ["types"]
    } else if (arg === "--no-build") {
      skipStages.push("codegen", "build")
    } else if (arg === "--verbose") {
      parsed.verbose = true
    } else if (arg === "--json") {
      parsed.json = true
    } else if ((arg === "--test-pattern" || arg === "--test") && args[i + 1]) {
      parsed.testPattern = args[++i]
    }
  }

  parsed.stages = parsed.stages.filter((s) => !skipStages.includes(s))
  return parsed
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const rootDir = resolve(import.meta.dir, "..")
  const args = parseArgs(process.argv.slice(2))

  let packages = topoSort(discoverWorkspaces(rootDir))

  if (args.filterPackage) {
    packages = packages.filter((p) => p.dir === args.filterPackage)
    if (packages.length === 0) {
      console.error(`Package "${args.filterPackage}" not found`)
      process.exit(1)
    }
  }

  if (args.filterSubstring) {
    const sub = args.filterSubstring.toLowerCase()
    packages = packages.filter(
      (p) => p.dir.toLowerCase().includes(sub) || p.name.toLowerCase().includes(sub),
    )
    if (packages.length === 0) {
      console.error(`No packages match filter "${args.filterSubstring}"`)
      process.exit(1)
    }
  }

  if (!args.json) {
    console.log(`\n  Validate: ${args.stages.join(" → ")}`)
    console.log(`  Packages: ${packages.map((p) => p.dir).join(", ")}\n`)
  }

  const results: StageResult[] = []
  let failed = false

  for (const stage of args.stages) {
    if (!args.json) {
      console.log(`── ${stage} ${"─".repeat(60 - stage.length)}`)
    }

    for (const pkg of packages) {
      const result = runStage(stage, pkg, args.testPattern ?? undefined)
      results.push(result)

      if (!args.json) {
        if (result.skipped) {
          console.log(`  ${pkg.dir.padEnd(24)} skip`)
        } else if (result.ok) {
          console.log(`  ${pkg.dir.padEnd(24)} ✓  ${result.durationMs}ms`)
          if (args.verbose && result.output) {
            for (const line of result.output.split("\n").slice(-10)) {
              console.log(`    │ ${line}`)
            }
          }
        } else {
          console.log(`  ${pkg.dir.padEnd(24)} ✗  ${result.durationMs}ms`)
          if (result.output) {
            for (const line of result.output.split("\n").slice(-20)) {
              console.log(`    │ ${line}`)
            }
          }
          failed = true
        }
      } else if (!result.ok) {
        failed = true
      }
    }

    if (failed) {
      if (!args.json) {
        console.log(`\n  Pipeline stopped at "${stage}" due to failure.\n`)
      }
      break
    }

    if (!args.json) console.log()
  }

  // Summary
  const ran = results.filter((r) => !r.skipped)
  const passed = ran.filter((r) => r.ok)
  const failures = ran.filter((r) => !r.ok)
  const totalMs = ran.reduce((s, r) => s + r.durationMs, 0)

  if (args.json) {
    const output: JsonOutput = {
      ok: !failed,
      stages: args.stages,
      packages: packages.map((p) => p.dir),
      results,
      summary: {
        passed: passed.length,
        failed: failures.length,
        skipped: results.filter((r) => r.skipped).length,
        durationMs: totalMs,
      },
    }
    console.log(JSON.stringify(output, null, 2))
  } else {
    console.log("── summary ─────────────────────────────────────────────────")
    console.log(`  ${passed.length} passed, ${failures.length} failed, ${results.filter((r) => r.skipped).length} skipped  (${(totalMs / 1000).toFixed(1)}s)`)

    if (failures.length > 0) {
      console.log("\n  Failures:")
      for (const f of failures) {
        console.log(`    ${f.stage} → ${f.pkg}`)
      }
    }

    console.log()
  }

  process.exit(failed ? 1 : 0)
}

main()
