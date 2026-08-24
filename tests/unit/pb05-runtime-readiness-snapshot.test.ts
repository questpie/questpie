import { expect, test } from "bun:test";

import { CompilerDiagnosticError } from "../../packages/compiler/src/diagnostic";
import { inPostgresRuntimeReadinessSnapshot } from "../../packages/compiler/src/runtime/postgres-readiness";

test("Runtime readiness owns one repeatable-read read-only snapshot", async () => {
	const transaction = Object.freeze({ identity: "transaction" });
	const modes: string[] = [];
	const sql = {
		async begin<Value>(
			mode: string,
			use: (value: typeof transaction) => Promise<Value>,
		): Promise<Value> {
			modes.push(mode);
			return use(transaction);
		},
	};
	let observed: unknown;

	await expect(
		inPostgresRuntimeReadinessSnapshot(sql, async (owned) => {
			observed = owned;
			return "ready";
		}),
	).resolves.toBe("ready");
	expect(modes).toEqual(["isolation level repeatable read read only"]);
	expect(observed).toBe(transaction);
});

test("Runtime readiness snapshot preserves a diagnostic failure", async () => {
	const failure = new CompilerDiagnosticError(
		"QP-SCHEMA-028",
		"changedObject",
		"readiness refused",
	);
	let commits = 0;
	const transaction = Object.freeze({ identity: "transaction" });
	const sql = {
		async begin<Value>(
			_mode: string,
			use: (value: typeof transaction) => Promise<Value>,
		): Promise<Value> {
			const value = await use(transaction);
			commits += 1;
			return value;
		},
	};

	await expect(
		inPostgresRuntimeReadinessSnapshot(sql, async () => {
			throw failure;
		}),
	).rejects.toBe(failure);
	expect(commits).toBe(1);
});

test("Runtime readiness snapshot does not swallow an operational failure", async () => {
	const failure = new Error("connection lost");
	const transaction = Object.freeze({ identity: "transaction" });
	const sql = {
		async begin<Value>(
			_mode: string,
			use: (value: typeof transaction) => Promise<Value>,
		): Promise<Value> {
			return use(transaction);
		},
	};

	await expect(
		inPostgresRuntimeReadinessSnapshot(sql, async () => {
			throw failure;
		}),
	).rejects.toBe(failure);
});
