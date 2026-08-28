import { runtimeArtifactDigest } from "../application/artifact-protocol";
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
	text,
} from "./postgres-program-decode";
import type {
	LinkedPostgresCollectionOperationPlansV1,
	LinkedPostgresCreateOperationPlanV1,
	LinkedPostgresGetOperationPlanV1,
	RecordValue,
} from "./postgres-program-types";
import { updatePlan } from "./postgres-update-program";
import type {
	LinkedCollectionMutationProgramsV1,
	LinkedCollectionOperationProgramV1,
} from "./program";

export type {
	LinkedPostgresCollectionOperationPlanV1,
	LinkedPostgresCollectionOperationPlansV1,
	LinkedPostgresCreateOperationPlanV1,
	LinkedPostgresGetOperationPlanV1,
	LinkedPostgresUpdateOperationPlanV1,
} from "./postgres-program-types";

function createPlan(
	plan: RecordValue,
	operation: LinkedCollectionOperationProgramV1,
): LinkedPostgresCreateOperationPlanV1 {
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
			"fieldAuthority",
			...(operation.lifecycleProgram ? ["candidateValidation"] : []),
			"candidatePolicy",
			"outputAuthority",
			"write",
			"limits",
		],
		`plan ${operation.identity}`,
	);
	header(plan, operation, "create");
	const lifecycle = [
		"sparseCallerFieldAuthority",
		"pureNormalization",
		"schemaDefaults",
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
		"schemaDefault",
		"serverValue",
		"trustedValue",
	];
	let lastPhase = -1;
	const steps = array(
		candidate.steps,
		`${operation.identity} candidate steps`,
	).map((raw, index) => {
		const step = record(raw, `${operation.identity} candidate step ${index}`);
		const phase = text(
			step.phase,
			`${operation.identity} candidate step ${index} phase`,
		);
		const phaseIndex = phaseOrder.indexOf(phase);
		if (phaseIndex < lastPhase || phaseIndex < 0)
			fail(`${operation.identity} candidate step order is invalid`);
		lastPhase = phaseIndex;
		const keys =
			phase === "callerInput"
				? ["phase", "target"]
				: phase === "normalizer"
					? ["phase", "target", "transform"]
					: phase === "schemaDefault"
						? ["phase", "target", "value"]
						: phase === "serverValue"
							? ["phase", "target", "mode", "source"]
							: ["phase", "target"];
		exact(step, keys, `${operation.identity} candidate step ${index}`);
		path(step.target, `${operation.identity} candidate step ${index} target`);
		if (
			phase === "normalizer" &&
			step.transform !== "trim" &&
			step.transform !== "trimIfPresent"
		)
			fail(`${operation.identity} normalizer step is invalid`);
		if (phase === "serverValue") {
			if (step.mode !== "overwrite")
				fail(`${operation.identity} server-value step is invalid`);
			path(step.source, `${operation.identity} server-value source`);
		}
		if (phase === "schemaDefault") {
			const value = step.value;
			if (
				value !== null &&
				!["boolean", "number", "string"].includes(typeof value)
			)
				fail(`${operation.identity} schema default is invalid`);
		}
		return Object.freeze({ ...step });
	});
	const fields = candidateFields(candidate.fields, operation.identity);
	for (const callerPath of operation.callerInputFields)
		if (
			!steps.some(
				(step) => step.phase === "callerInput" && same(step.target, callerPath),
			)
		)
			fail(`${operation.identity} candidate omits caller input`);
	if (
		!same(
			steps
				.filter((step) => step.phase === "trustedValue")
				.map((step) => step.target),
			operation.trustedValueFields,
		)
	)
		fail(`${operation.identity} candidate trusted values are invalid`);
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
		return Object.freeze({
			path: path(check.path, `${operation.identity} Field check ${index} path`),
			sql,
			parameters: decodePostgresCollectionParameters(
				check.parameters,
				sql,
				`${operation.identity} Field check ${index}`,
			),
			statement: bindPostgresCollectionStatement({
				identity: operation.identity,
				leaf: `field-authority-${index}`,
				text: sql,
				parameterCount: array(
					check.parameters,
					`${operation.identity} Field check ${index} parameters`,
				).length,
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
	const candidateValidation = operation.lifecycleProgram
		? (() => {
				const validation = record(
					plan.candidateValidation,
					`${operation.identity} candidateValidation`,
				);
				exact(
					validation,
					["freshAfterRowLockWait", "sql", "parameters", "result"],
					`${operation.identity} candidateValidation`,
				);
				if (validation.freshAfterRowLockWait !== true)
					fail(`${operation.identity} candidate validation is not fresh`);
				const sql = statement(
					validation.sql,
					`${operation.identity} candidateValidation SQL`,
				);
				const parameters = decodePostgresCollectionParameters(
					validation.parameters,
					sql,
					`${operation.identity} candidateValidation`,
				);
				const result = candidateResults(
					validation.result,
					sql,
					fields,
					`${operation.identity} candidateValidation`,
				);
				return Object.freeze({
					freshAfterRowLockWait: true as const,
					sql,
					parameters,
					result,
					statement: bindPostgresCollectionStatement({
						identity: operation.identity,
						leaf: "candidate-validation",
						text: sql,
						parameterCount: parameters.length,
						result,
					}),
				});
			})()
		: undefined;
	const candidatePolicy = record(
		plan.candidatePolicy,
		`${operation.identity} candidatePolicy`,
	);
	exact(
		candidatePolicy,
		["freshAfterRowLockWait", "mutableEvidenceCollections", "sql"],
		`${operation.identity} candidatePolicy`,
	);
	if (candidatePolicy.freshAfterRowLockWait !== true)
		fail(`${operation.identity} candidate Policy is not fresh`);
	const candidatePolicySql = statement(
		candidatePolicy.sql,
		`${operation.identity} candidate Policy SQL`,
	);
	const write = record(plan.write, `${operation.identity} write`);
	exact(write, ["sql", "parameters", "result"], `${operation.identity} write`);
	const writeSql = statement(write.sql, `${operation.identity} write SQL`);
	if (!writeSql.includes(candidatePolicySql))
		fail(`${operation.identity} write omits candidate Policy`);
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
		member: "create",
		policy: operation.policy,
		outputCardinality: "one",
		lifecycle,
		normalizerProgram: operation.normalizerProgram,
		serverValueProgram: operation.serverValueProgram,
		candidate: Object.freeze({
			steps: Object.freeze(steps),
			fields: Object.freeze(fields),
		}),
		fieldAuthority: Object.freeze({
			suppliedPathsOnly: true,
			checks: Object.freeze(checks),
		}),
		...(candidateValidation ? { candidateValidation } : {}),
		candidatePolicy: Object.freeze({
			freshAfterRowLockWait: true,
			mutableEvidenceCollections: evidence(
				candidatePolicy.mutableEvidenceCollections,
				`${operation.identity} candidate evidence`,
			),
			sql: candidatePolicySql,
		}),
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

function getPlan(
	plan: RecordValue,
	operation: LinkedCollectionOperationProgramV1,
): LinkedPostgresGetOperationPlanV1 {
	exact(
		plan,
		[
			"identity",
			"target",
			"member",
			"policy",
			"outputCardinality",
			"consistency",
			"lifecycle",
			"lock",
			"read",
			"outputAuthority",
			"limits",
		],
		`plan ${operation.identity}`,
	);
	header(plan, operation, "get");
	const consistency = record(
		plan.consistency,
		`${operation.identity} consistency`,
	);
	exact(
		consistency,
		["standalone", "nestedMutation"],
		`${operation.identity} consistency`,
	);
	if (
		consistency.standalone !== "readSnapshot" ||
		consistency.nestedMutation !== "keyedLockThenFreshPolicyRead"
	)
		fail(`${operation.identity} consistency is invalid`);
	const lifecycle = [
		"keyedRowLock",
		"freshPolicyRead",
		"selection",
		"outputFieldAuthority",
	] as const;
	if (!same(plan.lifecycle, lifecycle))
		fail(`${operation.identity} lifecycle is invalid`);
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
	const read = record(plan.read, `${operation.identity} read`);
	exact(
		read,
		["freshAfterRowLockWait", "sql", "parameters", "result"],
		`${operation.identity} read`,
	);
	if (read.freshAfterRowLockWait !== true)
		fail(`${operation.identity} read is not fresh`);
	const readSql = statement(read.sql, `${operation.identity} read SQL`);
	if (/\bFOR\s+UPDATE\b/i.test(readSql) || readSql === lockSql)
		fail(`${operation.identity} lock and fresh Policy read were collapsed`);
	const readParameters = decodePostgresCollectionParameters(
		read.parameters,
		readSql,
		`${operation.identity} read`,
	);
	const result = results(
		read.result,
		readSql,
		operation,
		`${operation.identity} read`,
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
		limits.rows !== 1 ||
		limits.durationMilliseconds !== operation.limits.durationMilliseconds ||
		limits.durationMilliseconds !== 5_000
	)
		fail(`${operation.identity} limits are invalid`);
	return Object.freeze({
		identity: operation.identity,
		target: operation.target,
		member: "get",
		policy: operation.policy,
		outputCardinality: "optionalOne",
		consistency: Object.freeze({
			standalone: "readSnapshot",
			nestedMutation: "keyedLockThenFreshPolicyRead",
		}),
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
		read: Object.freeze({
			freshAfterRowLockWait: true,
			sql: readSql,
			parameters: readParameters,
			result,
			statement: bindPostgresCollectionStatement({
				identity: operation.identity,
				leaf: "read",
				text: readSql,
				parameterCount: readParameters.length,
				result,
			}),
		}),
		outputAuthority: output,
		limits: Object.freeze({ rows: 1, durationMilliseconds: 5_000 }),
		operation,
	});
}

export function linkPostgresCollectionOperationPlans(
	input: Readonly<{
		artifact: unknown;
		operations: LinkedCollectionMutationProgramsV1;
		expectedDigest: string;
	}>,
): LinkedPostgresCollectionOperationPlansV1 {
	const artifact = record(input.artifact, "artifact");
	exact(artifact, ["format", "version", "plans", "digest"], "artifact");
	if (
		artifact.format !== "questpie.postgres-collection-operation-plans" ||
		artifact.version !== 1
	)
		fail("artifact header is invalid");
	const artifactDigest = text(artifact.digest, "artifact digest");
	const unsigned = Object.freeze({
		format: artifact.format,
		version: artifact.version,
		plans: artifact.plans,
	});
	if (
		artifactDigest !== input.expectedDigest ||
		runtimeArtifactDigest(
			"questpie-postgres-collection-operation-plans-v1",
			unsigned,
		) !== artifactDigest
	)
		fail("artifact digest is invalid");
	const rawPlans = array(artifact.plans, "artifact plans");
	const identities = rawPlans.map((raw, index) =>
		text(record(raw, `plan ${index}`).identity, `plan ${index} identity`),
	);
	if (
		new Set(identities).size !== identities.length ||
		identities.some(
			(identity, index) => identity !== [...identities].sort()[index],
		)
	)
		fail("plan identities must be unique and sorted");
	const linked = rawPlans.map((raw, index) => {
		const plan = record(raw, `plan ${index}`);
		const identity = identities[index]!;
		const operation = input.operations.byIdentity.get(identity);
		if (
			!operation ||
			!new Set(["create", "get", "update"]).has(operation.member)
		)
			fail(`plan ${identity} has no executable Collection Operation`);
		if (operation.member === "create") return createPlan(plan, operation);
		if (operation.member === "update") return updatePlan(plan, operation);
		return getPlan(plan, operation);
	});
	const required = input.operations.operations.filter(
		({ member }) =>
			member === "create" || member === "get" || member === "update",
	);
	if (
		required.length !== linked.length ||
		required.some((operation) => !identities.includes(operation.identity))
	)
		fail("artifact is missing an executable Collection Operation plan");
	return Object.freeze({
		plans: Object.freeze(linked),
		byIdentity: new Map(linked.map((plan) => [plan.identity, plan])),
	});
}
