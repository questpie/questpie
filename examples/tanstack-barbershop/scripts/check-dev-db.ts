#!/usr/bin/env bun

import { SQL } from "bun";

const defaultDatabaseUrl =
	"postgresql://barbershop:barbershop_dev_password@localhost:55432/barbershop";

const databaseUrl = process.env.DATABASE_URL || defaultDatabaseUrl;
const maxAttempts = Number(process.env.DB_CHECK_ATTEMPTS || "10");
const retryDelayMs = Number(process.env.DB_CHECK_DELAY_MS || "500");

function describeTarget(url: string): string {
	try {
		const parsed = new URL(url);
		return `${parsed.hostname}:${parsed.port || "5432"}/${parsed.pathname.replace(/^\//, "")}`;
	} catch {
		return url;
	}
}

function getReason(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}

async function main() {
	let lastError: unknown;

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		const sql = new SQL({ url: databaseUrl });

		try {
			await sql`select 1`;
			await sql.close();
			console.log(
				`[barbershop] Postgres ready at ${describeTarget(databaseUrl)}`,
			);
			return;
		} catch (error) {
			lastError = error;
			await sql.close().catch(() => {});

			if (attempt < maxAttempts) {
				await Bun.sleep(retryDelayMs);
			}
		}
	}

	console.error(
		[
			`[barbershop] Cannot connect to Postgres at ${describeTarget(databaseUrl)}.`,
			`Reason: ${getReason(lastError)}`,
			"",
			"Start the example database with:",
			"  docker compose up -d postgres",
			"",
			"If this is an auth error, another Postgres is probably bound to the configured port,",
			"or the local database volume was created with different credentials.",
		].join("\n"),
	);
	process.exit(1);
}

await main();
