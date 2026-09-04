import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

import {
	CleanupStack,
	eventually,
	waitForOutputLine,
} from "../../packages/testkit/src";
import { normalizeOtlpTrace } from "../support/otel-protobuf";

const repositoryRoot = resolve(import.meta.dir, "../..");
const releaseVersion = "4.0.0-beta.1";
const tracer =
	process.env.QUESTPIE_OTEL06_CLI_TRACER === "1" ? test : test.skip;

async function run(
	command: readonly string[],
	cwd: string,
	environment?: Readonly<Record<string, string>>,
): Promise<void> {
	const child = Bun.spawn(command, {
		cwd,
		...(environment === undefined
			? {}
			: { env: { ...process.env, ...environment } }),
		stderr: "pipe",
		stdout: "pipe",
	});
	const exitCode = await child.exited;
	if (exitCode !== 0)
		throw new Error(
			`${command.join(" ")} failed: ${(await new Response(child.stderr).text()).trim()}`,
		);
}

async function install(
	root: string,
	dependencies: Readonly<Record<string, string>>,
): Promise<void> {
	await mkdir(root, { recursive: true });
	await writeFile(
		join(root, "package.json"),
		JSON.stringify({
			name: "otel06-tracer",
			private: true,
			type: "module",
			dependencies,
		}),
	);
	await run(["bun", "install", "--ignore-scripts", "--no-cache"], root);
}

