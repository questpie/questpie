import { canonicalBytes, compareAscii } from "../canonical";
import {
	lowerPostgresMutationPolicyCheck,
	postgresMutationCollection,
	type PolicyProgramV1,
	type PostgresMutationCollectionV1,
	type PostgresMutationFieldV1,
} from "../relational";
import type { CollectionOperationProgramV1 } from "./operation-set-contract";
import type {
	PostgresCollectionOperationPlansV1,
	PostgresCreateOperationPlanV1,
	PostgresGetOperationPlanV1,
} from "./postgres-contract";
import {
	executionParameter,
	fieldByPath,
	inputParameter,
	items,
	linkedProgram,
	path,
	policyFor,
	policyParameters,
	postgresType,
	projection,
	quote,
	record,
	result,
	type Parameters,
	type RecordValue,
} from "./postgres-shared";

function getPlan(
	operation: CollectionOperationProgramV1,
	collection: PostgresMutationCollectionV1,
	policy: PolicyProgramV1,
	schema: unknown,
): PostgresGetOperationPlanV1 {
	if (operation.outputCardinality !== "optionalOne")
		throw new TypeError(
			`${operation.identity} get cardinality must be optionalOne`,
		);
	const read = policy.operations.read;
	if (!read) throw new TypeError(`${policy.identity} denies read`);
	const check = lowerPostgresMutationPolicyCheck({
		schema,
		expression: read.rows,
		aliases: { row: "qp_row" },
	});
	const parameters = policyParameters(check.parameters);
	const predicates = operation.keyFields.map((keyPath) => {
		const field = fieldByPath(collection, keyPath);
		return `${quote("qp_row")}.${quote(field.column)} IS NOT DISTINCT FROM ${inputParameter(parameters, "key", field)}`;
	});
	const output = result(collection, operation.selectedFieldPaths);
	const selectedRules = policy.fields?.selectedOutput ?? [];
	for (const selectedPath of operation.selectedFieldPaths)
		if (
			selectedRules.some(
				(rule) => canonicalBytes(rule.path) === canonicalBytes(selectedPath),
			)
		)
			throw new TypeError(
				`${operation.identity} conditional output authority requires a later static lowering`,
			);
	const selected = output.map((item) => {
		const field = fieldByPath(collection, item.path);
		const value =
			field.codec.kind === "timestamp"
				? `pg_catalog.date_trunc('milliseconds', ${quote("qp_row")}.${quote(field.column)})`
				: `${quote("qp_row")}.${quote(field.column)}`;
		return `${value} AS ${quote(item.column)}`;
	});
	return Object.freeze({
		identity: operation.identity,
		target: operation.target,
		member: "get",
		policy: operation.policy,
		outputCardinality: "optionalOne",
		read: Object.freeze({
			sql: `SELECT ${selected.join(", ")} FROM ${collection.table} AS ${quote("qp_row")} WHERE ${[...predicates, check.sql].join(" AND ")} LIMIT 1`,
			parameters: parameters.values(),
			result: output,
		}),
		outputAuthority: Object.freeze({
			selectedPaths: Object.freeze(
				operation.selectedFieldPaths.map((selectedPath) =>
					Object.freeze({ path: selectedPath, conditional: false as const }),
				),
			),
		}),
		limits: Object.freeze({
			rows: 1,
			durationMilliseconds: operation.limits.durationMilliseconds,
		}),
	});
}

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

