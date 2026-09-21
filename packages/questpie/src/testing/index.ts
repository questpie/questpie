import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "pg";

import {
	buildCliEnvironment,
	buildDatabaseName,
	connectionUrlForDatabase,
	parseDatabaseName,
	quoteIdentifier,
	redactPostgresCredentials,
	validateNamePrefix,
} from "./internal";

/**
 * `questpie/testing` is the public seam an application uses to write a
 * DB-backed test against a compiled QUESTPIE application without forging a
 * Principal, guessing at internal schema names, or reimplementing migration
 * plumbing. It is intentionally small: it owns test lifecycle bookkeeping
 * (`CleanupStack`, `eventually`, `waitForOutputLine`) and PostgreSQL test
 * database isolation (`createTestDatabase`, `runQuestpieCli`,
 * `createIsolatedApplicationDatabase`, `createMigratedTemplateDatabase`,
 * `reapTestDatabases`). It does not own the generated App Contract, HTTP
 * client, or Durable worker; those already ship from a compiled
 * application's own `.questpie/generated` output and from the `questpie`
 * package root (`principal`, `context`). See
 * docs/adr/0045-freeze-public-testing-surface.md.
 *
 * This module is runtime-neutral: it uses `node:child_process` and
 * `setTimeout`, not `Bun`-only globals, so it does not extend
 * `questpie/react-query`'s Bun-specific footprint. It still assumes a
 * PostgreSQL 16 or 17 server (the same versions QUESTPIE's own tests target)
 * and the standard `pg` wire protocol.
 *
 * Deterministic **Reaction** draining is not provided. QUESTPIE's generated
 * Durable worker (`app.durable.worker().poll()`, part of a compiled
 * application's own generated App Contract, not this module) is the public
 * seam for deterministically draining **Jobs**; pair it with `eventually`
 * below. Waiting for a committed Reaction to finish has no public
 * deterministic seam today — an application must poll its own observable
 * side effect (a row, a Query result, a test-only webhook receiver) with
 * `eventually`.
 */

function delay(milliseconds: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, milliseconds);
	});
}

export type Cleanup = () => void | Promise<void>;

/**
 * Registers teardown callbacks and disposes them in reverse order. Failures
 * from individual cleanups are collected and re-thrown together so one
 * failing teardown never hides another. Prefer registering
 * `TestDatabaseHandle.dispose` here over a bare `try`/`finally`: a `finally`
 * block that itself throws replaces (masks) an exception already in flight
 * from the `try` body, while `CleanupStack.dispose()` aggregates every
 * failure — including a prior test failure the caller re-throws after
 * `dispose()` — into one `AggregateError` instead of silently dropping one.
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
		await delay(intervalMilliseconds);
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

// --- PostgreSQL identifier/credential safety -------------------------------
// (`quoteIdentifier`, name generation/parsing, and credential redaction live
// in ./internal so this repository's unit tests can import them directly.)

async function createDatabase(
	input: Readonly<{
		adminConnectionUrl: string;
		databaseName: string;
		databaseCollation: string;
		databaseCType: string;
		template?: string;
	}>,
): Promise<void> {
	const admin = new Client({ connectionString: input.adminConnectionUrl });
	await admin.connect();
	try {
		const statement =
			input.template === undefined
				? `CREATE DATABASE ${quoteIdentifier(input.databaseName)} WITH TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE ${admin.escapeLiteral(input.databaseCollation)} LC_CTYPE ${admin.escapeLiteral(input.databaseCType)}`
				: `CREATE DATABASE ${quoteIdentifier(input.databaseName)} WITH TEMPLATE ${quoteIdentifier(input.template)}`;
		try {
			await admin.query(statement);
		} catch (error) {
			throw new Error(
				redactPostgresCredentials(
					`questpie/testing: CREATE DATABASE ${input.databaseName} failed: ${error instanceof Error ? error.message : String(error)}`,
				),
				{ cause: error },
			);
		}
	} finally {
		await admin.end();
	}
}

/**
 * Drops `databaseName` with `WITH (FORCE)` (PostgreSQL 13+; QUESTPIE targets
 * 16/17), which disconnects other backends as part of the same statement
 * instead of a separate `pg_terminate_backend` step racing new connections.
 */
