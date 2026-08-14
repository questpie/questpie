import { createHash } from "node:crypto";

import type { SQL } from "bun";

import { CompilerDiagnosticError } from "./diagnostic";

export interface PostgresCommandControl {
	readonly lockTimeoutMs?: number;
	readonly signal?: AbortSignal;
	readonly statementTimeoutMs?: number;
}

export interface PostgresControl {
	readonly lockTimeoutMs: number;
	readonly statementTimeoutMs: number;
}

const MAX_POSTGRES_TIMEOUT_MS = 2_147_483_647;

export function resolvePostgresControl(
	input: PostgresCommandControl,
): PostgresControl {
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
	control: PostgresControl,
): Promise<void> {
	await sql`
		select pg_catalog.set_config('lock_timeout', ${`${control.lockTimeoutMs}ms`}, false),
		       pg_catalog.set_config('statement_timeout', ${`${control.statementTimeoutMs}ms`}, false)
	`;
}

export interface AbortableQuery<T> extends PromiseLike<T> {
	cancel(): AbortableQuery<T>;
	execute(): AbortableQuery<T>;
}

export async function executeAbortable<T>(
	query: AbortableQuery<T>,
	signal?: AbortSignal,
): Promise<T> {
	signal?.throwIfAborted();
	const executing = query.execute();
	const cancel = () => {
		executing.cancel();
	};
	signal?.addEventListener("abort", cancel, { once: true });
	try {
		return await executing;
	} finally {
		signal?.removeEventListener("abort", cancel);
	}
}

export function cancelBackendOnAbort(
	sql: SQL,
	pid: number,
	signal?: AbortSignal,
): () => void {
	if (!signal) return () => {};
	let listening = true;
	const cancel = () => {
		if (!listening) return;
		void sql`select pg_catalog.pg_cancel_backend(${pid})`
			.execute()
			.catch(() => {});
	};
	signal.addEventListener("abort", cancel, { once: true });
	if (signal.aborted) cancel();
	return () => {
		listening = false;
		signal.removeEventListener("abort", cancel);
	};
}

export async function acquireSessionLock(
	sql: SQL,
	key: bigint,
	control: PostgresControl,
	signal?: AbortSignal,
): Promise<void> {
	if (!signal) {
		await sql`select pg_catalog.pg_advisory_lock(${key})`;
		return;
	}
	const deadline = performance.now() + control.lockTimeoutMs;
	while (performance.now() < deadline) {
		signal.throwIfAborted();
		const [result] = await executeAbortable<{ acquired: boolean }[]>(
			sql`select pg_catalog.pg_try_advisory_lock(${key}) as acquired`,
			signal,
		);
		if (result?.acquired) return;
		await abortableDelay(10, signal);
	}
	await sql`select pg_catalog.set_config('lock_timeout', '1ms', false)`;
	await sql`select pg_catalog.pg_advisory_lock(${key})`;
}

function abortableDelay(
	milliseconds: number,
	signal: AbortSignal,
): Promise<void> {
	signal.throwIfAborted();
	return new Promise((resolve, reject) => {
		const finish = () => {
			signal.removeEventListener("abort", abort);
			resolve();
		};
		const timer = setTimeout(finish, milliseconds);
		const abort = () => {
			clearTimeout(timer);
			signal.removeEventListener("abort", abort);
			reject(signal.reason);
		};
		signal.addEventListener("abort", abort, { once: true });
	});
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

export async function withPinnedTransaction<T>(
	sql: SQL,
	expectedPid: number,
	phase: string,
	signal: AbortSignal | undefined,
	operation: (transaction: SQL) => Promise<T>,
): Promise<T> {
	signal?.throwIfAborted();
	await assertBackendPid(sql, expectedPid, `before ${phase}`);
	await sql.unsafe("BEGIN");
	try {
		await assertBackendPid(sql, expectedPid, `${phase} start`);
		const result = await operation(sql);
		await assertBackendPid(sql, expectedPid, `${phase} end`);
		await sql.unsafe("COMMIT");
		await assertBackendPid(sql, expectedPid, `after ${phase}`);
		return result;
	} catch (error) {
		await sql.unsafe("ROLLBACK");
		throw error;
	}
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