tracer(
	"resolves telemetry from the application root and closes App before OTLP",
	async () => {
		const cleanup = new CleanupStack();
		const temporary = await mkdtemp(join(tmpdir(), "questpie-otel06-cli-"));
		cleanup.defer(() => rm(temporary, { force: true, recursive: true }));
		const requests: string[] = [];
		const traceBodies: Uint8Array[] = [];
		const traceContentTypes: string[] = [];
		const receiver = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			async fetch(request) {
				const path = new URL(request.url).pathname;
				const body = new Uint8Array(await request.arrayBuffer());
				requests.push(path);
				if (path === "/v1/traces") {
					traceBodies.push(body);
					traceContentTypes.push(request.headers.get("content-type") ?? "");
				}
				return new Response(null, { status: 200 });
			},
		});
		let receiverStopped = false;
		cleanup.defer(() => {
			if (!receiverStopped) receiver.stop(true);
		});
		let child: ReturnType<typeof Bun.spawn> | undefined;
		cleanup.defer(async () => {
			if (child !== undefined && child.exitCode === null) {
				child.kill("SIGKILL");
				await child.exited;
			}
		});
		try {
			const packed = join(temporary, "packed");
			await mkdir(packed);
			for (const packageRoot of ["packages/questpie", "packages/opentelemetry"])
				await run(
					[
						"bun",
						"pm",
						"pack",
						"--destination",
						packed,
						"--ignore-scripts",
						"--quiet",
					],
					resolve(repositoryRoot, packageRoot),
				);
			const tarballs = (await readdir(packed)).map((name) =>
				join(packed, name),
			);
			const questpie = tarballs.find((path) =>
				basename(path).startsWith(`questpie-${releaseVersion}`),
			);
			const opentelemetry = tarballs.find((path) =>
				basename(path).startsWith(`questpie-opentelemetry-${releaseVersion}`),
			);
			expect(questpie).toBeDefined();
			expect(opentelemetry).toBeDefined();

			const cliRoot = join(temporary, "cli-install");
			const applicationRoot = join(temporary, "application");
			await install(cliRoot, { questpie: questpie! });
			await install(applicationRoot, {
				questpie: questpie!,
				"questpie-opentelemetry": opentelemetry!,
			});
			const generated = join(applicationRoot, ".questpie/generated/internal");
			await mkdir(generated, { recursive: true });
			await writeFile(
				join(generated, "application.js"),
				`import { bindOfficialQuestpieObservability } from "questpie/internal/observability";
export const bindIngressPrincipalForRequest = (request) => request;
export async function createApplication(input) {
  const adapter = input.observability === undefined ? null : bindOfficialQuestpieObservability(input.observability, {
    format: "questpie.observation-runtime-metadata",
    version: 1,
    applicationIdentity: "application:otel06-cli",
    runtimeBuildDigest: "${"a".repeat(64)}",
    runtimeInstanceId: "01234567-89ab-4def-8123-456789abcdef",
    signalProjectionDigest: "b2138ccb6f40f0a95df1573848fb239124b57420609e6f9f9d97d378b6a62d58",
    questpieVersion: "${releaseVersion}",
  });
  return {
    async fetch() {
      if (adapter === null) return new Response("ok-no-telemetry");
      const execution = adapter.begin({ entry: "fetch", kind: "execution", principalKind: "anonymous", trace: { kind: "root" } });
      return execution.run(async () => {
        const query = adapter.begin({ entry: "fetch", kind: "query", principalKind: "anonymous", resourceIdentity: "query:otel06.health", trace: { kind: "active-parent" } });
        await query.run(async () => undefined);
        query.end({ kind: "query", outcome: "ok" });
        execution.end({ kind: "execution", outcome: "ok" });
        return new Response("ok");
      });
    },
    async close() {
      try { await fetch(process.env.QUESTPIE_OTEL06_CONTROL_URL, { method: "POST" }); }
      catch { /* Receiver loss cannot change App cleanup. */ }
    },
  };
}
`,
			);
			child = Bun.spawn(
				[
					"bun",
					join(cliRoot, "node_modules/questpie/dist/cli.js"),
					"start",
					"--telemetry=opentelemetry",
					"--port=0",
				],
				{
					cwd: applicationRoot,
					env: {
						...process.env,
						DATABASE_URL: "postgres://localhost/otel06",
						QUESTPIE_REALTIME_HMAC_KEY: "ab".repeat(32),
						QUESTPIE_OTEL06_CONTROL_URL: `${receiver.url}control/app-close`,
						OTEL_EXPORTER_OTLP_ENDPOINT: receiver.url.href,
						OTEL_METRICS_EXPORTER: "otlp",
						OTEL_TRACES_EXPORTER: "otlp",
					},
					stderr: "pipe",
					stdout: "pipe",
				},
			);
			const ready = await waitForOutputLine(child.stdout, {
				accept: (line) => line.includes("questpie: listening on"),
				description: "OTEL06 packed CLI readiness",
				timeoutMilliseconds: 30_000,
			});
			const url = ready.slice(ready.indexOf("http"));
			expect(await (await fetch(url)).text()).toBe("ok");
			child.kill("SIGTERM");
			expect(await child.exited).toBe(0);
			await eventually(() => requests, {
				accept: (paths) =>
					paths.includes("/control/app-close") && paths.includes("/v1/traces"),
				description: "App close and OTLP export",
			});
			expect(requests.indexOf("/control/app-close")).toBeLessThan(
				requests.indexOf("/v1/traces"),
			);
			const cliTrace = normalizeOtlpTrace(traceBodies[0]!);
			expect(traceContentTypes[0]).toBe("application/x-protobuf");
			expect(cliTrace.resources).toEqual([
				{
					"questpie.runtime_build.digest": "a".repeat(64),
					"service.instance.id": "01234567-89ab-4def-8123-456789abcdef",
					"service.name": "application:otel06-cli",
					"service.version": releaseVersion,
				},
			]);

			await writeFile(
				join(applicationRoot, "embedded.mjs"),
				`import { createOpenTelemetry } from "questpie-opentelemetry";
import { createApplication } from "./.questpie/generated/internal/application.js";
const telemetry = await createOpenTelemetry();
try {
  const application = await createApplication({ observability: telemetry });
  try {
    const response = await application.fetch(new Request("http://embedded.test/"));
    if (await response.text() !== "ok") throw new Error("embedded work failed");
  } finally { await application.close(); }
} finally { await telemetry.close(); }
`,
			);
			await run(["bun", "embedded.mjs"], applicationRoot, {
				QUESTPIE_OTEL06_CONTROL_URL: `${receiver.url}control/app-close`,
				OTEL_EXPORTER_OTLP_ENDPOINT: receiver.url.href,
				OTEL_METRICS_EXPORTER: "none",
				OTEL_TRACES_EXPORTER: "otlp",
			});
			await eventually(() => traceBodies.length, {
				accept: (length) => length >= 2,
				description: "embedded OTLP export",
			});
			expect(normalizeOtlpTrace(traceBodies[1]!)).toEqual(cliTrace);
			expect(traceContentTypes[1]).toBe("application/x-protobuf");

			const exportedRequests = requests.length;
			child = Bun.spawn(
				[
					"bun",
					join(cliRoot, "node_modules/questpie/dist/cli.js"),
					"start",
					"--port=0",
				],
				{
					cwd: applicationRoot,
					env: {
						...process.env,
						DATABASE_URL: "postgres://localhost/otel06",
						QUESTPIE_REALTIME_HMAC_KEY: "ab".repeat(32),
						QUESTPIE_OTEL06_CONTROL_URL: `${receiver.url}control/app-close`,
						OTEL_BSP_MAX_QUEUE_SIZE: "not-an-integer",
					},
					stderr: "pipe",
					stdout: "pipe",
				},
			);
			const noTelemetryReady = await waitForOutputLine(child.stdout, {
				accept: (line) => line.includes("questpie: listening on"),
				description: "OTEL06 no-load CLI readiness",
				timeoutMilliseconds: 30_000,
			});
			expect(
				await (
					await fetch(noTelemetryReady.slice(noTelemetryReady.indexOf("http")))
				).text(),
			).toBe("ok-no-telemetry");
			child.kill("SIGINT");
			expect(await child.exited).toBe(0);
			expect(requests.slice(exportedRequests)).toEqual(["/control/app-close"]);

			const invalidChild = Bun.spawn(
				[
					"bun",
					join(cliRoot, "node_modules/questpie/dist/cli.js"),
					"start",
					"--telemetry=opentelemetry",
					"--port=0",
				],
				{
					cwd: applicationRoot,
					env: {
						...process.env,
						DATABASE_URL: "postgres://localhost/otel06",
						QUESTPIE_REALTIME_HMAC_KEY: "ab".repeat(32),
						OTEL_BSP_MAX_QUEUE_SIZE: "not-an-integer",
					},
					stderr: "pipe",
					stdout: "pipe",
				},
			);
			expect(await invalidChild.exited).not.toBe(0);
			const invalidError = await new Response(invalidChild.stderr).text();
			expect(invalidError).toContain(
				"QP-START-004 telemetryInvalidConfiguration: environment.OTEL_BSP_MAX_QUEUE_SIZE",
			);
			expect(invalidError).not.toContain("not-an-integer");

			const missingGenerated = join(cliRoot, ".questpie/generated/internal");
			await mkdir(missingGenerated, { recursive: true });
			await writeFile(
				join(missingGenerated, "application.js"),
				"export const bindIngressPrincipalForRequest = (request) => request; export async function createApplication() { throw new Error('generated App must not be created'); }",
			);
			const missingChild = Bun.spawn(
				[
					"bun",
					join(cliRoot, "node_modules/questpie/dist/cli.js"),
					"start",
					"--telemetry=opentelemetry",
					"--port=0",
				],
				{
					cwd: cliRoot,
					env: {
						...process.env,
						DATABASE_URL: "postgres://localhost/otel06",
						QUESTPIE_REALTIME_HMAC_KEY: "ab".repeat(32),
					},
					stderr: "pipe",
					stdout: "pipe",
				},
			);
			expect(await missingChild.exited).not.toBe(0);
			const missingError = await new Response(missingChild.stderr).text();
			expect(missingError).toContain("QP-START-004 telemetryUnavailable");
			expect(missingError).not.toContain("generated App must not be created");

			const incompatibleRoot = join(temporary, "incompatible-application");
			await install(incompatibleRoot, { questpie: questpie! });
			const incompatiblePackage = join(
				incompatibleRoot,
				"node_modules/questpie-opentelemetry",
			);
			await mkdir(incompatiblePackage, { recursive: true });
			await writeFile(
				join(incompatiblePackage, "package.json"),
				JSON.stringify({
					name: "questpie-opentelemetry",
					type: "module",
					exports: "./index.js",
				}),
			);
			await writeFile(
				join(incompatiblePackage, "index.js"),
				"export async function createOpenTelemetry() { return Object.freeze({ close: async () => undefined }); }",
			);
			const incompatibleGenerated = join(
				incompatibleRoot,
				".questpie/generated/internal",
			);
			await mkdir(incompatibleGenerated, { recursive: true });
			await writeFile(
				join(incompatibleGenerated, "application.js"),
				`import { bindOfficialQuestpieObservability } from "questpie/internal/observability";
export const bindIngressPrincipalForRequest = (request) => request;
export async function createApplication(input) {
  bindOfficialQuestpieObservability(input.observability, {
    format: "questpie.observation-runtime-metadata",
    version: 1,
    applicationIdentity: "application:otel06-incompatible",
    runtimeBuildDigest: "${"a".repeat(64)}",
    runtimeInstanceId: "01234567-89ab-4def-8123-456789abcdef",
    signalProjectionDigest: "b2138ccb6f40f0a95df1573848fb239124b57420609e6f9f9d97d378b6a62d58",
    questpieVersion: "${releaseVersion}"
  });
  throw new Error("incompatible App reached work");
}
`,
			);
			const incompatibleChild = Bun.spawn(
				[
					"bun",
					join(cliRoot, "node_modules/questpie/dist/cli.js"),
					"start",
					"--telemetry=opentelemetry",
					"--port=0",
				],
				{
					cwd: incompatibleRoot,
					env: {
						...process.env,
						DATABASE_URL: "postgres://localhost/otel06",
						QUESTPIE_REALTIME_HMAC_KEY: "ab".repeat(32),
					},
					stderr: "pipe",
					stdout: "pipe",
				},
			);
			expect(await incompatibleChild.exited).not.toBe(0);
			const incompatibleError = await new Response(
				incompatibleChild.stderr,
			).text();
			expect(incompatibleError).toContain("QP-START-004 telemetryUnavailable");
			expect(incompatibleError).not.toContain(
				"Runtime observation handle is incompatible",
			);
			expect(incompatibleError).not.toContain("incompatible App reached work");

			child = Bun.spawn(
				[
					"bun",
					join(cliRoot, "node_modules/questpie/dist/cli.js"),
					"start",
					"--telemetry=opentelemetry",
					"--port=0",
				],
				{
					cwd: applicationRoot,
					env: {
						...process.env,
						DATABASE_URL: "postgres://localhost/otel06",
						QUESTPIE_REALTIME_HMAC_KEY: "ab".repeat(32),
						QUESTPIE_OTEL06_CONTROL_URL: `${receiver.url}control/app-close`,
						OTEL_EXPORTER_OTLP_ENDPOINT: receiver.url.href,
						OTEL_TRACES_EXPORTER: "otlp",
					},
					stderr: "pipe",
					stdout: "pipe",
				},
			);
			const receiverLossReady = await waitForOutputLine(child.stdout, {
				accept: (line) => line.includes("questpie: listening on"),
				description: "OTEL06 receiver-loss readiness",
				timeoutMilliseconds: 30_000,
			});
			expect(
				await (
					await fetch(
						receiverLossReady.slice(receiverLossReady.indexOf("http")),
					)
				).text(),
			).toBe("ok");
			receiver.stop(true);
			receiverStopped = true;
			child.kill("SIGTERM");
			expect(
				await Promise.race([child.exited, Bun.sleep(31_000).then(() => -1)]),
			).toBe(0);
		} finally {
			await cleanup.dispose();
		}
	},
	90_000,
);
