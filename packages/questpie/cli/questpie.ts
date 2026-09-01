#!/usr/bin/env bun

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
	committedArtifactDirectories,
	loadGeneratedSchemaProjection,
	requestedPort,
} from "./artifacts";
import {
	createStartShutdown,
	createTelemetryApplication,
	loadOpenTelemetry,
	requestedTelemetry,
} from "./telemetry";

type Compiler = Readonly<{
	compileApplication(
		input: Readonly<{ applicationRoot: string; outputDirectory?: string }>,
	): Promise<unknown>;
	loadCommittedMigration(path: string): Promise<unknown>;
	loadCommittedSeed(path: string): Promise<unknown>;
	applyCommittedMigrations(
		input: Readonly<{
			allowNonRollingProtocolV8?: boolean;
			connectionString?: string;
			migrations: readonly unknown[];
		}>,
	): Promise<Readonly<{ status: string }>>;
	applyCommittedSeeds(
		input: Readonly<{
			connectionString?: string;
			schema: unknown;
			seeds: readonly unknown[];
		}>,
	): Promise<
		Readonly<{ applied: readonly string[]; alreadyApplied: readonly string[] }>
	>;
}>;

type GeneratedApplication = Readonly<{
	fetch(request: Request): Promise<Response>;
	close(): Promise<void>;
}>;

type GeneratedInternal = Readonly<{
	bindIngressPrincipalForRequest(request: Request, principal: unknown): Request;
	createApplication(
		input: Readonly<{
			observability?: unknown;
			postgres: Readonly<{
				connectionUrl: string;
				directConnectionUrl: string;
			}>;
			realtime: Readonly<{ hmacKey: Uint8Array }>;
			maintenance: Readonly<{ authorize(): boolean }>;
		}>,
	): Promise<GeneratedApplication>;
}>;

type Framework = Readonly<{
	principal: Readonly<{ anonymous(): unknown }>;
}>;

function fail(message: string): never {
	console.error(`questpie: ${message}`);
	process.exit(1);
}

async function compiler(): Promise<Compiler> {
	return (await import(
		new URL("./internal/compiler/index.js", import.meta.url).href
	)) as Compiler;
}

function databaseUrl(): string {
	return process.env.DATABASE_URL ?? fail("DATABASE_URL is required");
}

function realtimeKey(): Uint8Array {
	const encoded = process.env.QUESTPIE_REALTIME_HMAC_KEY;
	if (!encoded || !/^[0-9a-f]{64,}$/i.test(encoded) || encoded.length % 2 !== 0)
		fail("QUESTPIE_REALTIME_HMAC_KEY must be at least 32 bytes encoded as hex");
	return Uint8Array.from(Buffer.from(encoded, "hex"));
}

async function main(): Promise<void> {
	const root = process.cwd();
	const cliArguments = Bun.argv.slice(2);
	const [command, subcommand] = cliArguments;
	if (command === "build") {
		await (await compiler()).compileApplication({ applicationRoot: root });
		console.log("questpie: application build complete");
		return;
	}
	if (command === "check") {
		const output = await mkdtemp(join(tmpdir(), "questpie-check-"));
		try {
			await (
				await compiler()
			).compileApplication({
				applicationRoot: root,
				outputDirectory: output,
			});
		} finally {
			await rm(output, { force: true, recursive: true });
		}
		console.log("questpie: application contract valid");
		return;
	}
	if (command === "migration" && subcommand === "apply") {
		const api = await compiler();
		const migrations = await Promise.all(
			(await committedArtifactDirectories(root, "migrations")).map((path) =>
				api.loadCommittedMigration(path),
			),
		);
		if (migrations.length === 0) fail("no committed migrations found");
		const result = await api.applyCommittedMigrations({
			allowNonRollingProtocolV8: cliArguments.includes(
				"--allow-non-rolling-protocol-v8",
			),
			connectionString: databaseUrl(),
			migrations,
		});
		if (result.status === "failed")
			fail(`migration apply returned ${result.status}`);
		console.log(
			result.status === "applied"
				? "questpie: committed migrations applied"
				: "questpie: committed migrations already applied",
		);
		return;
	}
	if (command === "seed" && subcommand === "apply") {
		const api = await compiler();
		const seeds = await Promise.all(
			(await committedArtifactDirectories(root, "seeds")).map((path) =>
				api.loadCommittedSeed(path),
			),
		);
		if (seeds.length === 0) fail("no committed Seeds found");
		const result = await api.applyCommittedSeeds({
			connectionString: databaseUrl(),
			schema: await loadGeneratedSchemaProjection(root),
			seeds,
		});
		console.log(
			`questpie: committed Seeds applied (${result.applied.length} new, ${result.alreadyApplied.length} already applied)`,
		);
		return;
	}
	if (command === "start") {
		const telemetryKind = requestedTelemetry(cliArguments.slice(1));
		const internal = (await import(
			`${pathToFileURL(resolve(root, ".questpie/generated/internal/application.js")).href}?start=${crypto.randomUUID()}`
		)) as GeneratedInternal;
		const framework = (await import(
			new URL("./index.js", import.meta.url).href
		)) as Framework;
		const postgresUrl = databaseUrl();
		const hmacKey = realtimeKey();
		const port = requestedPort(cliArguments.slice(1), process.env.PORT);
		const telemetry =
			telemetryKind === null ? null : await loadOpenTelemetry(root);
		const createApplication = (observability?: unknown) =>
			internal.createApplication({
				...(observability === undefined ? {} : { observability }),
				postgres: {
					connectionUrl: postgresUrl,
					directConnectionUrl: postgresUrl,
				},
				realtime: { hmacKey },
				maintenance: { authorize: () => false },
			});
		const application =
			telemetry === null
				? await createApplication()
				: await createTelemetryApplication(telemetry, createApplication);
		let server: ReturnType<typeof Bun.serve>;
		try {
			server = Bun.serve({
				port,
				fetch: (request) =>
					application.fetch(
						internal.bindIngressPrincipalForRequest(
							request,
							framework.principal.anonymous(),
						),
					),
			});
		} catch (error) {
			try {
				await createStartShutdown({
					application,
					stopIngress: () => undefined,
					telemetry,
				})();
			} catch {
				// Server creation remains the primary startup failure.
			}
			throw error;
		}
		const shutdown = createStartShutdown({
			application,
			stopIngress: () => server.stop(false),
			telemetry,
		});
		const close = () => {
			void shutdown().then(
				() => process.exit(0),
				() => {
					console.error("questpie: shutdown failed");
					process.exit(1);
				},
			);
		};
		process.once("SIGINT", close);
		process.once("SIGTERM", close);
		console.log(`questpie: listening on ${server.url}`);
		return;
	}
	fail("use build, check, migration apply, seed apply, or start");
}

await main();
