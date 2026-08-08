import { readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";

import ts from "typescript";

const ROOT = resolve(import.meta.dir, "..");
const SOURCE_ROOTS = [
	"packages/admin/src/server",
	"packages/questpie/src/server",
	"packages/sandbox/src",
];

/**
 * F09 allowlist: these are deliberate console boundaries, not framework
 * diagnostics. Keep entries file-specific so a new runtime console call cannot
 * hide behind a broad directory exemption.
 */
const ALLOWLIST = new Map<string, string>([
	[
		"packages/questpie/src/server/migration/generator.ts",
		"migration CLI progress output",
	],
	[
		"packages/questpie/src/server/migration/runner.ts",
		"migration CLI progress output",
	],
	["packages/questpie/src/server/seed/runner.ts", "seed CLI progress output"],
	[
		"packages/questpie/src/server/modules/core/integrated/executor/adapters/in-process.ts",
		"sandbox console capture and restoration",
	],
	[
		"packages/questpie/src/server/modules/core/integrated/mailer/adapters/console.adapter.ts",
		"explicit mail console adapter",
	],
	[
		"packages/questpie/src/server/modules/core/integrated/mailer/adapters/smtp.adapter.ts",
		"explicit development email preview sink",
	],
	["packages/sandbox/src/guest-entry.ts", "sandbox guest console capture"],
	["packages/sandbox/src/sandbox-server.ts", "sandbox process console sink"],
]);

const SOURCE_FILE = /\.(?:c|m)?(?:j|t)sx?$/;
const CONSOLE_METHODS = new Set([
	"debug",
	"error",
	"info",
	"log",
	"trace",
	"warn",
]);

function walk(dir: string): string[] {
	return readdirSync(dir).flatMap((entry) => {
		const path = resolve(dir, entry);
		return statSync(path).isDirectory() ? walk(path) : [path];
	});
}

export function findRuntimeConsoleCalls(): Array<{
	file: string;
	line: number;
}> {
	const violations: Array<{ file: string; line: number }> = [];
	for (const sourceRoot of SOURCE_ROOTS) {
		for (const file of walk(resolve(ROOT, sourceRoot))) {
			if (!SOURCE_FILE.test(file)) continue;
			const relativeFile = relative(ROOT, file);
			if (ALLOWLIST.has(relativeFile)) continue;

			const source = readFileSync(file, "utf8");
			const sourceFile = ts.createSourceFile(
				file,
				source,
				ts.ScriptTarget.Latest,
				true,
				file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
			);
			const visit = (node: ts.Node): void => {
				if (
					ts.isCallExpression(node) &&
					ts.isPropertyAccessExpression(node.expression) &&
					ts.isIdentifier(node.expression.expression) &&
					node.expression.expression.text === "console" &&
					CONSOLE_METHODS.has(node.expression.name.text)
				) {
					const line =
						sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
					violations.push({ file: relativeFile, line });
				}
				ts.forEachChild(node, visit);
			};
			visit(sourceFile);
		}
	}
	return violations;
}

if (import.meta.main) {
	const violations = findRuntimeConsoleCalls();
	if (violations.length > 0) {
		console.error(
			"F09 failed: direct console calls in server runtime sources:",
		);
		for (const violation of violations) {
			console.error(`  ${violation.file}:${violation.line}`);
		}
		console.error(
			"Route diagnostics through ctx.logger, app.logger, or an injected structural logger.",
		);
		process.exit(1);
	}

	console.log("✓ F09 runtime console gate passed");
	for (const [file, reason] of ALLOWLIST) {
		console.log(`  allowed: ${file} — ${reason}`);
	}
}
