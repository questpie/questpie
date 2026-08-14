import { createHash } from "node:crypto";

import type { SQL } from "bun";

import { CompilerDiagnosticError } from "./diagnostic";

export interface PostgresCommandControl {
	readonly lockTimeoutMs?: number;
	readonly statementTimeoutMs?: number;
}

export interface ResolvedPostgresControl {
	readonly lockTimeoutMs: number;
	readonly statementTimeoutMs: number;
}

const MAX_POSTGRES_TIMEOUT_MS = 2_147_483_647;

export function resolvePostgresControl(
	input: PostgresCommandControl,
): ResolvedPostgresControl {
	const lockTimeoutMs = input.lockTimeoutMs ?? 5_000;
	const statementTimeoutMs = input.statementTimeoutMs ?? 30_000;
	if (
		!Number.isSafeInteger(lockTimeoutMs) ||
		lockTimeoutMs <= 0 ||
		lockTimeoutMs > MAX_POSTGRES_TIMEOUT_MS ||
		!Number.isSafeInteger(statementTimeoutMs) ||
		statementTimeoutMs <= lockTimeoutMs ||
		statementTimeoutMs > MAX_POSTGRES_TIMEOUT_MS
	)
		throw new RangeError(
			"PostgreSQL timeouts require 0 < lockTimeoutMs < statementTimeoutMs <= 2147483647",
		);
	return { lockTimeoutMs, statementTimeoutMs };
}

export async function configurePostgresTimeouts(
	sql: SQL,
	control: ResolvedPostgresControl,
): Promise<void> {
	await sql`
		select pg_catalog.set_config('lock_timeout', ${`${control.lockTimeoutMs}ms`}, false),
		       pg_catalog.set_config('statement_timeout', ${`${control.statementTimeoutMs}ms`}, false)
	`;
}

export function lockKey(domain: string, ...values: string[]): bigint {
	return createHash("sha256")
		.update(`${domain}\0${values.join("\0")}`)
		.digest()
		.readBigInt64BE(0);
}

export async function backendPid(sql: SQL): Promise<number> {
	const [row] = await sql<{ pid: number }[]>`
		select pg_catalog.pg_backend_pid() as pid
	`;
	return row?.pid ?? -1;
}

export async function assertBackendPid(
	sql: SQL,
	expected: number,
	phase: string,
): Promise<void> {
	const actual = await backendPid(sql);
	if (expected < 0 || actual !== expected)
		throw new CompilerDiagnosticError(
			"QP-SCHEMA-007",
			"providerMismatch",
			`PostgreSQL endpoint lost session affinity during ${phase}`,
			{ expected, actual },
		);
}

export async function probeSessionAffinity(
	commitProbe: () => Promise<number>,
): Promise<number> {
	const first = await commitProbe();
	const second = await commitProbe();
	if (first < 0 || first !== second)
		throw new CompilerDiagnosticError(
			"QP-SCHEMA-007",
			"providerMismatch",
			"PostgreSQL endpoint is not session-affine across committed probes",
			{ first, second },
		);
	return first;
}

export function probeCommittedSession(sql: SQL): Promise<number> {
	return probeSessionAffinity(() =>
		sql.begin(async (transaction) => backendPid(transaction)),
	);
}
