import { relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");

export const VERIFY_STAGES = [
	"lint",
	"typecheck",
	"audit",
	"test",
	"build",
	"docs",
] as const;

export type VerifyStage = (typeof VERIFY_STAGES)[number];

type Command = {
	label: string;
	cmd: string[];
	env?: Record<string, string>;
};

type CommandRunner = (command: Command) => { exitCode: number };

export const COMMANDS: Record<VerifyStage, Command[]> = {
	lint: [
		{ label: "Oxlint", cmd: ["bun", "run", "lint"] },
		{
			label: "lint-census ratchet",
			cmd: ["bun", "run", "scripts/lint-census.ts"],
		},
		{
			label: "deprecated-imports ratchet",
			cmd: ["bun", "run", "scripts/deprecated-imports.ts"],
		},
		{
			label: "clone-census ratchet",
			cmd: ["bun", "run", "scripts/clone-census.ts"],
		},
		{
			label: "format",
			cmd: ["bunx", "oxfmt", "--list-different"],
		},
	],
	typecheck: [
		{
			label: "type check (all packages)",
			cmd: ["bunx", "turbo", "run", "check-types"],
		},
	],
	audit: [
		{
			label: "dependency audit",
			cmd: ["bun", "run", "scripts/audit-gate.ts"],
		},
	],
	test: [
		{
			label: "package tests",
			cmd: [
				"bunx",
				"turbo",
				"run",
				"test",
				"--filter=./packages/*",
				"--concurrency=1",
				"--ui=stream",
				"--log-order=stream",
			],
			env: { QUESTPIE_MIGRATIONS_SILENT: "1" },
		},
	],
	build: [
		{
			label: "build packages",
			cmd: ["bunx", "turbo", "run", "build", "--filter=./packages/*"],
		},
		{
			label: "dist syntax",
			cmd: ["bun", "run", "scripts/check-dist-syntax.ts"],
		},
		{
			label: "dist types",
			cmd: ["bun", "run", "scripts/check-dist-types.ts"],
		},
		{
			label: "package size budget",
			cmd: ["bun", "run", "scripts/size-budget.ts"],
		},
		{
			label: "consumer bundle budget",
			cmd: ["bun", "run", "scripts/bundle-budget.ts"],
		},
		{
			label: "type budget",
			cmd: ["bun", "run", "scripts/type-budget.ts"],
		},
		{
			label: "any-census ratchet",
			cmd: ["bun", "run", "scripts/any-census.ts"],
		},
		{
			label: "dead-modules ratchet",
			cmd: ["bun", "run", "scripts/dead-modules.ts"],
		},
		{
			label: "example-errors ratchet",
			cmd: ["bun", "run", "scripts/example-errors.ts"],
		},
		{
			label: "codegen freshness",
			cmd: ["bun", "run", "scripts/check-codegen-freshness.ts"],
		},
		{
			label: "codegen layer DAG",
			cmd: ["bun", "run", "scripts/check-codegen-layers.ts"],
		},
	],
	docs: [
		{
			label: "docs",
			cmd: ["bun", "run", "validate:docs", "--", "--docs-app"],
		},
		{
			label: "canonical skill install parity",
			cmd: ["bun", "run", "verify:skills-install"],
		},
		{
			label: "generated skill docs",
			cmd: ["bun", "run", "scripts/build-skill-docs.ts", "--check"],
		},
		{
			label: "skill coverage",
			cmd: ["bun", "run", "scripts/skill-coverage.ts", "--strict"],
		},
	],
};

function parseStage(args: string[]): VerifyStage[] {
	const stageIndex = args.indexOf("--stage");
	if (stageIndex === -1) return [...VERIFY_STAGES];

	const stage = args[stageIndex + 1];
	if (!VERIFY_STAGES.includes(stage as VerifyStage)) {
		console.error(
			`Unknown verification stage ${JSON.stringify(stage)}. Expected one of: ${VERIFY_STAGES.join(", ")}.`,
		);
		process.exit(2);
	}
	return [stage as VerifyStage];
}

export function runCommands(
	stages: VerifyStage[],
	runner: CommandRunner = (command) =>
		Bun.spawnSync({
			cmd: command.cmd,
			cwd: ROOT,
			env: { ...process.env, ...command.env },
			stdin: "inherit",
			stdout: "inherit",
			stderr: "inherit",
		}),
): number {
	const total = stages.reduce((sum, stage) => sum + COMMANDS[stage].length, 0);
	let current = 0;

	for (const stage of stages) {
		console.log(`\n=== ${stage} ===`);
		for (const command of COMMANDS[stage]) {
			current++;
			console.log(`\n[${current}/${total}] ${command.label}`);
			console.log(`$ ${command.cmd.join(" ")}`);
			const result = runner(command);
			if (result.exitCode !== 0) {
				console.error(
					`\n✗ ${command.label} failed with exit code ${result.exitCode}.`,
				);
				return result.exitCode;
			}
		}
	}

	console.log(
		`\n✓ PR verification passed (${relative(ROOT, process.cwd()) || "."})`,
	);
	return 0;
}

export function runVerification(args = Bun.argv.slice(2)): void {
	const exitCode = runCommands(parseStage(args));
	if (exitCode !== 0) process.exit(exitCode);
}

if (import.meta.main) runVerification();
