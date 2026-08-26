import { decodeRelationalScalarCodec } from "../relational/scalar";
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
} from "./postgres-program-decode";
import type {
	LinkedPostgresUpdateOperationPlanV1,
	RecordValue,
} from "./postgres-program-types";
import type { LinkedCollectionOperationProgramV1 } from "./program";

export function updatePlan(
	plan: RecordValue,
	operation: LinkedCollectionOperationProgramV1,
): LinkedPostgresUpdateOperationPlanV1 {
	exact(
		plan,
		[
			"identity",
			"target",
			"member",
			"policy",
			"outputCardinality",
			"lifecycle",
			"normalizerProgram",
			"serverValueProgram",
			"candidate",
			"lock",
			"fieldAuthority",
			"currentPolicy",
			"candidatePolicy",
			"outputAuthority",
			"write",
			"limits",
		],
		`plan ${operation.identity}`,
	);
	header(plan, operation, "update");
	const lifecycle = [
		"keyedRowLock",
		"freshCurrentPolicy",
		"sparseCallerFieldAuthority",
		"pureNormalization",
		"serverValues",
		"completeCandidateValidation",
		"candidatePolicy",
		"postgresConstraints",
		"selection",
		"outputFieldAuthority",
		"outputValidation",
	] as const;
	if (!same(plan.lifecycle, lifecycle))
		fail(`${operation.identity} lifecycle is invalid`);
	if (
		!same(plan.normalizerProgram, operation.normalizerProgram) ||
		!same(plan.serverValueProgram, operation.serverValueProgram)
	)
		fail(
			`${operation.identity} executable write-program digest link is invalid`,
		);
	const candidate = record(plan.candidate, `${operation.identity} candidate`);
	exact(candidate, ["steps", "fields"], `${operation.identity} candidate`);
	const steps = array(
		candidate.steps,
		`${operation.identity} candidate steps`,
	).map((raw, index) => {
		const step = record(raw, `${operation.identity} candidate step ${index}`);
		if (
			step.phase !== "callerInput" &&
			step.phase !== "normalizer" &&
			step.phase !== "serverValue"
		)
			fail(`${operation.identity} candidate step ${index} is invalid`);
		path(step.target, `${operation.identity} candidate step ${index} target`);
		return Object.freeze({ ...step });
	});
	const fields = array(
		candidate.fields,
		`${operation.identity} candidate fields`,
	).map((raw, index) => {
		const field = record(raw, `${operation.identity} candidate field ${index}`);
		exact(
			field,
			["path", "codec", "nullable"],
			`${operation.identity} candidate field ${index}`,
		);
		if (typeof field.nullable !== "boolean")
			fail(
				`${operation.identity} candidate field ${index} nullable is invalid`,
			);
		return Object.freeze({
			path: path(
				field.path,
				`${operation.identity} candidate field ${index} path`,
			),
			codec: decodeRelationalScalarCodec(
				field.codec,
				`${operation.identity} candidate field ${index} codec`,
			),
			nullable: field.nullable,
		});
	});
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
	const authority = record(
		plan.fieldAuthority,
		`${operation.identity} fieldAuthority`,
	);
	exact(
		authority,
		["suppliedPathsOnly", "checks"],
		`${operation.identity} fieldAuthority`,
	);
	if (authority.suppliedPathsOnly !== true)
		fail(`${operation.identity} Field authority is not sparse`);
	const checks = array(
		authority.checks,
		`${operation.identity} Field checks`,
	).map((raw, index) => {
		const check = record(raw, `${operation.identity} Field check ${index}`);
		exact(
			check,
			["path", "sql", "parameters"],
			`${operation.identity} Field check ${index}`,
		);
		const sql = statement(
			check.sql,
			`${operation.identity} Field check ${index} SQL`,
		);
		const parameters = decodePostgresCollectionParameters(
			check.parameters,
			sql,
			`${operation.identity} Field check ${index}`,
		);
		return Object.freeze({
			path: path(check.path, `${operation.identity} Field check ${index} path`),
			sql,
			parameters,
			statement: bindPostgresCollectionStatement({
				identity: operation.identity,
				leaf: `field-authority-${index}`,
				text: sql,
				parameterCount: parameters.length,
				booleanResult: true,
			}),
		});
	});
	if (
		checks.length !== operation.callerInputFields.length ||
		checks.some(
			(check, index) => !same(check.path, operation.callerInputFields[index]),
		)
	)
		fail(`${operation.identity} Field checks do not match caller input`);
	const decodePolicy = (value: unknown, label: string) => {
		const policy = record(value, label);
		exact(
			policy,
			["freshAfterRowLockWait", "mutableEvidenceCollections", "sql"],
			label,
		);
		if (policy.freshAfterRowLockWait !== true) fail(`${label} is not fresh`);
		return Object.freeze({
			freshAfterRowLockWait: true as const,
			mutableEvidenceCollections: evidence(
				policy.mutableEvidenceCollections,
				`${label} evidence`,
			),
			sql: statement(policy.sql, `${label} SQL`),
		});
	};
	const currentPolicy = decodePolicy(
		plan.currentPolicy,
		`${operation.identity} currentPolicy`,
	);
	const candidatePolicy = decodePolicy(
		plan.candidatePolicy,
		`${operation.identity} candidatePolicy`,
	);
	const write = record(plan.write, `${operation.identity} write`);
	exact(write, ["sql", "parameters", "result"], `${operation.identity} write`);
	const writeSql = statement(write.sql, `${operation.identity} write SQL`);
	if (
		!writeSql.includes(currentPolicy.sql) ||
		!writeSql.includes(candidatePolicy.sql)
	)
		fail(`${operation.identity} write omits fresh Policy`);
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
		member: "update",
		policy: operation.policy,
		outputCardinality: "optionalOne",
		lifecycle,
		normalizerProgram: operation.normalizerProgram,
		serverValueProgram: operation.serverValueProgram,
		candidate: Object.freeze({
			steps: Object.freeze(steps),
			fields: Object.freeze(fields),
		}),
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
		fieldAuthority: Object.freeze({
			suppliedPathsOnly: true,
			checks: Object.freeze(checks),
		}),
		currentPolicy,
		candidatePolicy,
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
