import { canonicalBytes } from "../canonical";
import {
	lowerPostgresMutationPolicyCheck,
	lowerPostgresMutationPolicyChecks,
	type PolicyProgramV1,
	type PostgresMutationCollectionV1,
	type PostgresMutationFieldV1,
} from "../relational";
import type { CollectionOperationProgramV1 } from "./operation-set-contract";
import type { PostgresCreateOperationPlanV1 } from "./postgres-contract";
import {
	callerInputParameters,
	executionParameter,
	fieldByPath,
	inputParameter,
	items,
	path,
	policyParameters,
	postgresType,
	quote,
	record,
	result,
	trustedValueParameters,
	Parameters,
	type RecordValue,
} from "./postgres-shared";

type OutputAuthorityEntry = Readonly<{
	path: readonly string[];
	conditional: boolean;
	guardColumn?: string;
	mutableEvidenceCollections: readonly `collection:${string}`[];
}>;

function defaultExpression(
	parameters: Parameters,
	field: PostgresMutationFieldV1,
): string | null {
	const value = field.defaultValue;
	if (!value)
		return field.nullable ? `NULL::${postgresType(field.codec)}` : null;
	if (value.kind === "randomUuid") return "pg_catalog.gen_random_uuid()";
	if (value.kind === "now") return "pg_catalog.now()";
	if (!("value" in value)) throw new TypeError("unsupported schema default");
	return parameters.add({
		kind: "literal",
		value: value.value,
		codec: field.codec.kind,
		postgresType: postgresType(field.codec),
	});
}

