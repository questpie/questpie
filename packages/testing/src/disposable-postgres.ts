import { randomBytes } from "node:crypto";

import { Client } from "pg";

import { withTimeout } from "./with-timeout.js";

const DATABASE_PREFIX = "qp_harness_";
const DATABASE_PATTERN = /^qp_harness_(\d{14})_([a-z0-9]{6})$/;
const DEFAULT_STALE_AFTER_MS = 30 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_IDENTIFIER_LENGTH = 63;

export interface PostgresAdminClient {
	connect(): Promise<void>;
	query(
		text: string,
		values?: readonly unknown[],
	): Promise<{ rows: Record<string, unknown>[] }>;
	end(): Promise<void>;
}

export type PostgresAdminClientFactory = (
	adminUrl: string,
	timeoutMs: number,
) => PostgresAdminClient;

export interface DisposablePostgresOptions {
	/** Explicit privileged connection used only to create and drop harness databases. */
	adminUrl: string;
	/** Apply the application's committed migrations after database creation. */
	migrate?: (databaseUrl: string) => Promise<void>;
	/** Databases older than this may be swept when no live lease exists. */
	staleAfterMs?: number;
	/** Connection and admin-statement timeout. */
	timeoutMs?: number;
}

export interface SweepStalePostgresOptions {
	adminUrl: string;
	staleAfterMs?: number;
	timeoutMs?: number;
}

export interface DisposablePostgres {
	readonly runId: string;
	readonly name: string;
	readonly url: string;
	dispose(): Promise<void>;
}

export type DisposablePostgresSetupPhase =
	| "sweep"
	| "connection"
	| "database"
	| "migrations";

export class DisposablePostgresSetupError extends Error {
	constructor(
		public readonly phase: DisposablePostgresSetupPhase,
		cause: unknown,
		public readonly cleanupErrors: readonly unknown[] = [],
	) {
		super(`Failed to set up disposable PostgreSQL during ${phase}`, { cause });
		this.name = "DisposablePostgresSetupError";
	}
}

export class DisposablePostgresCleanupError extends Error {
	constructor(public readonly errors: readonly unknown[]) {
		super(
			`Failed to clean up ${errors.length} disposable PostgreSQL resource(s)`,
		);
		this.name = "DisposablePostgresCleanupError";
	}
}

interface IdentityDependencies {
	now(): Date;
	randomSuffix(): string;
}

interface SweepDependencies {
	now(): Date;
}

const defaultIdentity: IdentityDependencies = {
	now: () => new Date(),
	randomSuffix: () => randomBytes(3).toString("hex"),
};

const defaultClientFactory: PostgresAdminClientFactory = (
	adminUrl,
	timeoutMs,
) => {
	const client = new Client({
		connectionString: adminUrl,
		connectionTimeoutMillis: timeoutMs,
		query_timeout: timeoutMs,
	});
	return {
		async connect() {
			await client.connect();
		},
		async query(text, values) {
			const result = await client.query(text, values ? [...values] : undefined);
			return { rows: result.rows };
		},
		async end() {
			await client.end();
		},
	};
};

export async function createDisposablePostgres(
	options: DisposablePostgresOptions,
): Promise<DisposablePostgres> {
	return createDisposablePostgresWithClientFactory(
		options,
		defaultClientFactory,
		defaultIdentity,
	);
}

export async function sweepStalePostgresDatabases(
	options: SweepStalePostgresOptions,
): Promise<readonly string[]> {
	return sweepStalePostgresWithClientFactory(options, defaultClientFactory, {
		now: () => new Date(),
	});
}

