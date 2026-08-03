import { describe, expect, it } from "bun:test";

import {
	createDisposablePostgresWithClientFactory,
	sweepStalePostgresWithClientFactory,
	type PostgresAdminClient,
} from "../src/disposable-postgres.js";

type QueryCall = { text: string; values?: readonly unknown[] };

class FakeAdminClient implements PostgresAdminClient {
	readonly calls: QueryCall[] = [];
	connected = false;
	ended = false;

	constructor(
		private readonly databases: string[] = [],
		private readonly unavailableLeases = new Set<string>(),
		private readonly failDrop = false,
		private readonly dropDelayMs = 0,
		private readonly failConnect = false,
	) {}

	async connect(): Promise<void> {
		if (this.failConnect) throw new Error("connection refused");
		this.connected = true;
	}

	async query(
		text: string,
		values?: readonly unknown[],
	): Promise<{ rows: Record<string, unknown>[] }> {
		this.calls.push({ text, values });
		if (text.includes("FROM pg_database")) {
			return { rows: this.databases.map((datname) => ({ datname })) };
		}
		if (text.includes("pg_try_advisory_lock")) {
			return {
				rows: [{ acquired: !this.unavailableLeases.has(String(values?.[0])) }],
			};
		}
		if (this.failDrop && text.startsWith("DROP DATABASE")) {
			throw new Error("drop failed");
		}
		if (this.dropDelayMs > 0 && text.startsWith("DROP DATABASE")) {
			await Bun.sleep(this.dropDelayMs);
		}
		return { rows: [] };
	}

	async end(): Promise<void> {
		this.ended = true;
	}
}

const fixedIdentity = {
	now: () => new Date("2026-08-03T12:34:56.000Z"),
	randomSuffix: () => "a1b2c3",
};

describe("disposable PostgreSQL harness", () => {
	it("rejects unsafe admin targets before opening a connection", async () => {
		let createdClients = 0;
		const factory = () => {
			createdClients += 1;
			return new FakeAdminClient();
		};

		for (const adminUrl of [
			"mysql://localhost/postgres",
			"postgres://localhost",
			"postgres://localhost/qp_harness_20260803123456_a1b2c3",
			"not a url",
		]) {
			await expect(
				createDisposablePostgresWithClientFactory({ adminUrl }, factory, {
					...fixedIdentity,
				}),
			).rejects.toThrow();
		}

		expect(createdClients).toBe(0);
	});

	it("creates, migrates, and idempotently force-drops one owned database", async () => {
		const clients: FakeAdminClient[] = [];
		const migrated: string[] = [];
		const database = await createDisposablePostgresWithClientFactory(
			{
				adminUrl: "postgres://admin:secret@localhost:5432/postgres",
				migrate: async (databaseUrl) => {
					migrated.push(databaseUrl);
				},
			},
			() => {
				const client = new FakeAdminClient();
				clients.push(client);
				return client;
			},
			fixedIdentity,
		);

		expect(database.name).toBe("qp_harness_20260803123456_a1b2c3");
		expect(database.runId).toBe("20260803123456_a1b2c3");
		expect(database.url).toBe(
			"postgres://admin:secret@localhost:5432/qp_harness_20260803123456_a1b2c3",
		);
		expect(migrated).toEqual([database.url]);

		await Promise.all([database.dispose(), database.dispose()]);

		const sql = clients.flatMap((client) =>
			client.calls.map((call) => call.text),
		);
		expect(sql).toContain('CREATE DATABASE "qp_harness_20260803123456_a1b2c3"');
		expect(
			sql.filter((text) =>
				text.startsWith(
					'DROP DATABASE IF EXISTS "qp_harness_20260803123456_a1b2c3"',
				),
			),
		).toHaveLength(1);
		expect(clients.every((client) => client.ended)).toBe(true);
	});

	it("sweeps only stale owned databases whose lease is available", async () => {
		const stale = "qp_harness_20260803110000_aaaaaa";
		const live = "qp_harness_20260803100000_bbbbbb";
		const fresh = "qp_harness_20260803122500_cccccc";
		const foreign = "customer_production";
		const malformed = "qp_harness_delete_me";
		const invalidDate = "qp_harness_20269999129999_dddddd";
		const client = new FakeAdminClient(
			[stale, live, fresh, foreign, malformed, invalidDate],
			new Set([live]),
		);

		const dropped = await sweepStalePostgresWithClientFactory(
			{
				adminUrl: "postgres://admin@localhost/postgres",
				staleAfterMs: 30 * 60 * 1000,
			},
			() => client,
			{ now: fixedIdentity.now },
		);

		expect(dropped).toEqual([stale]);
		const drops = client.calls
			.map((call) => call.text)
			.filter((text) => text.startsWith("DROP DATABASE"));
		expect(drops).toEqual([`DROP DATABASE IF EXISTS "${stale}" WITH (FORCE)`]);
		expect(client.ended).toBe(true);
	});

	it("bounds cleanup and makes connection failures actionable", async () => {
		const clients: FakeAdminClient[] = [];
		const database = await createDisposablePostgresWithClientFactory(
			{
				adminUrl: "postgres://admin@localhost/postgres",
				timeoutMs: 10,
			},
			() => {
				const client = new FakeAdminClient([], new Set(), false, 40);
				clients.push(client);
				return client;
			},
			fixedIdentity,
		);

		await expect(database.dispose()).rejects.toMatchObject({
			name: "DisposablePostgresCleanupError",
		});
		expect(clients.at(-1)?.ended).toBe(true);

		await expect(
			createDisposablePostgresWithClientFactory(
				{ adminUrl: "postgres://admin@localhost/postgres" },
				() => new FakeAdminClient([], new Set(), false, 0, true),
				fixedIdentity,
			),
		).rejects.toMatchObject({
			name: "DisposablePostgresSetupError",
			phase: "sweep",
			cause: expect.objectContaining({ message: "connection refused" }),
		});
	});

	it("retains migration failures and reports cleanup failures", async () => {
		const migrationCause = new Error("migration failed");

		try {
			await createDisposablePostgresWithClientFactory(
				{
					adminUrl: "postgres://admin@localhost/postgres",
					migrate: async () => {
						throw migrationCause;
					},
				},
				() => new FakeAdminClient([], new Set(), true),
				fixedIdentity,
			);
			expect.unreachable();
		} catch (error) {
			expect(error).toMatchObject({
				name: "DisposablePostgresSetupError",
				phase: "migrations",
				cause: migrationCause,
			});
			expect(
				(error as { cleanupErrors: readonly unknown[] }).cleanupErrors,
			).toHaveLength(1);
		}
	});
});
