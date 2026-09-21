import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "pg";

/**
 * `questpie/testing` is the public seam an application uses to write a
 * DB-backed test against a compiled QUESTPIE application without forging a
 * Principal, guessing at internal schema names, or reimplementing migration
 * plumbing. It is intentionally small: it owns test lifecycle bookkeeping
 * (`CleanupStack`, `eventually`, `waitForOutputLine`) and PostgreSQL test
 * database isolation (`createTestDatabase`, `runQuestpieCli`,
 * `createIsolatedApplicationDatabase`). It does not own the generated App
 * Contract, HTTP client, or Durable worker; those already ship from a
 * compiled application's own `.questpie/generated` output and from the
 * `questpie` package root (`principal`, `context`). See
 * docs/adr/0045-freeze-public-testing-surface.md.
 */

export type Cleanup = () => void | Promise<void>;

/**
 * Registers teardown callbacks and disposes them in reverse order. Failures
 * from individual cleanups are collected and re-thrown together so one
 * failing teardown never hides another.
 */
export class CleanupStack {
	readonly #cleanups: Cleanup[] = [];
	#disposed = false;

	defer(cleanup: Cleanup): void {
		if (this.#disposed)
			throw new TypeError("cleanup stack is already disposed");
		this.#cleanups.push(cleanup);
	}

	async dispose(): Promise<void> {
		if (this.#disposed) return;
		this.#disposed = true;
		const failures: unknown[] = [];
		for (const cleanup of this.#cleanups.toReversed()) {
			try {
				await cleanup();
			} catch (error) {
				failures.push(error);
			}
		}
		if (failures.length > 0)
			throw new AggregateError(failures, "test cleanup failed");
	}
}

/**
 * Polls `probe` until `accept` returns true or the timeout elapses. Used to
 * deterministically await Durable Run terminal states, worker drains, or
 * other eventually-consistent proof conditions without a fixed sleep.
 */
export async function eventually<Value>(
	probe: () => Value | Promise<Value>,
	input: Readonly<{
		accept: (value: Value) => boolean;
		timeoutMilliseconds?: number;
		intervalMilliseconds?: number;
		description?: string;
	}>,
): Promise<Value> {
	const timeoutMilliseconds = input.timeoutMilliseconds ?? 5_000;
	const intervalMilliseconds = input.intervalMilliseconds ?? 25;
	const deadline = Date.now() + timeoutMilliseconds;
	let last: Value;
	do {
		last = await probe();
		if (input.accept(last)) return last;
		await Bun.sleep(intervalMilliseconds);
	} while (Date.now() < deadline);
	throw new Error(
		`${input.description ?? "eventually condition"} was not met within ${timeoutMilliseconds}ms`,
	);
}

/**
 * Waits for a line satisfying `accept` on a child process stream, such as a
 * hosted application's readiness line. Cancels the reader on timeout.
 */
export async function waitForOutputLine(
	stream: ReadableStream<Uint8Array>,
	input: Readonly<{
		accept: (line: string) => boolean;
		timeoutMilliseconds?: number;
		description?: string;
	}>,
): Promise<string> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let buffered = "";
	const timeout = setTimeout(
		() => void reader.cancel(input.description ?? "output wait timed out"),
		input.timeoutMilliseconds ?? 10_000,
	);
	try {
		for (;;) {
			const part = await reader.read();
			if (part.done)
				throw new Error(
					`${input.description ?? "expected output"} was not observed before the stream closed`,
				);
			buffered += decoder.decode(part.value, { stream: true });
			for (;;) {
				const newline = buffered.indexOf("\n");
				if (newline < 0) break;
				const line = buffered.slice(0, newline);
				buffered = buffered.slice(newline + 1);
				if (input.accept(line)) return line;
			}
		}
	} finally {
		clearTimeout(timeout);
		reader.releaseLock();
	}
}

function connectionUrlForDatabase(
	adminConnectionUrl: string,
	databaseName: string,
): string {
	const url = new URL(adminConnectionUrl);
	url.pathname = `/${databaseName}`;
	return url.toString();
}

function quoteIdentifier(value: string): string {
	return `"${value.replaceAll('"', '""')}"`;
}

export type TestDatabaseHandle = Readonly<{
	/** Connection URL of the freshly created, empty database. */
	connectionUrl: string;
	/** The generated database name, useful for diagnostics only. */
	databaseName: string;
	/**
	 * Terminates other backends on the database and drops it. Idempotent:
	 * calling it more than once, or after the database is already gone, is a
	 * no-op.
	 */
	dispose: () => Promise<void>;
}>;

/**
 * Creates one empty PostgreSQL database on the server named by
 * `adminConnectionUrl` and returns a connection URL for it plus a disposer
 * that drops it. This is the isolation unit: one database per test file (or
 * per test) avoids schema-name collisions across parallel test files without
 * requiring knowledge of an application's configured PostgreSQL schema.
 *
 * `adminConnectionUrl` must name a role allowed to `CREATE DATABASE` /
 * `DROP DATABASE` on the target PostgreSQL server (PostgreSQL 16 or 17; the
 * same versions QUESTPIE's own PostgreSQL-backed tests run against).
 * `databaseCollation`/`databaseCType` must match the application's
 * `questpie.json#postgres.databaseCollation`/`databaseCType`: QUESTPIE's
 * readiness check (`QP-SCHEMA-007`) fails closed against a database whose
 * actual collation does not match the application's declared one, and a
 * bare `CREATE DATABASE` inherits the server's default collation, which is
 * not guaranteed to match. `createIsolatedApplicationDatabase` reads these
 * from the application's `questpie.json` automatically; call this function
 * directly only when you already know the required collation. Nothing here
 * runs migrations or Seeds; pair it with `runQuestpieCli` or use
 * `createIsolatedApplicationDatabase`.
 */
export async function createTestDatabase(
	input: Readonly<{
		adminConnectionUrl: string;
		namePrefix?: string;
		databaseCollation?: string;
		databaseCType?: string;
	}>,
): Promise<TestDatabaseHandle> {
	const databaseName = `${input.namePrefix ?? "questpie_test"}_${crypto.randomUUID().replaceAll("-", "")}`;
	const admin = new Client({ connectionString: input.adminConnectionUrl });
	await admin.connect();
	try {
		const collation = input.databaseCollation ?? "C.UTF-8";
		const cType = input.databaseCType ?? collation;
		await admin.query(
			`CREATE DATABASE ${quoteIdentifier(databaseName)} WITH TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE ${admin.escapeLiteral(collation)} LC_CTYPE ${admin.escapeLiteral(cType)}`,
		);
	} finally {
		await admin.end();
	}
	let disposed = false;
	return Object.freeze({
		connectionUrl: connectionUrlForDatabase(
			input.adminConnectionUrl,
			databaseName,
		),
		databaseName,
		dispose: async (): Promise<void> => {
			if (disposed) return;
			disposed = true;
			const dropper = new Client({
				connectionString: input.adminConnectionUrl,
			});
			await dropper.connect();
			try {
				await dropper.query(
					`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
					[databaseName],
				);
				await dropper.query(
					`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`,
				);
			} finally {
				await dropper.end();
			}
		},
	});
}

export type QuestpieCliResult = Readonly<{ stdout: string; stderr: string }>;

async function resolveQuestpieCliPath(): Promise<string> {
	const packageJsonUrl = import.meta.resolve("questpie/package.json");
	const packageDirectory = dirname(fileURLToPath(packageJsonUrl));
	const manifest = JSON.parse(
		await readFile(join(packageDirectory, "package.json"), "utf8"),
	) as Readonly<{ bin?: string | Readonly<Record<string, string>> }>;
	const binRelative =
		typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.questpie;
	if (!binRelative)
		throw new Error(
			"questpie: the installed questpie package does not declare a CLI binary",
		);
	return join(packageDirectory, binRelative);
}

/**
 * Runs the published `questpie` CLI against `input.connectionUrl` from
 * `input.applicationRoot`. This is the seam a test uses to apply committed
 * migrations or Seeds to an isolated test database with the exact CLI an
 * application already ships with; it never reimplements migration or Seed
 * application.
 */
export async function runQuestpieCli(
	input: Readonly<{
		applicationRoot: string;
		arguments: readonly string[];
		connectionUrl: string;
		env?: Readonly<Record<string, string>>;
	}>,
): Promise<QuestpieCliResult> {
	const cliPath = await resolveQuestpieCliPath();
	const result = Bun.spawnSync(["bun", cliPath, ...input.arguments], {
		cwd: input.applicationRoot,
		env: {
			...process.env,
			...input.env,
			DATABASE_URL: input.connectionUrl,
		},
		stdout: "pipe",
		stderr: "pipe",
	});
	const stdout = result.stdout.toString();
	const stderr = result.stderr.toString();
	if (result.exitCode !== 0)
		throw new Error(
			`questpie ${input.arguments.join(" ")} failed with exit code ${result.exitCode}: ${stdout}${stderr}`,
		);
	return Object.freeze({ stdout, stderr });
}

/**
 * Creates an isolated database, applies the application's committed
 * migrations (`questpie migration apply`), optionally applies its committed
 * Seeds (`questpie seed apply`), and returns the same handle shape as
 * `createTestDatabase`. On any migration/Seed failure the freshly created
 * database is dropped before the error propagates, so a failed setup never
 * leaks a database.
 *
 * `input.applicationRoot` is the directory containing the application's
 * `questpie.json` and committed `questpie/migrations` (and `questpie/seeds`
 * when `input.seed` is true) — normally the compiled application's own
 * repository root, the same directory `questpie build` already runs from.
 */
export async function createIsolatedApplicationDatabase(
	input: Readonly<{
		adminConnectionUrl: string;
		applicationRoot: string;
		namePrefix?: string;
		seed?: boolean;
	}>,
): Promise<TestDatabaseHandle> {
	const manifest = JSON.parse(
		await readFile(join(input.applicationRoot, "questpie.json"), "utf8"),
	) as Readonly<{
		postgres?: Readonly<{
			databaseCollation?: string;
			databaseCType?: string;
		}>;
	}>;
	const database = await createTestDatabase({
		adminConnectionUrl: input.adminConnectionUrl,
		...(input.namePrefix === undefined ? {} : { namePrefix: input.namePrefix }),
		...(manifest.postgres?.databaseCollation === undefined
			? {}
			: { databaseCollation: manifest.postgres.databaseCollation }),
		...(manifest.postgres?.databaseCType === undefined
			? {}
			: { databaseCType: manifest.postgres.databaseCType }),
	});
	try {
		await runQuestpieCli({
			applicationRoot: input.applicationRoot,
			arguments: ["migration", "apply"],
			connectionUrl: database.connectionUrl,
		});
		if (input.seed === true)
			await runQuestpieCli({
				applicationRoot: input.applicationRoot,
				arguments: ["seed", "apply"],
				connectionUrl: database.connectionUrl,
			});
	} catch (error) {
		await database.dispose();
		throw error;
	}
	return database;
}
