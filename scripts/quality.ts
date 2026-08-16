import { existsSync, readdirSync } from "node:fs";
import { basename, extname, resolve } from "node:path";

import { parseScenarioFilter, selectScenarioIds } from "./scenario-filter";

type Lane =
	| "changed"
	| "full"
	| "release"
	| "typescript-forward"
	| "postgres"
	| "micro"
	| "load"
	| "soak";

function fail(message: string): never {
	console.error(`quality: ${message}`);
	process.exit(1);
}

function run(command: string[]): void {
	console.log(`> ${command.join(" ")}`);
	const result = Bun.spawnSync(command, {
		stdin: "inherit",
		stdout: "inherit",
		stderr: "inherit",
	});
	if (result.exitCode !== 0) {
		fail(`${command.join(" ")} exited ${result.exitCode}`);
	}
}

function output(command: string[]): string {
	const result = Bun.spawnSync(command, { stdout: "pipe", stderr: "pipe" });
	if (result.exitCode !== 0)
		fail(`${command.join(" ")} failed: ${result.stderr.toString().trim()}`);
	return result.stdout.toString();
}

function values(flag: string, args: string[]): string[] {
	const found: string[] = [];
	for (let index = 0; index < args.length; index += 1) {
		if (args[index] === flag && args[index + 1]) {
			found.push(args[index + 1]);
			index += 1;
		}
	}
	return found;
}

function changedFiles(): string[] {
	const base = process.env.QUESTPIE_DIFF_BASE;
	const tracked = output(
		base
			? ["git", "diff", "--name-only", `${base}...HEAD`]
			: ["git", "diff", "--name-only", "HEAD"],
	);
	const untracked = output([
		"git",
		"ls-files",
		"--others",
		"--exclude-standard",
	]);
	return [
		...new Set(
			`${tracked}\n${untracked}`
				.split("\n")
				.filter((path) => path && existsSync(path)),
		),
	].sort();
}

function formatable(paths: string[]): string[] {
	const extensions = new Set([
		".css",
		".graphql",
		".html",
		".js",
		".json",
		".jsonc",
		".jsx",
		".md",
		".mdx",
		".mjs",
		".toml",
		".ts",
		".tsx",
		".yaml",
		".yml",
	]);
	return paths.filter((path) => extensions.has(extname(path)));
}

function lintable(paths: string[]): string[] {
	const extensions = new Set([".js", ".jsx", ".mjs", ".ts", ".tsx"]);
	return paths.filter((path) => extensions.has(extname(path)));
}

function gitDiffCheck(): void {
	run(["git", "diff", "--check"]);
}

function compiler(command: string[], expected: string): void {
	const version = output(command).trim();
	if (version !== `Version ${expected}`)
		fail(
			`${command.join(" ")} reported ${version}, expected Version ${expected}`,
		);
}

function changed(args: string[]): void {
	const files = changedFiles();
	if (files.length === 0)
		fail(
			"no changed files found; set QUESTPIE_DIFF_BASE for a committed change",
		);
	const formatted = formatable(files);
	const linted = lintable(files);
	if (formatted.length > 0)
		run([
			"bunx",
			"oxfmt",
			"--check",
			"--no-error-on-unmatched-pattern",
			...formatted,
		]);
	if (linted.length > 0) run(["bunx", "oxlint", "--deny-warnings", ...linted]);
	for (const test of values("--test", args)) run(["bun", "test", test]);
	for (const workspace of values("--typecheck", args))
		run(["bunx", "turbo", "run", "types:check", "--filter", workspace]);
	gitDiffCheck();
}

function full(): void {
	compiler(["bun", "node_modules/typescript/bin/tsc", "--version"], "6.0.2");
	run(["bun", "run", "architecture:check"]);
	run(["bun", "run", "format:ratchet"]);
	run(["bun", "run", "lint", "--deny-warnings"]);
	run(["bun", "run", "check-types"]);
	run(["bun", "test"]);
	run(["bun", "run", "knip:report"]);
	run(["bun", "run", "build"]);
	run(["bun", "run", "skill:check"]);
	gitDiffCheck();
}

function buildPublicPackage(): void {
	run(["bunx", "turbo", "run", "build", "--filter", "questpie"]);
}

function postgres(args: string[]): void {
	let requested: string | undefined;
	try {
		requested = parseScenarioFilter(args);
	} catch (error) {
		fail(error instanceof Error ? error.message : String(error));
	}
	const root = "tests/integration/postgres";
	if (!existsSync(root)) fail("no PostgreSQL tests exist");
	const tests = readdirSync(resolve(root), { withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith(".test.ts"))
		.map((entry) => `${root}/${entry.name}`)
		.sort();
	let roots = tests;
	if (requested) {
		const registered = tests.flatMap((path) => {
			const match = /^(beta\d+)-/.exec(basename(path));
			return match?.[1] ? [{ id: match[1], path }] : [];
		});
		let selectedIds: string[];
		try {
			selectedIds = selectScenarioIds(
				[...new Set(registered.map(({ id }) => id))],
				requested,
			);
		} catch (error) {
			fail(error instanceof Error ? error.message : String(error));
		}
		const selected = new Set(selectedIds);
		roots = registered
			.filter(({ id }) => selected.has(id))
			.map(({ path }) => path);
	}
	if (!process.env.PGHOST || !process.env.PGDATABASE || !process.env.PGUSER) {
		fail("PGHOST, PGDATABASE, and PGUSER are required for the PostgreSQL lane");
	}
	buildPublicPackage();
	for (const root of roots) run(["bun", "test", root]);
}

function scenarios(kind: "micro" | "load" | "soak", args: string[]): void {
	if (kind === "micro") buildPublicPackage();
	run(["bun", "run", "scripts/performance.ts", kind, ...args]);
}

const lane = Bun.argv[2] as Lane | undefined;
const args = Bun.argv.slice(3);
if (lane === "changed") changed(args);
else if (lane === "full") full();
else if (lane === "release") {
	full();
	run(["bun", "run", "knip:strict"]);
	run(["bun", "run", "package:check"]);
	run(["bun", "run", "scripts/performance.ts", "check"]);
} else if (lane === "typescript-forward") {
	compiler(
		["bun", "node_modules/@typescript/native/bin/tsc", "--version"],
		"7.0.2",
	);
	run([
		"bun",
		"node_modules/@typescript/native/bin/tsc",
		"--noEmit",
		"-p",
		"apps/docs/tsconfig.json",
	]);
} else if (lane === "postgres") postgres(args);
else if (lane === "micro" || lane === "load" || lane === "soak")
	scenarios(lane, args);
else
	fail(
		"lane must be changed, full, release, typescript-forward, postgres, micro, load, or soak",
	);