export function lowerPostgresCreateOperationPlan(input: {
	readonly operation: CollectionOperationProgramV1;
	readonly collection: PostgresMutationCollectionV1;
	readonly policy: PolicyProgramV1;
	readonly schema: unknown;
	readonly normalizer: RecordValue | null;
	readonly serverValues: RecordValue | null;
}): PostgresCreateOperationPlanV1 {
	const { operation, collection, policy, schema, normalizer, serverValues } =
		input;
	if (operation.outputCardinality !== "one")
		throw new TypeError(`${operation.identity} create cardinality must be one`);
	const create = policy.operations.create;
	if (!create || create.candidate.kind === "sameRelationalScopeAsRead")
		throw new TypeError(
			`${policy.identity} has no explicit create candidate Policy`,
		);
	const selectedRules = policy.fields?.selectedOutput ?? [];
	const outputRules = operation.selectedFieldPaths.map((selectedPath) =>
		selectedRules.find(
			(rule) => canonicalBytes(rule.path) === canonicalBytes(selectedPath),
		),
	);
	const checks = lowerPostgresMutationPolicyChecks({
		schema,
		checks: [
			{ expression: create.candidate, aliases: { candidate: "qp_candidate" } },
			...outputRules.flatMap((rule) =>
				rule ? [{ expression: rule.when, aliases: { row: "qp_row" } }] : [],
			),
		],
	});
	const candidateCheck = checks.checks[0]!;
	const guardChecks = checks.checks.slice(1);
	const parameters = policyParameters(checks.parameters);
	const steps: Record<string, unknown>[] = [];
	const expressions = new Map<string, string>();
	const optionalCaller = new Map<
		string,
		Readonly<{ present: string; fallback: string }>
	>();
	const requiredCaller = new Set(
		operation.requiredCallerInputFields.map((fieldPath) =>
			canonicalBytes(fieldPath),
		),
	);
	for (const callerPath of operation.callerInputFields) {
		const field = fieldByPath(collection, callerPath);
		const key = canonicalBytes(field.path);
		if (requiredCaller.has(key))
			expressions.set(key, inputParameter(parameters, "callerInput", field));
		else {
			const bound = callerInputParameters(parameters, field);
			const fallback = defaultExpression(parameters, field);
			if (fallback === null)
				throw new TypeError(
					`${operation.identity} optional caller Field ${field.path.join(".")} has no fallback`,
				);
			expressions.set(key, bound.value);
			optionalCaller.set(key, { present: bound.present, fallback });
		}
		steps.push({ phase: "callerInput", target: field.path });
	}
	for (const rawStep of normalizer
		? items(normalizer.steps, "normalizer steps")
		: []) {
		const step = record(rawStep, "normalizer step");
		const target = path(step.target, "normalizer target");
		const expression = record(step.expression, "normalizer expression");
		const source = path(expression.source, "normalizer source");
		const sourceSql = expressions.get(canonicalBytes(source));
		if (!sourceSql)
			throw new TypeError("normalizer source is not caller input");
		if (expression.kind !== "trim" && expression.kind !== "trimIfPresent")
			throw new TypeError(`unsupported normalizer ${String(expression.kind)}`);
		expressions.set(canonicalBytes(target), `btrim(${sourceSql})`);
		steps.push({ phase: "normalizer", target, transform: expression.kind });
	}
	for (const [key, optional] of optionalCaller) {
		const supplied = expressions.get(key);
		if (!supplied)
			throw new TypeError(
				"optional caller Field lost its candidate expression",
			);
		expressions.set(
			key,
			`CASE WHEN ${optional.present} THEN ${supplied} ELSE ${optional.fallback} END`,
		);
	}
	for (const field of collection.fields) {
		if (expressions.has(canonicalBytes(field.path))) continue;
		const expression = defaultExpression(parameters, field);
		if (expression === null) continue;
		expressions.set(canonicalBytes(field.path), expression);
		if (field.defaultValue)
			steps.push({
				phase: "schemaDefault",
				target: field.path,
				value:
					field.defaultValue.kind === "literal"
						? field.defaultValue.value
						: field.defaultValue.kind,
			});
	}
	for (const rawAssignment of serverValues
		? items(serverValues.assignments, "server value assignments")
		: []) {
		const assignment = record(rawAssignment, "server value assignment");
		const target = path(assignment.target, "server value target");
		const source = path(assignment.source, "server value source");
		const field = fieldByPath(collection, target);
		if (assignment.mode !== "overwrite")
			throw new TypeError(
				`unsupported server value mode ${String(assignment.mode)}`,
			);
		const [sourceRoot, ...sourcePath] = source;
		if (
			!sourceRoot ||
			(sourceRoot !== "operationTime" && sourcePath.length === 0) ||
			(sourceRoot === "operationTime" && sourcePath.length !== 0)
		)
			throw new TypeError(
				"server value source must be a closed execution operand",
			);
		expressions.set(
			canonicalBytes(target),
			executionParameter(parameters, sourceRoot, sourcePath, field),
		);
		steps.push({
			phase: "serverValue",
			target,
			mode: "overwrite",
			source,
		});
	}
	for (const trustedPath of operation.trustedValueFields) {
		const field = fieldByPath(collection, trustedPath);
		const bound = trustedValueParameters(parameters, field);
		const fallback =
			expressions.get(canonicalBytes(field.path)) ??
			`NULL::${postgresType(field.codec)}`;
		expressions.set(
			canonicalBytes(field.path),
			`CASE WHEN ${bound.present} THEN ${bound.value} ELSE ${fallback} END`,
		);
		steps.push({ phase: "trustedValue", target: field.path });
	}
	for (const field of collection.fields)
		if (!expressions.has(canonicalBytes(field.path)))
			throw new TypeError(
				`${operation.identity} cannot construct required candidate Field ${field.path.join(".")}`,
			);
	const candidateColumns = collection.fields.map(
		(field) =>
			`${expressions.get(canonicalBytes(field.path))!} AS ${quote(field.column)}`,
	);
	const candidateCte = `${quote("qp_candidate")} AS (SELECT ${candidateColumns.join(", ")})`;
	const rules = policy.fields?.callerInput.create ?? [];
	const authorityChecks = operation.callerInputFields.map((callerPath) => {
		const rule = rules.find(
			(candidate) =>
				canonicalBytes(candidate.path) === canonicalBytes(callerPath),
		);
		if (!rule)
			throw new TypeError(
				`${policy.identity} has no create Field authority for ${callerPath.join(".")}`,
			);
		const authority = lowerPostgresMutationPolicyCheck({
			schema,
			expression: rule.when,
			aliases: { candidate: "qp_candidate" },
		});
		const authorityParameters = policyParameters(authority.parameters);
		if (rule.when.kind === "constant")
			return Object.freeze({
				path: callerPath,
				sql: `SELECT TRUE WHERE ${authority.sql}`,
				parameters: authorityParameters.values(),
			});
		const rawCandidate = collection.fields.map((field) => {
			const supplied = operation.callerInputFields.some(
				(inputPath) => canonicalBytes(inputPath) === canonicalBytes(field.path),
			);
			const value = supplied
				? inputParameter(authorityParameters, "callerInput", field)
				: `NULL::${postgresType(field.codec)}`;
			return `${value} AS ${quote(field.column)}`;
		});
		const authorityCandidateCte = `${quote("qp_candidate")} AS (SELECT ${rawCandidate.join(", ")})`;
		return Object.freeze({
			path: callerPath,
			sql: `WITH ${authorityCandidateCte} SELECT TRUE FROM ${quote("qp_candidate")} WHERE ${authority.sql}`,
			parameters: authorityParameters.values(),
		});
	});
	const baseOutput = result(collection, operation.selectedFieldPaths);
	const insertColumns = collection.fields.map((field) => quote(field.column));
	const selection = collection.fields.map(
		(field) => `${quote("qp_candidate")}.${quote(field.column)}`,
	);
	let guardIndex = 0;
	const joins: string[] = [];
	const outputAuthority: OutputAuthorityEntry[] = [];
	const output = baseOutput.map((item, index) => {
		const rule = outputRules[index];
		if (!rule) {
			outputAuthority.push({
				path: item.path,
				conditional: false,
				mutableEvidenceCollections: [],
			});
			return item;
		}
		const guard = guardChecks[guardIndex++]!;
		const guardAlias = `qp_guard_${index}`;
		const guardColumn = `${item.column}_allowed`;
		joins.push(
			`CROSS JOIN LATERAL (SELECT ${guard.sql} AS ${quote("allowed")}) AS ${quote(guardAlias)}`,
		);
		outputAuthority.push({
			path: item.path,
			conditional: true,
			guardColumn,
			mutableEvidenceCollections: guard.mutableEvidenceCollections,
		});
		return Object.freeze({ ...item, guardColumn });
	});
	const selected = output.flatMap((item, index) => {
		const field = fieldByPath(collection, item.path);
		const value =
			field.codec.kind === "timestamp"
				? `pg_catalog.date_trunc('milliseconds', ${quote("qp_row")}.${quote(field.column)})`
				: `${quote("qp_row")}.${quote(field.column)}`;
		if (!item.guardColumn) return [`${value} AS ${quote(item.column)}`];
		const guardAlias = `qp_guard_${index}`;
		return [
			`CASE WHEN ${quote(guardAlias)}.${quote("allowed")} THEN ${value} ELSE NULL END AS ${quote(item.column)}`,
			`${quote(guardAlias)}.${quote("allowed")} AS ${quote(item.guardColumn)}`,
		];
	});
	return Object.freeze({
		identity: operation.identity,
		target: operation.target,
		member: "create",
		policy: operation.policy,
		outputCardinality: "one",
		lifecycle: Object.freeze([
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
		] as const),
		normalizerProgram: normalizer,
		serverValueProgram: serverValues,
		candidate: Object.freeze({
			steps: Object.freeze(steps),
			fields: Object.freeze(
				collection.fields.map((field) =>
					Object.freeze({
						path: field.path,
						codec: field.codec,
						nullable: field.nullable,
					}),
				),
			),
		}),
		fieldAuthority: Object.freeze({
			suppliedPathsOnly: true,
			checks: Object.freeze(authorityChecks),
		}),
		candidatePolicy: Object.freeze({
			freshAfterRowLockWait: true,
			mutableEvidenceCollections: candidateCheck.mutableEvidenceCollections,
			sql: candidateCheck.sql,
		}),
		outputAuthority: Object.freeze({
			freshAfterRowLockWait: true as const,
			selectedPaths: Object.freeze(outputAuthority),
		}),
		write: Object.freeze({
			sql: `WITH ${candidateCte}, ${quote("qp_inserted")} AS (INSERT INTO ${collection.table} (${insertColumns.join(", ")}) SELECT ${selection.join(", ")} FROM ${quote("qp_candidate")} WHERE ${candidateCheck.sql} RETURNING *) SELECT ${selected.join(", ")} FROM ${quote("qp_inserted")} AS ${quote("qp_row")}${joins.length > 0 ? ` ${joins.join(" ")}` : ""}`,
			parameters: parameters.values(),
			result: output,
		}),
		limits: Object.freeze({
			rows:
				"rowsWritten" in operation.limits ? operation.limits.rowsWritten : 0,
			durationMilliseconds: operation.limits.durationMilliseconds,
		}),
	});
}