/** @internal Deterministic dependency seam for contract tests. */
export async function createDisposablePostgresWithClientFactory(
	options: DisposablePostgresOptions,
	clientFactory: PostgresAdminClientFactory,
	identity: IdentityDependencies = defaultIdentity,
): Promise<DisposablePostgres> {
	const adminUrl = validateAdminUrl(options.adminUrl);
	const timeoutMs = validatePositiveNumber(
		options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
		"timeoutMs",
	);
	const staleAfterMs = validatePositiveNumber(
		options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS,
		"staleAfterMs",
	);
	const name = createDatabaseName(identity.now(), identity.randomSuffix());
	const databaseUrl = databaseUrlFor(adminUrl, name);
	let phase: DisposablePostgresSetupPhase = "sweep";
	let leaseClient: PostgresAdminClient | undefined;
	let leaseHeld = false;
	let databaseCreated = false;

	try {
		await sweepStalePostgresWithClientFactory(
			{ adminUrl, staleAfterMs, timeoutMs },
			clientFactory,
			{ now: identity.now },
		);

		phase = "connection";
		leaseClient = clientFactory(adminUrl, timeoutMs);
		await leaseClient.connect();
		await leaseClient.query(
			"SELECT pg_advisory_lock(hashtextextended($1, 0))",
			[name],
		);
		leaseHeld = true;

		phase = "database";
		await leaseClient.query(`CREATE DATABASE ${quoteIdentifier(name)}`);
		databaseCreated = true;

		if (options.migrate) {
			phase = "migrations";
			await options.migrate(databaseUrl);
		}
	} catch (cause) {
		const cleanupErrors = await cleanupSetupFailure({
			client: leaseClient,
			name,
			databaseCreated,
			leaseHeld,
			timeoutMs,
		});
		throw new DisposablePostgresSetupError(phase, cause, cleanupErrors);
	}

	const client = leaseClient;
	let disposePromise: Promise<void> | undefined;
	return {
		runId: name.slice(DATABASE_PREFIX.length),
		name,
		url: databaseUrl,
		dispose() {
			disposePromise ??= disposeDatabase(client, name, timeoutMs);
			return disposePromise;
		},
	};
}

/** @internal Deterministic dependency seam for contract tests. */
export async function sweepStalePostgresWithClientFactory(
	options: SweepStalePostgresOptions,
	clientFactory: PostgresAdminClientFactory,
	dependencies: SweepDependencies = { now: () => new Date() },
): Promise<readonly string[]> {
	const adminUrl = validateAdminUrl(options.adminUrl);
	const timeoutMs = validatePositiveNumber(
		options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
		"timeoutMs",
	);
	const staleAfterMs = validatePositiveNumber(
		options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS,
		"staleAfterMs",
	);
	const client = clientFactory(adminUrl, timeoutMs);
	const dropped: string[] = [];

	try {
		await withTimeout(
			client.connect(),
			timeoutMs,
			"connect to PostgreSQL admin",
		);
		const result = await withTimeout(
			client.query("SELECT datname FROM pg_database WHERE datname LIKE $1", [
				`${DATABASE_PREFIX}%`,
			]),
			timeoutMs,
			"list disposable PostgreSQL databases",
		);

		for (const row of result.rows) {
			const name = typeof row.datname === "string" ? row.datname : "";
			const createdAt = parseDatabaseTimestamp(name);
			if (!createdAt) continue;
			if (dependencies.now().getTime() - createdAt.getTime() <= staleAfterMs) {
				continue;
			}

			const lock = await withTimeout(
				client.query(
					"SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired",
					[name],
				),
				timeoutMs,
				`acquire stale-sweep lease for ${name}`,
			);
			if (lock.rows[0]?.acquired !== true) continue;

			try {
				await withTimeout(
					client.query(
						`DROP DATABASE IF EXISTS ${quoteIdentifier(name)} WITH (FORCE)`,
					),
					timeoutMs,
					`drop stale PostgreSQL database ${name}`,
				);
				dropped.push(name);
			} finally {
				await withTimeout(
					client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [
						name,
					]),
					timeoutMs,
					`release stale-sweep lease for ${name}`,
				);
			}
		}

		return dropped;
	} finally {
		await withTimeout(client.end(), timeoutMs, "close PostgreSQL admin client");
	}
}

function validateAdminUrl(value: string): string {
	let url: URL;
	try {
		url = new URL(value);
	} catch (cause) {
		throw new TypeError("adminUrl must be an explicit PostgreSQL URL", {
			cause,
		});
	}
	if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
		throw new TypeError(
			"adminUrl must use the postgres or postgresql protocol",
		);
	}
	const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
	if (!database) {
		throw new TypeError("adminUrl must name an administrative database");
	}
	if (database.startsWith(DATABASE_PREFIX)) {
		throw new TypeError(
			"adminUrl cannot connect to a disposable harness database",
		);
	}
	return url.toString();
}

function validatePositiveNumber(value: number, label: string): number {
	if (!Number.isFinite(value) || value <= 0) {
		throw new TypeError(`${label} must be a positive finite number`);
	}
	return value;
}

