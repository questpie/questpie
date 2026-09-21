import { decodeMutationFieldCodec } from "./field-codec";
import {
	bindPostgresCollectionStatement,
	decodePostgresCollectionParameters,
} from "./postgres-collection-statement";
import { decodePostgresStatement as statement } from "./postgres-program-codec";
import {
	array,
	evidence,
	exact,
	fail,
	header,
	outputAuthority,
	path,
	record,
	results,
	same,
	text,
} from "./postgres-program-decode";
import type {
	LinkedPostgresDeleteOperationPlanV1,
	PostgresResultV1,
	RecordValue,
} from "./postgres-program-types";
import type { LinkedCollectionOperationProgramV1 } from "./program";

/**
 * Delete has no candidate, so this re-derives and verifies far less than
 * `updatePlan`: a `FOR UPDATE` lock (identical shape to `get`/`update`'s),
 * one fresh row-scope Policy check, and a `DELETE ... RETURNING` write that
 * must embed that same check. There is no authored `check`/`afterWrite`
 * wiring in this slice (ADR-0047): only `currentValidation` is present, and
 * only when the Collection has a lifecycle program, decoding the full
 * locked current row for the runtime to interpret `validate` against.
 */
function decodeCurrentValidationResult(
	value: unknown,
	statementText: string,
	label: string,
): readonly PostgresResultV1[] {
	const decoded = array(value, `${label} result`).map((raw, index) => {
		const source = record(raw, `${label} result ${index}`);
		exact(
			source,
			["path", "column", "codec", "nullable"],
			`${label} result ${index}`,
		);
		if (typeof source.nullable !== "boolean")
			fail(`${label} result ${index} nullable is invalid`);
		const column = text(source.column, `${label} result ${index} column`);
		if (
			column !== `qp_result_${index}` ||
			!statementText.includes(`AS "${column}"`)
		)
			fail(`${label} result ${index} column is not projected by SQL`);
		return Object.freeze({
			path: path(source.path, `${label} result ${index} path`),
			column,
			codec: decodeMutationFieldCodec(
				source.codec,
				`${label} result ${index} codec`,
			),
			nullable: source.nullable,
		});
	});
	if (
		new Set(decoded.map((item) => JSON.stringify(item.path))).size !==
			decoded.length ||
		new Set(decoded.map(({ column }) => column)).size !== decoded.length
	)
		fail(`${label} result Fields must be unique`);
	return Object.freeze(decoded);
}
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
			...(operation.lifecycleProgram ? ["currentValidation"] : []),
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
	const currentValidation = operation.lifecycleProgram
		? (() => {
				const validation = record(
					plan.currentValidation,
					`${operation.identity} currentValidation`,
				);
				exact(
					validation,
					["freshAfterRowLockWait", "sql", "parameters", "result"],
					`${operation.identity} currentValidation`,
				);
				if (validation.freshAfterRowLockWait !== true)
					fail(`${operation.identity} currentValidation is not fresh`);
				const sql = statement(
					validation.sql,
					`${operation.identity} currentValidation SQL`,
				);
				const parameters = decodePostgresCollectionParameters(
					validation.parameters,
					sql,
					`${operation.identity} currentValidation`,
				);
				const result = decodeCurrentValidationResult(
					validation.result,
					sql,
					`${operation.identity} currentValidation`,
				);
				return Object.freeze({
					freshAfterRowLockWait: true as const,
					sql,
					parameters,
					result,
					statement: bindPostgresCollectionStatement({
						identity: operation.identity,
						leaf: "current-validation",
						text: sql,
						parameterCount: parameters.length,
						result,
					}),
				});
			})()
		: undefined;
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
	// A destructive statement's key binding is worth re-verifying explicitly
	// rather than trusting the SQL text alone (mirrors the lock check above):
	// the DELETE must bind exactly the compiled key, once per Field.
	const writeKeyPaths = writeParameters
		.map((parameter) => (parameter.kind === "key" ? parameter.path : null))
		.filter(
			(path): path is (typeof operation.keyFields)[number] => path !== null,
		);
	if (!same(writeKeyPaths, operation.keyFields))
		fail(`${operation.identity} write does not bind the exact key`);
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
		...(currentValidation ? { currentValidation } : {}),
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
