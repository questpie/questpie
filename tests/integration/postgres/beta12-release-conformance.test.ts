import { expect, setDefaultTimeout, test } from "bun:test";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { SQL } from "bun";

import {
	buildPackedTracer,
	installQuestpieForTracer,
} from "../../support/beta12-packed-questpie";

const repositoryRoot = resolve(import.meta.dir, "../../..");
const postgresTest = process.env.PGHOST ? test : test.skip;

setDefaultTimeout(180_000);

function postgresUrl(): string {
	const url = new URL("postgres://localhost/");
	url.hostname = process.env.PGHOST ?? "127.0.0.1";
	url.port = process.env.PGPORT ?? "5432";
	url.username = process.env.PGUSER ?? "postgres";
	url.pathname = `/${process.env.PGDATABASE ?? "postgres"}`;
	if (process.env.PGPASSWORD) url.password = process.env.PGPASSWORD;
	return url.toString();
}

async function waitForOutput(
	stream: ReadableStream<Uint8Array>,
	needle: string,
): Promise<string> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let output = "";
	try {
		return await Promise.race([
			(async () => {
				while (!output.includes(needle)) {
					const chunk = await reader.read();
					if (chunk.done) throw new Error(`process exited before ${needle}`);
					output += decoder.decode(chunk.value, { stream: true });
				}
				return output;
			})(),
			Bun.sleep(15_000).then(() => {
				throw new Error(`process did not emit ${needle} within 15000ms`);
			}),
		]);
	} finally {
		reader.releaseLock();
	}
}

postgresTest(
	"runs collaboration and archive connected tracers from the checked package tarball",
	async () => {
		const temporary = await mkdtemp(join(tmpdir(), "questpie-beta12-pack-"));
		try {
			const packed = Bun.spawnSync(
				[
					"bun",
					"pm",
					"pack",
					"--destination",
					temporary,
					"--ignore-scripts",
					"--quiet",
				],
				{
					cwd: resolve(repositoryRoot, "packages/questpie"),
					stdout: "pipe",
					stderr: "pipe",
				},
			);
			expect(packed.exitCode, packed.stderr.toString()).toBe(0);
			const manifest = JSON.parse(
				await readFile(
					resolve(repositoryRoot, "quality/release/package-artifacts.json"),
					"utf8",
				),
			) as Readonly<{
				packages: readonly Readonly<{ filename: string; sha256: string }>[];
			}>;
			const artifact = manifest.packages[0]!;
			const tarball = join(temporary, artifact.filename);
			expect(
				createHash("sha256")
					.update(await readFile(tarball))
					.digest("hex"),
			).toBe(artifact.sha256);

			const packedApplication = join(temporary, "archive-application");
			await cp(resolve(repositoryRoot, "fixtures/archive"), packedApplication, {
				recursive: true,
			});
			await installQuestpieForTracer(packedApplication, tarball);
			expect(buildPackedTracer(packedApplication, tarball)).toBe(true);
			const database = new SQL(postgresUrl());
			await database.unsafe(
				'DROP SCHEMA IF EXISTS "archive" CASCADE; DROP SCHEMA IF EXISTS questpie_internal CASCADE;',
			);
			await database.close({ timeout: 0 });
			const cli = join(packedApplication, "node_modules/questpie/dist/cli.js");
			const environment = {
				...process.env,
				DATABASE_URL: postgresUrl(),
				QUESTPIE_REALTIME_HMAC_KEY: "11".repeat(32),
			};
			for (let attempt = 0; attempt < 2; attempt += 1) {
				const migration = Bun.spawnSync(["bun", cli, "migration", "apply"], {
					cwd: packedApplication,
					env: environment,
					stdout: "pipe",
					stderr: "pipe",
				});
				expect(migration.exitCode, migration.stderr.toString()).toBe(0);
			}
			const server = Bun.spawn(["bun", cli, "start"], {
				cwd: packedApplication,
				env: { ...environment, PORT: "0" },
				stdout: "pipe",
				stderr: "pipe",
			});
			const serverOutput = await waitForOutput(server.stdout, "listening on");
			server.kill("SIGTERM");
			const serverExit = await server.exited;
			expect(
				serverExit,
				`${serverOutput}\n${await new Response(server.stderr).text()}`,
			).toBe(0);

			for (const tracer of [
				"tests/integration/postgres/beta08-reaction-worker.test.ts",
				"tests/integration/postgres/beta11-archive.test.ts",
			]) {
				const result = Bun.spawnSync(["bun", "test", tracer], {
					cwd: repositoryRoot,
					env: {
						...process.env,
						QUESTPIE_PACKED_TARBALL: tarball,
					},
					stdout: "pipe",
					stderr: "pipe",
				});
				expect(
					result.exitCode,
					`${tracer}\n${result.stdout.toString()}\n${result.stderr.toString()}`,
				).toBe(0);
			}
		} finally {
			await rm(temporary, { force: true, recursive: true });
		}
	},
);