function createDatabaseName(now: Date, suffix: string): string {
	if (!/^[a-z0-9]{6}$/.test(suffix)) {
		throw new TypeError(
			"Disposable PostgreSQL suffix must be six lowercase alphanumerics",
		);
	}
	const timestamp = [
		now.getUTCFullYear().toString().padStart(4, "0"),
		(now.getUTCMonth() + 1).toString().padStart(2, "0"),
		now.getUTCDate().toString().padStart(2, "0"),
		now.getUTCHours().toString().padStart(2, "0"),
		now.getUTCMinutes().toString().padStart(2, "0"),
		now.getUTCSeconds().toString().padStart(2, "0"),
	].join("");
	const name = `${DATABASE_PREFIX}${timestamp}_${suffix}`;
	if (!DATABASE_PATTERN.test(name) || name.length > MAX_IDENTIFIER_LENGTH) {
		throw new TypeError("Generated disposable PostgreSQL name is unsafe");
	}
	return name;
}

function parseDatabaseTimestamp(name: string): Date | undefined {
	const match = DATABASE_PATTERN.exec(name);
	if (!match) return undefined;
	const stamp = match[1];
	const date = new Date(
		Date.UTC(
			Number(stamp.slice(0, 4)),
			Number(stamp.slice(4, 6)) - 1,
			Number(stamp.slice(6, 8)),
			Number(stamp.slice(8, 10)),
			Number(stamp.slice(10, 12)),
			Number(stamp.slice(12, 14)),
		),
	);
	if (Number.isNaN(date.getTime())) return undefined;
	const roundTrip = [
		date.getUTCFullYear().toString().padStart(4, "0"),
		(date.getUTCMonth() + 1).toString().padStart(2, "0"),
		date.getUTCDate().toString().padStart(2, "0"),
		date.getUTCHours().toString().padStart(2, "0"),
		date.getUTCMinutes().toString().padStart(2, "0"),
		date.getUTCSeconds().toString().padStart(2, "0"),
	].join("");
	return roundTrip === stamp ? date : undefined;
}

function quoteIdentifier(value: string): string {
	if (!DATABASE_PATTERN.test(value) || value.length > MAX_IDENTIFIER_LENGTH) {
		throw new TypeError(
			"Refusing to mutate an unsafe PostgreSQL database name",
		);
	}
	return `"${value}"`;
}

function databaseUrlFor(adminUrl: string, database: string): string {
	const url = new URL(adminUrl);
	url.pathname = `/${database}`;
	return url.toString();
}

async function cleanupSetupFailure(input: {
	client: PostgresAdminClient | undefined;
	name: string;
	databaseCreated: boolean;
	leaseHeld: boolean;
	timeoutMs: number;
}): Promise<unknown[]> {
	const errors: unknown[] = [];
	if (!input.client) return errors;
	if (input.databaseCreated) {
		try {
			await withTimeout(
				input.client.query(
					`DROP DATABASE IF EXISTS ${quoteIdentifier(input.name)} WITH (FORCE)`,
				),
				input.timeoutMs,
				`drop failed-setup PostgreSQL database ${input.name}`,
			);
		} catch (error) {
			errors.push(error);
		}
	}
	if (input.leaseHeld) {
		try {
			await withTimeout(
				input.client.query(
					"SELECT pg_advisory_unlock(hashtextextended($1, 0))",
					[input.name],
				),
				input.timeoutMs,
				`release failed-setup PostgreSQL lease ${input.name}`,
			);
		} catch (error) {
			errors.push(error);
		}
	}
	try {
		await withTimeout(
			input.client.end(),
			input.timeoutMs,
			"close failed-setup PostgreSQL admin client",
		);
	} catch (error) {
		errors.push(error);
	}
	return errors;
}

async function disposeDatabase(
	client: PostgresAdminClient,
	name: string,
	timeoutMs: number,
): Promise<void> {
	const errors: unknown[] = [];
	try {
		await withTimeout(
			client.query(
				`DROP DATABASE IF EXISTS ${quoteIdentifier(name)} WITH (FORCE)`,
			),
			timeoutMs,
			`drop PostgreSQL database ${name}`,
		);
	} catch (error) {
		errors.push(error);
	}
	try {
		await withTimeout(
			client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [
				name,
			]),
			timeoutMs,
			`release PostgreSQL lease ${name}`,
		);
	} catch (error) {
		errors.push(error);
	}
	try {
		await withTimeout(client.end(), timeoutMs, "close PostgreSQL admin client");
	} catch (error) {
		errors.push(error);
	}
	if (errors.length > 0) throw new DisposablePostgresCleanupError(errors);
}
