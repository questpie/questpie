import {
	bindPostgresCollectionStatement,
	decodePostgresCollectionParameters,
} from "./postgres-collection-statement";
import { decodePostgresStatement as statement } from "./postgres-program-codec";
import {
	evidence,
	exact,
	fail,
	header,
	outputAuthority,
	record,
	results,
	same,
} from "./postgres-program-decode";
import type {
	LinkedPostgresDeleteOperationPlanV1,
	RecordValue,
} from "./postgres-program-types";
import type { LinkedCollectionOperationProgramV1 } from "./program";

/**
 * Delete has no candidate, so this re-derives and verifies far less than
 * `updatePlan`: a `FOR UPDATE` lock (identical shape to `get`/`update`'s),
 * one fresh row-scope Policy check, and a `DELETE ... RETURNING` write that
 * must embed that same check. There is no authored lifecycle wiring in this
 * slice (ADR-0047), so `candidateValidation`/`candidatePolicyCheck` never
 * apply to delete and are intentionally absent from its plan shape.
 */
export function deletePlan(
	plan: RecordValue,
	operation: LinkedCollectionOperationProgramV1,
): LinkedPostgresDeleteOperationPlanV1 {
	exact(
		plan,
		[
			"identity",
			"target",
			"member",
			"policy",
			"outputCardinality",
			"lifecycle",
			"lock",
			"currentPolicy",
			"outputAuthority",
			"write",
			"limits",
		],
		`plan ${operation.identity}`,
	);
	header(plan, operation, "delete");
	const lifecycle = [
		"keyedRowLock",
		"freshCurrentPolicy",
		"postgresConstraints",
		"selection",
		"outputFieldAuthority",
	] as const;
	if (!same(plan.lifecycle, lifecycle))
		fail(`${operation.identity} lifecycle is invalid`);
	if (
		operation.callerInputFields.length > 0 ||
		operation.trustedValueFields.length > 0
	)
		fail(
			`${operation.identity} delete cannot declare caller or trusted value Fields`,
		);
	const lock = record(plan.lock, `${operation.identity} lock`);
	exact(lock, ["sql", "parameters", "outcome"], `${operation.identity} lock`);
	const lockSql = statement(lock.sql, `${operation.identity} lock SQL`);
	if (
		lock.outcome !== "internalLockedOrAbsent" ||
		!/\bFOR\s+UPDATE\b/i.test(lockSql)
	)
		fail(`${operation.identity} keyed lock is invalid`);
	const lockParameters = decodePostgresCollectionParameters(
		lock.parameters,
		lockSql,
		`${operation.identity} lock`,
	);
	if (
		lockParameters.some(({ kind }) => kind !== "key") ||
		!same(
			lockParameters.map((parameter) =>
				parameter.kind === "key" ? parameter.path : [],
			),
			operation.keyFields,
		)
	)
		fail(`${operation.identity} lock does not bind the exact key`);
	const currentPolicyRecord = record(
		plan.currentPolicy,
		`${operation.identity} currentPolicy`,
	);
	exact(
		currentPolicyRecord,
		["freshAfterRowLockWait", "mutableEvidenceCollections", "sql"],
		`${operation.identity} currentPolicy`,
	);
	if (currentPolicyRecord.freshAfterRowLockWait !== true)
		fail(`${operation.identity} currentPolicy is not fresh`);
	const currentPolicy = Object.freeze({
		freshAfterRowLockWait: true as const,
		mutableEvidenceCollections: evidence(
			currentPolicyRecord.mutableEvidenceCollections,
			`${operation.identity} currentPolicy evidence`,
		),
		sql: statement(
			currentPolicyRecord.sql,
			`${operation.identity} currentPolicy SQL`,
		),
	});
	const write = record(plan.write, `${operation.identity} write`);
	exact(write, ["sql", "parameters", "result"], `${operation.identity} write`);
	const writeSql = statement(write.sql, `${operation.identity} write SQL`);
	if (!writeSql.includes(currentPolicy.sql))
		fail(`${operation.identity} write omits fresh Policy`);
	if (!/\bDELETE\s+FROM\b/i.test(writeSql))
		fail(`${operation.identity} write is not a DELETE statement`);
	const writeParameters = decodePostgresCollectionParameters(
		write.parameters,
		writeSql,
		`${operation.identity} write`,
	);
	const result = results(
		write.result,
		writeSql,
		operation,
		`${operation.identity} write`,
	);
	const output = outputAuthority(
		plan.outputAuthority,
		result,
		`${operation.identity} outputAuthority`,
	);
	const limits = record(plan.limits, `${operation.identity} limits`);
	exact(
		limits,
		["rows", "durationMilliseconds"],
		`${operation.identity} limits`,
	);
	if (
		limits.rows !== operation.limits.rowsWritten ||
		limits.rows !== 100 ||
		limits.durationMilliseconds !== operation.limits.durationMilliseconds ||
		limits.durationMilliseconds !== 5_000
	)
		fail(`${operation.identity} limits are invalid`);
	return Object.freeze({
		identity: operation.identity,
		target: operation.target,
		member: "delete",
		policy: operation.policy,
		outputCardinality: "optionalOne",
		lifecycle,
		lock: Object.freeze({
			sql: lockSql,
			parameters: lockParameters,
			outcome: "internalLockedOrAbsent",
			statement: bindPostgresCollectionStatement({
				identity: operation.identity,
				leaf: "lock",
				text: lockSql,
				parameterCount: lockParameters.length,
				booleanResult: true,
			}),
		}),
		currentPolicy,
		outputAuthority: output,
		write: Object.freeze({
			sql: writeSql,
			parameters: writeParameters,
			result,
			statement: bindPostgresCollectionStatement({
				identity: operation.identity,
				leaf: "write",
				text: writeSql,
				parameterCount: writeParameters.length,
				result,
			}),
		}),
		limits: Object.freeze({ rows: 100, durationMilliseconds: 5_000 }),
		operation,
	});
}
