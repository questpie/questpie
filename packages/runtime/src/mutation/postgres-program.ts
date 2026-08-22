import { runtimeArtifactDigest } from "../application/artifact-protocol";
import { decodeRelationalScalarCodec } from "../relational/scalar";
import { canonicalMutationBytes } from "./canonical";
import {
	bindPostgresCollectionStatement,
	decodePostgresCollectionParameters,
} from "./postgres-collection-statement";
import { decodePostgresStatement as statement } from "./postgres-program-codec";
import type {
	FieldPath,
	LinkedPostgresCollectionOperationPlansV1,
	LinkedPostgresCreateOperationPlanV1,
	LinkedPostgresGetOperationPlanV1,
	OutputAuthorityV1,
	PostgresResultV1,
	RecordValue,
} from "./postgres-program-types";
import type {
	LinkedCollectionMutationProgramsV1,
	LinkedCollectionOperationProgramV1,
} from "./program";

export type {
	LinkedPostgresCollectionOperationPlanV1,
	LinkedPostgresCollectionOperationPlansV1,
	LinkedPostgresCreateOperationPlanV1,
	LinkedPostgresGetOperationPlanV1,
} from "./postgres-program-types";

function fail(message: string): never {
	throw new TypeError(
		`Invalid PostgreSQL Collection Operation plan: ${message}`,
	);
}

function record(value: unknown, label: string): RecordValue {
	if (!value || typeof value !== "object" || Array.isArray(value))
		fail(`${label} must be an object`);
	return value as RecordValue;
}

function exact(
	value: RecordValue,
	keys: readonly string[],
	label: string,
): void {
	const actual = Object.keys(value).sort();
	const expected = [...keys].sort();
	if (
		actual.length !== expected.length ||
		expected.some((key, index) => key !== actual[index])
	)
		fail(
			`${label} has invalid keys (actual ${actual.join(",")}; expected ${expected.join(",")})`,
		);
}

function array(value: unknown, label: string): readonly unknown[] {
	if (!Array.isArray(value)) fail(`${label} must be an array`);
	return value;
}

function text(value: unknown, label: string): string {
	if (typeof value !== "string" || value.length === 0 || value.includes("\0"))
		fail(`${label} is invalid`);
	return value;
}

function path(value: unknown, label: string): FieldPath {
	const result = array(value, label);
	if (
		result.length === 0 ||
		result.some((part) => typeof part !== "string" || part.length === 0)
	)
		fail(`${label} is invalid`);
	return Object.freeze(result as string[]);
}

function same(left: unknown, right: unknown): boolean {
	return (
		Buffer.compare(
			canonicalMutationBytes(left),
			canonicalMutationBytes(right),
		) === 0
	);
}

function evidence(value: unknown, label: string): readonly string[] {
	const result = array(value, label).map((item, index) => {
		const identity = text(item, `${label} ${index}`);
		if (
			!identity.startsWith("collection:") ||
			identity.length === "collection:".length
		)
			fail(`${label} ${index} is invalid`);
		return identity;
	});
	if (new Set(result).size !== result.length) fail(`${label} must be unique`);
	return Object.freeze(result);
}

