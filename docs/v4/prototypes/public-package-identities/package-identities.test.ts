import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	cpSync,
	existsSync,
	mkdtempSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const prototypeRoot = import.meta.dir;

type PackageManifest = Readonly<{
	name: string;
	exports: Readonly<Record<string, unknown>>;
	peerDependencies?: Readonly<Record<string, string>>;
	peerDependenciesMeta?: Readonly<
		Record<string, Readonly<{ optional?: boolean }>>
	>;
}>;

function manifest(
	name: "questpie" | "questpie-opentelemetry",
): PackageManifest {
	return JSON.parse(
		readFileSync(
			resolve(prototypeRoot, "packages", name, "package.json"),
			"utf8",
		),
	) as PackageManifest;
}

function stage(
	root: string,
	name: "questpie" | "questpie-opentelemetry",
): void {
	const target = join(root, "node_modules", name);
	mkdirSync(target, { recursive: true });
	cpSync(resolve(prototypeRoot, "packages", name), target, { recursive: true });
}

function run(root: string, source: string): ReturnType<typeof Bun.spawnSync> {
	return Bun.spawnSync(["bun", "--eval", source], {
		cwd: root,
		stderr: "pipe",
		stdout: "pipe",
	});
}

function pack(packageRoot: string, destination: string): string {
	mkdirSync(destination, { recursive: true });
	const result = Bun.spawnSync(
		["bun", "pm", "pack", "--destination", destination],
		{ cwd: packageRoot, stderr: "pipe", stdout: "pipe" },
	);
	expect(result.exitCode, result.stderr?.toString() ?? "").toBe(0);
	const files = readdirSync(destination);
	expect(files).toHaveLength(1);
	return join(destination, files[0]!);
}

