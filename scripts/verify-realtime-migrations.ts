import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = join(import.meta.dirname, "..");
const cli = join(root, "packages/questpie/src/exports/cli.ts");

const targets = [
	{
		name: "city-portal",
		cwd: join(root, "examples/city-portal"),
		config: "src/questpie/server/questpie.config.ts",
		migrations: "src/questpie/server/migrations",
	},
	{
		name: "tanstack-barbershop",
		cwd: join(root, "examples/tanstack-barbershop"),
		config: "src/questpie/server/questpie.config.ts",
		migrations: "src/questpie/server/migrations",
	},
] as const;

function migrationTreeDigest(directory: string): string {
	const hash = createHash("sha256");
	const visit = (current: string) => {
		for (const entry of readdirSync(current, { withFileTypes: true }).sort(
			(left, right) => left.name.localeCompare(right.name),
		)) {
			const path = join(current, entry.name);
			if (entry.isDirectory()) {
				visit(path);
				continue;
			}
			if (!entry.isFile()) continue;
			hash.update(relative(directory, path));
			hash.update("\0");
			hash.update(readFileSync(path));
			hash.update("\0");
		}
	};
	visit(directory);
	return hash.digest("hex");
}

function generate(target: (typeof targets)[number], pass: number): void {
	const result = spawnSync(
		"bun",
		[
			cli,
			"migrate:generate",
			"--config",
			target.config,
			"--name",
			`realtime-idempotency-${pass}`,
			"--non-interactive",
		],
		{
			cwd: target.cwd,
			encoding: "utf8",
			env: process.env,
		},
	);

	if (result.status === 0) return;
	process.stderr.write(result.stdout);
	process.stderr.write(result.stderr);
	throw new Error(
		`${target.name}: migrate:generate pass ${pass} exited with ${result.status}`,
	);
}

let failed = false;
for (const target of targets) {
	const directory = join(target.cwd, target.migrations);
	const before = migrationTreeDigest(directory);
	generate(target, 1);
	const afterFirst = migrationTreeDigest(directory);
	generate(target, 2);
	const afterSecond = migrationTreeDigest(directory);

	if (afterFirst !== afterSecond) {
		console.error(
			`✗ ${target.name}: the second migrate:generate changed the migration tree`,
		);
		failed = true;
		continue;
	}
	if (before !== afterFirst) {
		console.error(
			`✗ ${target.name}: committed migrations do not match the current schema`,
		);
		failed = true;
		continue;
	}
	console.log(`✓ ${target.name}: migrate:generate is clean and idempotent`);
}

process.exit(failed ? 1 : 0);
