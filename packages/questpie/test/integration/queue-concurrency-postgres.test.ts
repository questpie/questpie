import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";

import pg from "pg";

import { PgBossAdapter } from "../../src/server/modules/core/integrated/queue/adapters/pg-boss.js";

const databaseUrl =
	process.env.QUESTPIE_QUEUE_POSTGRES_URL ??
	process.env.QUESTPIE_QUEUE_SECRET_POSTGRES_URL;

describe.skipIf(!databaseUrl)("pg-boss queue concurrency contract", () => {
	test.each([
		["explicit batch size", { teamSize: 2, batchSize: 1 }],
		[
			"undefined batch size from service options",
			{ teamSize: 2, batchSize: undefined },
		],
	] as const)(
		"teamSize runs concurrent handlers: %s",
		async (_label, options) => {
			const schema = `queue_concurrency_${randomUUID().replaceAll("-", "")}`;
			const adapter = new PgBossAdapter({
				connectionString: databaseUrl!,
				schema,
				useApplicationTransaction: false,
			});
			const pool = new pg.Pool({ connectionString: databaseUrl! });
			let release!: () => void;
			const blocked = new Promise<void>((resolve) => {
				release = resolve;
			});
			let firstStarted!: () => void;
			const first = new Promise<void>((resolve) => {
				firstStarted = resolve;
			});
			let secondStarted!: () => void;
			const second = new Promise<void>((resolve) => {
				secondStarted = resolve;
			});
			let entered = 0;
			let timeout: ReturnType<typeof setTimeout> | undefined;

			try {
				await adapter.publish("concurrency-contract", { number: 1 });
				await adapter.publish("concurrency-contract", { number: 2 });
				await adapter.listen(
					{
						"concurrency-contract": async () => {
							entered += 1;
							if (entered === 1) firstStarted();
							if (entered === 2) secondStarted();
							await blocked;
						},
					},
					options,
				);
				const started = await Promise.race([
					first.then(() => true),
					new Promise<boolean>((resolve) => {
						timeout = setTimeout(() => resolve(false), 5_000);
					}),
				]);
				if (timeout) clearTimeout(timeout);
				expect(started).toBe(true);
				const concurrent = await Promise.race([
					second.then(() => true),
					new Promise<boolean>((resolve) => {
						timeout = setTimeout(() => resolve(false), 5_000);
					}),
				]);
				expect(concurrent).toBe(true);
				expect(entered).toBe(2);
			} finally {
				if (timeout) clearTimeout(timeout);
				release();
				try {
					await adapter.stop();
				} finally {
					try {
						await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
					} finally {
						await pool.end();
					}
				}
			}
		},
		15_000,
	);
});