function sha256(path: string): string {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function install(root: string): ReturnType<typeof Bun.spawnSync> {
	return Bun.spawnSync(
		["bun", "install", "--offline", "--ignore-scripts", "--no-cache"],
		{ cwd: root, stderr: "pipe", stdout: "pipe" },
	);
}

function writeReact(root: string, version: string): void {
	const reactRoot = join(root, "react");
	mkdirSync(reactRoot, { recursive: true });
	writeFileSync(
		join(reactRoot, "package.json"),
		JSON.stringify({
			name: "react",
			version,
			type: "module",
			exports: "./index.js",
		}),
	);
	writeFileSync(
		join(reactRoot, "index.js"),
		"export const useSyncExternalStore = (_subscribe, getSnapshot) => getSnapshot();\n",
	);
}

test("two public packages keep optional projections explicit and fail closed", () => {
	const core = manifest("questpie");
	const telemetry = manifest("questpie-opentelemetry");
	expect(core).toMatchObject({
		name: "questpie",
		exports: {
			".": "./index.js",
			"./react": "./react.js",
			"./internal/observability": "./internal-observability.js",
		},
		peerDependencies: { react: "^19.2.0" },
		peerDependenciesMeta: { react: { optional: true } },
	});
	expect(telemetry).toMatchObject({
		name: "questpie-opentelemetry",
		exports: { ".": "./index.js" },
		peerDependencies: { questpie: "4.0.0-beta.2" },
	});
	expect(core.exports["."]).toBe("./index.js");
	expect(core.exports["./react"]).toBe("./react.js");
	expect(core.exports["./internal/observability"]).toBe(
		"./internal-observability.js",
	);
	expect(Object.keys(telemetry.exports)).toEqual(["."]);

	const temporary = mkdtempSync(join(tmpdir(), "questpie-package-identities-"));
	const telemetryOnly = mkdtempSync(
		join(tmpdir(), "questpie-package-identities-telemetry-only-"),
	);
	try {
		writeFileSync(
			join(telemetryOnly, "package.json"),
			JSON.stringify({ private: true, type: "module" }),
		);
		stage(telemetryOnly, "questpie-opentelemetry");
		const missingCore = run(
			telemetryOnly,
			'import { createOpenTelemetry } from "questpie-opentelemetry"; void createOpenTelemetry',
		);
		expect(missingCore.exitCode).not.toBe(0);

		writeFileSync(
			join(temporary, "package.json"),
			JSON.stringify({ private: true, type: "module" }),
		);
		stage(temporary, "questpie");

		const rootOnly = run(
			temporary,
			'import { identity } from "questpie"; if (identity !== "questpie") process.exit(1)',
		);
		expect(rootOnly.exitCode, rootOnly.stderr?.toString() ?? "").toBe(0);
		expect(existsSync(join(temporary, "node_modules", "react"))).toBe(false);
		expect(
			existsSync(join(temporary, "node_modules", "questpie-opentelemetry")),
		).toBe(false);

		const missingReact = run(
			temporary,
			'import { useQueryResource } from "questpie/react"; void useQueryResource',
		);
		expect(missingReact.exitCode).not.toBe(0);

		const reactRoot = join(temporary, "node_modules", "react");
		mkdirSync(reactRoot, { recursive: true });
		writeFileSync(
			join(reactRoot, "package.json"),
			JSON.stringify({
				name: "react",
				version: "19.2.8",
				type: "module",
				exports: "./index.js",
			}),
		);
		writeFileSync(
			join(reactRoot, "index.js"),
			"export const useSyncExternalStore = (_subscribe, getSnapshot) => getSnapshot();\n",
		);
		const withReact = run(
			temporary,
			'import { useQueryResource } from "questpie/react"; const value = useQueryResource({ subscribe: () => () => {}, getSnapshot: () => "ready" }); if (value !== "ready") process.exit(1)',
		);
		expect(withReact.exitCode, withReact.stderr?.toString() ?? "").toBe(0);

		stage(temporary, "questpie-opentelemetry");
		const withTelemetry = run(
			temporary,
			'import { createOpenTelemetry } from "questpie-opentelemetry"; const value = createOpenTelemetry(); if (value.questpieIdentity !== "questpie") process.exit(1)',
		);
		expect(withTelemetry.exitCode, withTelemetry.stderr?.toString() ?? "").toBe(
			0,
		);

		for (const oldName of ["@questpie/react", "@questpie/opentelemetry"]) {
			const oldImport = run(
				temporary,
				`await import(${JSON.stringify(oldName)})`,
			);
			expect(oldImport.exitCode, oldName).not.toBe(0);
		}
	} finally {
		rmSync(temporary, { force: true, recursive: true });
		rmSync(telemetryOnly, { force: true, recursive: true });
	}
});

test("packed candidate is deterministic, relocatable, and peer ranges fail closed", () => {
	const temporary = mkdtempSync(
		join(tmpdir(), "questpie-package-identities-packed-"),
	);
	try {
		const coreRoot = resolve(prototypeRoot, "packages", "questpie");
		const telemetryRoot = resolve(
			prototypeRoot,
			"packages",
			"questpie-opentelemetry",
		);
		const coreFirst = pack(coreRoot, join(temporary, "pack-core-first"));
		const coreSecond = pack(coreRoot, join(temporary, "pack-core-second"));
		const telemetryFirst = pack(
			telemetryRoot,
			join(temporary, "pack-telemetry-first"),
		);
		const telemetrySecond = pack(
			telemetryRoot,
			join(temporary, "pack-telemetry-second"),
		);
		expect(sha256(coreFirst)).toBe(sha256(coreSecond));
		expect(sha256(telemetryFirst)).toBe(sha256(telemetrySecond));

		const coreOnly = join(temporary, "core-only");
		mkdirSync(coreOnly, { recursive: true });
		writeFileSync(
			join(coreOnly, "package.json"),
			JSON.stringify({
				private: true,
				type: "module",
				dependencies: { questpie: `file:${coreFirst}` },
			}),
		);
		const coreInstalled = install(coreOnly);
		expect(coreInstalled.exitCode, coreInstalled.stderr?.toString() ?? "").toBe(
			0,
		);
		expect(run(coreOnly, 'await import("questpie")').exitCode).toBe(0);
		expect(run(coreOnly, 'await import("questpie/react")').exitCode).not.toBe(
			0,
		);

		const consumer = join(temporary, "consumer");
		mkdirSync(consumer, { recursive: true });
		writeReact(consumer, "19.2.8");
		writeFileSync(
			join(consumer, "package.json"),
			JSON.stringify({
				private: true,
				type: "module",
				dependencies: {
					questpie: `file:${coreFirst}`,
					"questpie-opentelemetry": `file:${telemetryFirst}`,
					react: "file:./react",
				},
			}),
		);
		const installed = install(consumer);
		expect(installed.exitCode, installed.stderr?.toString() ?? "").toBe(0);
		const imports = run(
			consumer,
			'import { identity } from "questpie"; import { useQueryResource } from "questpie/react"; import { createOpenTelemetry } from "questpie-opentelemetry"; if (identity !== "questpie" || typeof useQueryResource !== "function" || createOpenTelemetry().questpieIdentity !== identity) process.exit(1)',
		);
		expect(imports.exitCode, imports.stderr?.toString() ?? "").toBe(0);

		const core = manifest("questpie");
		const telemetry = manifest("questpie-opentelemetry");
		expect(Bun.semver.satisfies("19.2.8", core.peerDependencies!.react!)).toBe(
			true,
		);
		expect(Bun.semver.satisfies("18.3.1", core.peerDependencies!.react!)).toBe(
			false,
		);
		expect(
			Bun.semver.satisfies(
				"4.0.0-beta.1",
				telemetry.peerDependencies!.questpie!,
			),
		).toBe(false);
	} finally {
		rmSync(temporary, { force: true, recursive: true });
	}
});
