#!/usr/bin/env bun

import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

type Compiler = Readonly<{
	compileApplication(
		input: Readonly<{ applicationRoot: string; outputDirectory?: string }>,
	): Promise<unknown>;
	loadCommittedMigration(path: string): Promise<unknown>;
	applyCommittedMigrations(
		input: Readonly<{
			connectionString?: string;
			migrations: readonly unknown[];
		}>,
	): Promise<Readonly<{ status: string }>>;
}>;

type GeneratedApplication = Readonly<{
	fetch(request: Request): Promise<Response>;
	close(): Promise<void>;
}>;

type GeneratedInternal = Readonly<{
	bindIngressPrincipalForRequest(request: Request, principal: unknown): Request;
	createApplication(
		input: Readonly<{
			postgres: Readonly<{ url: string }>;
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

async function migrationDirectories(root: string): Promise<string[]> {
	const migrationsRoot = resolve(root, "questpie/migrations");
	return (await readdir(migrationsRoot, { withFileTypes: true }))
		.filter((entry) => entry.isDirectory())
		.map((entry) => join(migrationsRoot, entry.name))
		.sort();
}

async function main(): Promise<void> {
	const root = process.cwd();
	const [command, subcommand] = Bun.argv.slice(2);
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
			(await migrationDirectories(root)).map((path) =>
				api.loadCommittedMigration(path),
			),
		);
		if (migrations.length === 0) fail("no committed migrations found");
		const result = await api.applyCommittedMigrations({
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
	if (command === "start") {
		const internal = (await import(
			`${pathToFileURL(resolve(root, ".questpie/generated/internal/application.js")).href}?start=${crypto.randomUUID()}`
		)) as GeneratedInternal;
		const framework = (await import(
			new URL("./index.js", import.meta.url).href
		)) as Framework;
		const application = await internal.createApplication({
			postgres: { url: databaseUrl() },
			realtime: { hmacKey: realtimeKey() },
			maintenance: { authorize: () => false },
		});
		const server = Bun.serve({
			port: Number(process.env.PORT ?? "3000"),
			fetch: (request) =>
				application.fetch(
					internal.bindIngressPrincipalForRequest(
						request,
						framework.principal.anonymous(),
					),
				),
		});
		const close = async () => {
			server.stop(false);
			await application.close();
			process.exit(0);
		};
		process.once("SIGINT", close);
		process.once("SIGTERM", close);
		console.log(`questpie: listening on ${server.url}`);
		return;
	}
	fail("use build, check, migration apply, or start");
}

await main();