function createPlan(
	operation: CollectionOperationProgramV1,
	collection: PostgresMutationCollectionV1,
	policy: PolicyProgramV1,
	schema: unknown,
	normalizer: RecordValue | null,
	serverValues: RecordValue | null,
): PostgresCreateOperationPlanV1 {
	if (operation.outputCardinality !== "one")
		throw new TypeError(`${operation.identity} create cardinality must be one`);
	const create = policy.operations.create;
	if (!create || create.candidate.kind === "sameRelationalScopeAsRead")
		throw new TypeError(
			`${policy.identity} has no explicit create candidate Policy`,
		);
	const check = lowerPostgresMutationPolicyCheck({
		schema,
		expression: create.candidate,
		aliases: { candidate: "qp_candidate" },
	});
	const parameters = policyParameters(check.parameters);
	const steps: Record<string, unknown>[] = [];
	const expressions = new Map<string, string>();
	for (const callerPath of operation.callerInputFields) {
		const field = fieldByPath(collection, callerPath);
		expressions.set(
			canonicalBytes(field.path),
			inputParameter(parameters, "callerInput", field),
		);
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
			sql:
				rule.when.kind === "constant"
					? `SELECT TRUE WHERE ${authority.sql}`
					: `WITH ${authorityCandidateCte} SELECT TRUE FROM ${quote("qp_candidate")} WHERE ${authority.sql}`,
			parameters: authorityParameters.values(),
		});
	});
	const output = result(collection, operation.selectedFieldPaths);
	const insertColumns = collection.fields.map((field) => quote(field.column));
	const selection = collection.fields.map(
		(field) => `${quote("qp_candidate")}.${quote(field.column)}`,
	);
	const returning = output.map((item) => {
		const field = fieldByPath(collection, item.path);
		return `${quote(field.column)} AS ${quote(item.column)}`;
	});
	const selectedRules = policy.fields?.selectedOutput ?? [];
	for (const selectedPath of operation.selectedFieldPaths)
		if (
			selectedRules.some(
				(rule) => canonicalBytes(rule.path) === canonicalBytes(selectedPath),
			)
		)
			throw new TypeError(
				`${operation.identity} conditional output authority requires a later static lowering`,
			);
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
			mutableEvidenceCollections: check.mutableEvidenceCollections,
			sql: check.sql,
		}),
		outputAuthority: Object.freeze({
			selectedPaths: Object.freeze(
				operation.selectedFieldPaths.map((selectedPath) =>
					Object.freeze({
						path: selectedPath,
						conditional: false,
					}),
				),
			),
		}),
		write: Object.freeze({
			sql: `WITH ${candidateCte} INSERT INTO ${collection.table} (${insertColumns.join(", ")}) SELECT ${selection.join(", ")} FROM ${quote("qp_candidate")} WHERE ${check.sql} RETURNING ${returning.join(", ")}`,
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

export function lowerPostgresCollectionOperationPlans(
	input: Readonly<{
		collectionOperations: unknown;
		schemaProjection: unknown;
		policyProjection: unknown;
		normalizerPrograms: unknown;
		serverValuePrograms: unknown;
	}>,
): PostgresCollectionOperationPlansV1 {
	const operations = projection(
		input.collectionOperations,
		"questpie.collection-operation-programs",
		"operations",
	) as readonly CollectionOperationProgramV1[];
	const plans = operations
		.filter(
			(operation) =>
				operation.member === "get" || operation.member === "create",
		)
		.map((operation) => {
			const collection = postgresMutationCollection(
				input.schemaProjection,
				operation.target,
			);
			const policy = policyFor(input.policyProjection, operation.policy);
			if (policy.target !== operation.target)
				throw new TypeError(
					`${operation.policy} does not target ${operation.target}`,
				);
			if (operation.member === "get")
				return getPlan(operation, collection, policy, input.schemaProjection);
			return createPlan(
				operation,
				collection,
				policy,
				input.schemaProjection,
				linkedProgram(
					input.normalizerPrograms,
					"questpie.field-normalizer-programs",
					"programs",
					"normalizer program",
					operation,
					operation.normalizerProgramDigest,
				),
				linkedProgram(
					input.serverValuePrograms,
					"questpie.server-value-programs",
					"programs",
					"server value program",
					operation,
					operation.serverValueProgramDigest,
				),
			);
		})
		.sort((left, right) => compareAscii(left.identity, right.identity));
	return Object.freeze({
		format: "questpie.postgres-collection-operation-plans",
		version: 1,
		plans: Object.freeze(plans),
	});
}