async function dropDatabaseForce(
	adminConnectionUrl: string,
	databaseName: string,
): Promise<void> {
	const admin = new Client({ connectionString: adminConnectionUrl });
	await admin.connect();
	try {
		await admin.query(
			`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)} WITH (FORCE)`,
		);
	} catch (error) {
		throw new Error(
			redactPostgresCredentials(
				`questpie/testing: DROP DATABASE ${databaseName} failed: ${error instanceof Error ? error.message : String(error)}`,
			),
			{ cause: error },
		);
	} finally {
		await admin.end();
	}
}

export type TestDatabaseHandle = Readonly<{
	/** Connection URL of the freshly created, empty database. */
	connectionUrl: string;
	/** The generated database name, useful for diagnostics only. */
	databaseName: string;
	/**
	 * Terminates other backends on the database and drops it. Idempotent on
	 * success: once `dispose()` has dropped the database it will not try
	 * again. If dropping fails, `disposed` is *not* latched, so a caller may
	 * retry `dispose()` (for example from a `CleanupStack`, which will call
	 * it again on a later run only if `defer`red again — ordinarily this
	 * just means the thrown error is visible and the database is picked up
	 * later by `reapTestDatabases`). A failing `dispose()` re-throws; run it
	 * through `CleanupStack` rather than a bare `try`/`finally` so it cannot
	 * silently replace an original test failure.
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
 * `DROP DATABASE` on the target PostgreSQL server (PostgreSQL 16 or 17).
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
 *
 * `namePrefix` (default `"questpie_test"`) must match
 * `/^[a-zA-Z][a-zA-Z0-9_]{0,40}$/`; the generated name embeds a creation
 * timestamp and a 16-hex-character random suffix and is rejected up front if
 * it would exceed PostgreSQL's 63-byte identifier limit.
 */
export async function createTestDatabase(
	input: Readonly<{
		adminConnectionUrl: string;
		namePrefix?: string;
		databaseCollation?: string;
		databaseCType?: string;
	}>,
): Promise<TestDatabaseHandle> {
	const namePrefix = input.namePrefix ?? "questpie_test";
	const databaseName = buildDatabaseName(namePrefix);
	const databaseCollation = input.databaseCollation ?? "C.UTF-8";
	const databaseCType = input.databaseCType ?? databaseCollation;
	await createDatabase({
		adminConnectionUrl: input.adminConnectionUrl,
		databaseName,
		databaseCollation,
		databaseCType,
	});
	let disposed = false;
	return Object.freeze({
		connectionUrl: connectionUrlForDatabase(
			input.adminConnectionUrl,
			databaseName,
		),
		databaseName,
		dispose: async (): Promise<void> => {
			if (disposed) return;
			await dropDatabaseForce(input.adminConnectionUrl, databaseName);
			disposed = true;
		},
	});
}

export type TestDatabaseTemplateHandle = Readonly<{
	databaseName: string;
	/** Drops the template database. Same idempotence/retry contract as `TestDatabaseHandle.dispose`. */
	dispose: () => Promise<void>;
}>;

/**
 * Creates one database, migrates (and optionally seeds) it exactly like
 * `createIsolatedApplicationDatabase`, then marks it a PostgreSQL template
 * (`ALTER DATABASE ... WITH IS_TEMPLATE true`, `ALLOW_CONNECTIONS false`) so
 * later test files can clone it with `createTestDatabaseFromTemplate`
 * instead of re-running migrations. Cloning a template database is a
 * PostgreSQL file-copy, not a full migration replay — this is the
 * "migrate once per test run, clone per file" seam named in ADR-0045.
 *
 * Call this once per test run (for example in a global `beforeAll`), not per
 * test file; call `dispose()` once at the end of the run.
 */
export async function createMigratedTemplateDatabase(
	input: Readonly<{
		adminConnectionUrl: string;
		applicationRoot: string;
		namePrefix?: string;
		seed?: boolean;
	}>,
): Promise<TestDatabaseTemplateHandle> {
	const database = await createIsolatedApplicationDatabase(input);
	const admin = new Client({ connectionString: input.adminConnectionUrl });
	await admin.connect();
	try {
		await admin.query(
			`ALTER DATABASE ${quoteIdentifier(database.databaseName)} WITH ALLOW_CONNECTIONS false`,
		);
		await admin.query(
			`ALTER DATABASE ${quoteIdentifier(database.databaseName)} WITH IS_TEMPLATE true`,
		);
	} finally {
		await admin.end();
	}
	let disposed = false;
	return Object.freeze({
		databaseName: database.databaseName,
		dispose: async (): Promise<void> => {
			if (disposed) return;
			const revert = new Client({
				connectionString: input.adminConnectionUrl,
			});
			await revert.connect();
			try {
				await revert.query(
					`ALTER DATABASE ${quoteIdentifier(database.databaseName)} WITH IS_TEMPLATE false`,
				);
				await revert.query(
					`ALTER DATABASE ${quoteIdentifier(database.databaseName)} WITH ALLOW_CONNECTIONS true`,
				);
			} finally {
				await revert.end();
			}
			await database.dispose();
			disposed = true;
		},
	});
}

/**
 * Clones a database created by `createMigratedTemplateDatabase` using
 * PostgreSQL's native `CREATE DATABASE ... TEMPLATE`, skipping migration and
 * Seed replay entirely.
 */
export async function createTestDatabaseFromTemplate(
	input: Readonly<{
		adminConnectionUrl: string;
		template: TestDatabaseTemplateHandle;
		namePrefix?: string;
	}>,
): Promise<TestDatabaseHandle> {
	const namePrefix = input.namePrefix ?? "questpie_test";
	const databaseName = buildDatabaseName(namePrefix);
	await createDatabase({
		adminConnectionUrl: input.adminConnectionUrl,
		databaseName,
		databaseCollation: "",
		databaseCType: "",
		template: input.template.databaseName,
	});
	let disposed = false;
	return Object.freeze({
		connectionUrl: connectionUrlForDatabase(
			input.adminConnectionUrl,
			databaseName,
		),
		databaseName,
		dispose: async (): Promise<void> => {
			if (disposed) return;
			await dropDatabaseForce(input.adminConnectionUrl, databaseName);
			disposed = true;
		},
	});
}

export type ReapTestDatabasesResult = Readonly<{
	dropped: readonly string[];
	failed: readonly Readonly<{ databaseName: string; error: string }>[];
}>;

/**
 * Recovers databases this module's `namePrefix`-based helpers created and
 * left behind — a SIGINT, an OOM kill, or a CI timeout between `create*` and
 * `dispose()` cannot run the disposer. Drops every database whose name
 * matches `<namePrefix>_<createdAt>_<random>` and whose embedded creation
 * timestamp is older than `olderThanMinutes`. Databases from other
 * applications, or created with a different `namePrefix`, are never touched:
 * a database only matches if its name parses back to this exact prefix.
 * Safe to run repeatedly (for example at the start of a CI job) against a
 * shared PostgreSQL server.
 */
export async function reapTestDatabases(
	input: Readonly<{
		adminConnectionUrl: string;
		namePrefix: string;
		olderThanMinutes: number;
	}>,
): Promise<ReapTestDatabasesResult> {
	validateNamePrefix(input.namePrefix);
	const admin = new Client({ connectionString: input.adminConnectionUrl });
	await admin.connect();
	let allDatabaseNames: readonly string[];
	try {
		const result = await admin.query<{ datname: string }>(
			"SELECT datname FROM pg_catalog.pg_database WHERE datistemplate = false",
		);
		allDatabaseNames = result.rows.map((row) => row.datname);
	} finally {
		await admin.end();
	}
	const cutoffMs = Date.now() - input.olderThanMinutes * 60_000;
	const dropped: string[] = [];
	const failed: Readonly<{ databaseName: string; error: string }>[] = [];
	for (const databaseName of allDatabaseNames) {
		const parsed = parseDatabaseName(input.namePrefix, databaseName);
		if (parsed === null || parsed.createdAtMs > cutoffMs) continue;
		try {
			await dropDatabaseForce(input.adminConnectionUrl, databaseName);
			dropped.push(databaseName);
		} catch (error) {
			failed.push(
				Object.freeze({
					databaseName,
					error: redactPostgresCredentials(
						error instanceof Error ? error.message : String(error),
					),
				}),
			);
		}
	}
	return Object.freeze({
		dropped: Object.freeze(dropped),
		failed: Object.freeze(failed),
	});
}

// --- CLI resolution and invocation -----------------------------------------

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
 * Runs the published `questpie` CLI against `input.connectionUrl` (when
 * given; `DATABASE_URL` is left unset for CLI subcommands that do not touch
 * PostgreSQL, such as `build`) from `input.applicationRoot`. This is the
 * seam a test uses to build, or apply committed migrations or Seeds to, an
 * isolated test database with the exact CLI an application already ships
 * with; it never reimplements build, migration, or Seed application.
 *
 * The child process is spawned non-blocking and killed if it runs past
 * `input.timeoutMilliseconds` (default 60 seconds). Its environment is
 * `PATH`/`HOME`/`TMPDIR`/`TEMP`/`TMP` inherited from this process, plus
 * `input.env`, plus `DATABASE_URL` — not this process's full environment.
 * Any PostgreSQL connection string credential appearing in the child's
 * combined stdout/stderr is redacted before it can reach a thrown error.
 */
export async function runQuestpieCli(
	input: Readonly<{
		applicationRoot: string;
		arguments: readonly string[];
		connectionUrl?: string;
		env?: Readonly<Record<string, string>>;
		timeoutMilliseconds?: number;
	}>,
): Promise<QuestpieCliResult> {
	const cliPath = await resolveQuestpieCliPath();
	const timeoutMilliseconds = input.timeoutMilliseconds ?? 60_000;
	const environment = buildCliEnvironment({
		source: process.env,
		...(input.env === undefined ? {} : { overrides: input.env }),
		...(input.connectionUrl === undefined
			? {}
			: { connectionUrl: input.connectionUrl }),
	});
	const { exitCode, stdout, stderr, timedOut } = await new Promise<{
		exitCode: number | null;
		stdout: string;
		stderr: string;
		timedOut: boolean;
	}>((resolve, reject) => {
		const child = spawn("bun", [cliPath, ...input.arguments], {
			cwd: input.applicationRoot,
			env: environment,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdoutBytes = "";
		let stderrBytes = "";
		let timedOutFlag = false;
		const timer = setTimeout(() => {
			timedOutFlag = true;
			child.kill("SIGKILL");
		}, timeoutMilliseconds);
		child.stdout.on("data", (chunk: Buffer) => {
			stdoutBytes += chunk.toString("utf8");
		});
		child.stderr.on("data", (chunk: Buffer) => {
			stderrBytes += chunk.toString("utf8");
		});
		child.on("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			resolve({
				exitCode: code,
				stdout: stdoutBytes,
				stderr: stderrBytes,
				timedOut: timedOutFlag,
			});
		});
	});
	const redactedStdout = redactPostgresCredentials(stdout);
	const redactedStderr = redactPostgresCredentials(stderr);
	if (timedOut)
		throw new Error(
			`questpie ${input.arguments.join(" ")} did not exit within ${timeoutMilliseconds}ms and was killed: ${redactedStdout}${redactedStderr}`,
		);
	if (exitCode !== 0)
		throw new Error(
			`questpie ${input.arguments.join(" ")} failed with exit code ${exitCode}: ${redactedStdout}${redactedStderr}`,
		);
	return Object.freeze({ stdout: redactedStdout, stderr: redactedStderr });
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
