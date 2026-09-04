import { expect, test } from "bun:test";
import {
	existsSync,
	mkdtempSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "../..");
const questpieRoot = join(repositoryRoot, "packages/questpie");
const adapterRoot = join(repositoryRoot, "packages/opentelemetry");
const releaseVersion = "4.0.0-beta.1";
const packageIsolationTest =
	process.env.QUESTPIE_OTEL05_PACKAGE_ISOLATION === "1" ? test : test.skip;

type PackageManifest = Readonly<{
	name: string;
	version: string;
	dependencies?: Readonly<Record<string, string>>;
	peerDependencies?: Readonly<Record<string, string>>;
}>;

function manifest(root: string): PackageManifest {
	return JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
}

function files(root: string): string[] {
	return readdirSync(root)
		.flatMap((entry) => {
			const path = join(root, entry);
			return statSync(path).isDirectory() ? files(path) : [path];
		})
		.sort();
}

function run(command: readonly string[], cwd: string): void {
	const result = Bun.spawnSync(command, {
		cwd,
		env: {
			...process.env,
			OTEL_METRICS_EXPORTER: "none",
			OTEL_TRACES_EXPORTER: "none",
		},
		stderr: "pipe",
		stdout: "pipe",
	});
	expect(
		result.exitCode,
		`${command.join(" ")} failed:\n${result.stdout.toString()}${result.stderr.toString()}`,
	).toBe(0);
}

packageIsolationTest(
	"installs the exact-peer adapter without leaking OpenTelemetry into core",
	() => {
		expect(
			existsSync(join(adapterRoot, "package.json")),
			"OTEL-05 requires the publishable questpie-opentelemetry package",
		).toBe(true);

		const core = manifest(questpieRoot);
		const adapter = manifest(adapterRoot);
		expect(core).toMatchObject({ name: "questpie", version: releaseVersion });
		expect(adapter).toMatchObject({
			name: "questpie-opentelemetry",
			version: releaseVersion,
			peerDependencies: { questpie: releaseVersion },
		});
		expect(Object.keys(adapter.peerDependencies ?? {})).toEqual(["questpie"]);
		expect(Object.keys(core.dependencies ?? {})).not.toContain(
			"questpie-opentelemetry",
		);
		expect(
			Object.keys(core.dependencies ?? {}).some((name) =>
				name.startsWith("@opentelemetry/"),
			),
		).toBe(false);

		const coreFiles = [
			join(questpieRoot, "package.json"),
			...files(join(questpieRoot, "cli")),
			...files(join(questpieRoot, "src")),
			...(existsSync(join(questpieRoot, "dist"))
				? files(join(questpieRoot, "dist"))
				: []),
		].filter((path) => /\.(?:d\.ts|js|json|ts)$/u.test(path));
		for (const path of coreFiles) {
			const source = readFileSync(path, "utf8");
			const ownsExplicitCliResolution =
				path === join(questpieRoot, "cli/telemetry.ts") ||
				path === join(questpieRoot, "dist/cli.js");
			expect(
				source.match(/["']questpie-opentelemetry["']/gu) ?? [],
				path,
			).toHaveLength(ownsExplicitCliResolution ? 1 : 0);
			expect(source, path).not.toContain("@questpie/opentelemetry");
			expect(source, path).not.toContain("@opentelemetry/");
		}

		const temporary = mkdtempSync(join(tmpdir(), "questpie-otel05-package-"));
		try {
			const packed = join(temporary, "packed");
			mkdirSync(packed);
			for (const root of [questpieRoot, adapterRoot])
				run(
					[
						"bun",
						"pm",
						"pack",
						"--destination",
						packed,
						"--ignore-scripts",
						"--quiet",
					],
					root,
				);

			const tarballs = readdirSync(packed).map((name) => join(packed, name));
			const questpieTarball = tarballs.find((path) =>
				basename(path).startsWith(`questpie-${releaseVersion}`),
			);
			const adapterTarball = tarballs.find((path) =>
				basename(path).startsWith(`questpie-opentelemetry-${releaseVersion}`),
			);
			expect(questpieTarball).toBeDefined();
			expect(adapterTarball).toBeDefined();

			const consumer = join(temporary, "consumer");
			mkdirSync(consumer);
			writeFileSync(
				join(consumer, "package.json"),
				JSON.stringify({
					name: "otel05-clean-consumer",
					private: true,
					type: "module",
					dependencies: {
						questpie: questpieTarball,
						"questpie-opentelemetry": adapterTarball,
					},
				}),
			);
			run(["bun", "install", "--ignore-scripts", "--no-cache"], consumer);
			const installedAdapter = join(
				consumer,
				"node_modules",
				"questpie-opentelemetry",
			);
			const shippedSource = files(installedAdapter)
				.filter((path) => /\.(?:d\.ts|js)$/u.test(path))
				.map((path) => readFileSync(path, "utf8"))
				.join("\n");
			for (const forbiddenTestHook of [
				"beforeSpanEvent",
				"InMemoryMetricExporter",
				"InMemorySpanExporter",
				"metricExporter?:",
				"spanExporter?:",
			])
				expect(shippedSource).not.toContain(forbiddenTestHook);
			writeFileSync(
				join(consumer, "verify.ts"),
				`import * as adapterPackage from "questpie-opentelemetry";
import { createOpenTelemetry } from "questpie-opentelemetry";
import {
  bindOfficialQuestpieObservability,
} from "questpie/internal/observability";

const telemetry = await createOpenTelemetry();
if (JSON.stringify(Object.keys(adapterPackage)) !== JSON.stringify(["createOpenTelemetry"])) {
  throw new Error("adapter package exports an unexpected runtime surface");
}
const metadata = {
  format: "questpie.observation-runtime-metadata",
  version: 1,
  applicationIdentity: "application:clean-consumer",
  runtimeBuildDigest: "a".repeat(64),
  runtimeInstanceId: "01234567-89ab-4def-8123-456789abcdef",
  signalProjectionDigest: "b2138ccb6f40f0a95df1573848fb239124b57420609e6f9f9d97d378b6a62d58",
  questpieVersion: "${releaseVersion}",
} as const;
const mismatched = await createOpenTelemetry();
try {
  bindOfficialQuestpieObservability(mismatched, {
    ...metadata,
    questpieVersion: "4.0.0-beta.2",
  } as never);
  throw new Error("exact-peer Runtime metadata mismatch was accepted");
} catch (error) {
  if (!(error instanceof TypeError) || !error.message.includes("metadata is incompatible")) throw error;
} finally {
  await mismatched.close();
}
bindOfficialQuestpieObservability(telemetry, metadata);
try {
  bindOfficialQuestpieObservability(telemetry, metadata);
  throw new Error("official handle allowed a second Runtime binding");
} catch (error) {
  if (!(error instanceof TypeError) || !error.message.includes("already bound")) throw error;
}
try {
  bindOfficialQuestpieObservability({} as never, metadata);
  throw new Error("structural observation forgery was accepted");
} catch (error) {
  if (!(error instanceof TypeError) || !error.message.includes("incompatible")) throw error;
}
const firstClose = telemetry.close();
const secondClose = telemetry.close();
if (firstClose !== secondClose) throw new Error("concurrent close did not share one promise");
await firstClose;
`,
			);
			run(["bun", "run", "verify.ts"], consumer);
		} finally {
			rmSync(temporary, { force: true, recursive: true });
		}
	},
	60_000,
);
