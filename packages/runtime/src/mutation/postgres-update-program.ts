import { validateUpdateCandidatePolicySql } from "./postgres-candidate-policy";
import {
	bindPostgresCollectionStatement,
	decodePostgresCollectionParameters,
} from "./postgres-collection-statement";
import { decodePostgresStatement as statement } from "./postgres-program-codec";
import {
	array,
	candidateFields,
	candidateResults,
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
			"candidateValidation",
			"fieldAuthority",
			"currentPolicy",
			"candidatePolicy",
			...(operation.lifecycleProgram ? ["candidatePolicyCheck"] : []),
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
		"compareAndSet",
		"sparseCallerFieldAuthority",
		"pureNormalization",
		"serverValues",
		"trustedValues",
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
	const phaseOrder = [
		"callerInput",
		"normalizer",
		"serverValue",
		"trustedValue",
	];
	let lastPhase = -1;
	const steps = array(
		candidate.steps,
		`${operation.identity} candidate steps`,
	).map((raw, index) => {
		const step = record(raw, `${operation.identity} candidate step ${index}`);
		const phase = phaseOrder.indexOf(String(step.phase));
		if (phase < lastPhase || phase < 0)
			fail(`${operation.identity} candidate step order is invalid`);
		lastPhase = phase;
		const keys =
			step.phase === "callerInput" || step.phase === "trustedValue"
				? ["phase", "target"]
				: step.phase === "normalizer"
					? ["phase", "target", "transform"]
					: ["phase", "target", "mode", "source"];
		exact(step, keys, `${operation.identity} candidate step ${index}`);
		path(step.target, `${operation.identity} candidate step ${index} target`);
		if (
			step.phase === "normalizer" &&
			step.transform !== "trim" &&
			step.transform !== "trimIfPresent"
		)
			fail(`${operation.identity} normalizer step is invalid`);
		if (step.phase === "serverValue") {
			if (step.mode !== "overwrite")
				fail(`${operation.identity} server-value step is invalid`);
			path(step.source, `${operation.identity} server-value source`);
		}
		return Object.freeze({ ...step });
	});
	if (
		!same(
			steps
				.filter((step) => step.phase === "trustedValue")
				.map((step) => step.target),
			operation.trustedValueFields,
		)
	)
		fail(`${operation.identity} candidate trusted values are invalid`);
	const fields = candidateFields(candidate.fields, operation.identity);
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
	const candidatePolicyCheck = operation.lifecycleProgram
		? (() => {
				const check = record(
					plan.candidatePolicyCheck,
					`${operation.identity} candidatePolicyCheck`,
				);
				exact(
					check,
					["freshAfterRowLockWait", "sql", "parameters", "outcome"],
					`${operation.identity} candidatePolicyCheck`,
				);
				if (
					check.freshAfterRowLockWait !== true ||
					check.outcome !== "authorizedOrUnavailable"
				)
					fail(`${operation.identity} candidate Policy check is invalid`);
				const sql = statement(
					check.sql,
					`${operation.identity} candidatePolicyCheck SQL`,
				);
				const parameters = decodePostgresCollectionParameters(
					check.parameters,
					sql,
					`${operation.identity} candidatePolicyCheck`,
				);
				validateUpdateCandidatePolicySql({
					sql,
					currentPolicySql: currentPolicy.sql,
					candidatePolicySql: candidatePolicy.sql,
					policyParameters: writeParameters,
					parameters,
					fields,
					keyFields: operation.keyFields,
					lockSql,
					label: `${operation.identity} candidate Policy check`,
				});
				return Object.freeze({
					freshAfterRowLockWait: true as const,
					sql,
					parameters,
					outcome: "authorizedOrUnavailable" as const,
					statement: bindPostgresCollectionStatement({
						identity: operation.identity,
						leaf: "candidate-policy",
						text: sql,
						parameterCount: parameters.length,
						booleanResult: true,
					}),
				});
			})()
		: undefined;
	const validation = record(
		plan.candidateValidation,
		`${operation.identity} candidateValidation`,
	);
	exact(
		validation,
		[
			"freshAfterRowLockWait",
			"sql",
			"parameters",
			"result",
			...(operation.lifecycleProgram ? ["currentResult"] : []),
		],
		`${operation.identity} candidateValidation`,
	);
	if (validation.freshAfterRowLockWait !== true)
		fail(`${operation.identity} candidate validation is not fresh`);
	const validationSql = statement(
		validation.sql,
		`${operation.identity} candidateValidation SQL`,
	);
	if (!validationSql.includes(currentPolicy.sql))
		fail(`${operation.identity} candidate validation omits current Policy`);
	const validationParameters = decodePostgresCollectionParameters(
		validation.parameters,
		validationSql,
		`${operation.identity} candidateValidation`,
	);
	const validationResult = candidateResults(
		validation.result,
		validationSql,
		fields,
		`${operation.identity} candidateValidation`,
	);
	const validationCurrentResult = operation.lifecycleProgram
		? candidateResults(
				validation.currentResult,
				validationSql,
				fields,
				`${operation.identity} candidateValidation current`,
				"qp_current",
			)
		: undefined;
	const expectedParameters = writeParameters.filter(
		({ kind }) => kind === "expectedPresent" || kind === "expectedValue",
	);
	if (
		expectedParameters.length !== fields.length * 2 ||
		fields.some((field, index) => {
			const present = expectedParameters[index * 2];
			const value = expectedParameters[index * 2 + 1];
			return (
				present?.kind !== "expectedPresent" ||
				value?.kind !== "expectedValue" ||
				!same(present.path, field.path) ||
				!same(value.path, field.path) ||
				!same(value.codec, field.codec)
			);
		})
	)
		fail(`${operation.identity} compare-and-set parameters are invalid`);
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
		candidateValidation: Object.freeze({
			freshAfterRowLockWait: true,
			sql: validationSql,
			parameters: validationParameters,
			result: validationResult,
			...(validationCurrentResult
				? { currentResult: validationCurrentResult }
				: {}),
			statement: bindPostgresCollectionStatement({
				identity: operation.identity,
				leaf: "candidate-validation",
				text: validationSql,
				parameterCount: validationParameters.length,
				result: [...validationResult, ...(validationCurrentResult ?? [])],
			}),
		}),
		fieldAuthority: Object.freeze({
			suppliedPathsOnly: true,
			checks: Object.freeze(checks),
		}),
		currentPolicy,
		candidatePolicy,
		...(candidatePolicyCheck ? { candidatePolicyCheck } : {}),
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