function results(
	value: unknown,
	statement: string,
	operation: LinkedCollectionOperationProgramV1,
	label: string,
): readonly PostgresResultV1[] {
	const decoded = array(value, `${label} result`).map((raw, index) => {
		const source = record(raw, `${label} result ${index}`);
		const hasGuard = Object.hasOwn(source, "guardColumn");
		exact(
			source,
			hasGuard
				? ["path", "column", "codec", "nullable", "guardColumn"]
				: ["path", "column", "codec", "nullable"],
			`${label} result ${index}`,
		);
		if (typeof source.nullable !== "boolean")
			fail(`${label} result ${index} nullable is invalid`);
		const column = text(source.column, `${label} result ${index} column`);
		if (
			!/^qp_result_\d+$/.test(column) ||
			!statement.includes(`AS "${column}"`)
		)
			fail(`${label} result ${index} column is not projected by SQL`);
		const guardColumn = hasGuard
			? text(source.guardColumn, `${label} result ${index} guardColumn`)
			: undefined;
		if (
			guardColumn !== undefined &&
			(guardColumn !== `${column}_allowed` ||
				!statement.includes(`AS "${guardColumn}"`))
		)
			fail(`${label} result ${index} guard is not projected by SQL`);
		return Object.freeze({
			path: path(source.path, `${label} result ${index} path`),
			column,
			codec: decodeRelationalScalarCodec(
				source.codec,
				`${label} result ${index} codec`,
			),
			nullable: source.nullable,
			...(guardColumn === undefined ? {} : { guardColumn }),
		});
	});
	if (
		decoded.length !== operation.selectedFieldPaths.length ||
		decoded.some(
			(item, index) => !same(item.path, operation.selectedFieldPaths[index]),
		) ||
		new Set(decoded.map(({ column }) => column)).size !== decoded.length
	)
		fail(`${label} result does not match the Collection Operation selection`);
	return Object.freeze(decoded);
}

function outputAuthority(
	value: unknown,
	result: readonly PostgresResultV1[],
	label: string,
): OutputAuthorityV1 {
	const source = record(value, label);
	exact(source, ["freshAfterRowLockWait", "selectedPaths"], label);
	if (source.freshAfterRowLockWait !== true) fail(`${label} is not fresh`);
	const selectedPaths = array(
		source.selectedPaths,
		`${label} selectedPaths`,
	).map((raw, index) => {
		const item = record(raw, `${label} selectedPath ${index}`);
		const conditional = item.conditional;
		exact(
			item,
			conditional === true
				? ["path", "conditional", "guardColumn", "mutableEvidenceCollections"]
				: ["path", "conditional", "mutableEvidenceCollections"],
			`${label} selectedPath ${index}`,
		);
		if (typeof conditional !== "boolean")
			fail(`${label} selectedPath ${index} conditional is invalid`);
		const guardColumn = conditional
			? text(item.guardColumn, `${label} selectedPath ${index} guardColumn`)
			: undefined;
		return Object.freeze({
			path: path(item.path, `${label} selectedPath ${index} path`),
			conditional,
			...(guardColumn === undefined ? {} : { guardColumn }),
			mutableEvidenceCollections: evidence(
				item.mutableEvidenceCollections,
				`${label} selectedPath ${index} evidence`,
			),
		});
	});
	if (
		selectedPaths.length !== result.length ||
		selectedPaths.some(
			(item, index) =>
				!same(item.path, result[index]?.path) ||
				item.guardColumn !== result[index]?.guardColumn,
		)
	)
		fail(`${label} does not match result guards`);
	return Object.freeze({
		freshAfterRowLockWait: true,
		selectedPaths: Object.freeze(selectedPaths),
	});
}

function header(
	plan: RecordValue,
	operation: LinkedCollectionOperationProgramV1,
	member: "create" | "get",
): void {
	if (
		plan.identity !== operation.identity ||
		plan.target !== operation.target ||
		plan.member !== member ||
		plan.policy !== operation.policy ||
		plan.outputCardinality !== operation.outputCardinality
	)
		fail(`${operation.identity} does not match its Collection Operation`);
}

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
						: ["phase", "target", "mode", "source"];
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
	if (
		new Set(fields.map(({ path }) => JSON.stringify(path))).size !==
		fields.length
	)
		fail(`${operation.identity} candidate fields must be unique`);
	for (const callerPath of operation.callerInputFields)
		if (
			!steps.some(
				(step) => step.phase === "callerInput" && same(step.target, callerPath),
			)
		)
			fail(`${operation.identity} candidate omits caller input`);
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
			(operation.member !== "create" && operation.member !== "get")
		)
			fail(`plan ${identity} has no executable Collection Operation`);
		return operation.member === "create"
			? createPlan(plan, operation)
			: getPlan(plan, operation);
	});
	const required = input.operations.operations.filter(
		({ member }) => member === "create" || member === "get",
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
