import { canonicalBytes, compareAscii, digest } from "../canonical";
import {
	lowerPostgresMutationPolicyChecks,
	postgresMutationCollection,
	type PolicyProgramV1,
	type PolicyExpressionV1,
	type PostgresMutationCollectionV1,
} from "../relational";
import type { CollectionOperationProgramV1 } from "./operation-set-contract";
import type {
	PostgresCollectionOperationPlansV1,
	PostgresDeleteOperationPlanV1,
	PostgresGetOperationPlanV1,
	PostgresUpdateOperationPlanV1,
} from "./postgres-contract";
import { lowerPostgresCreateOperationPlan } from "./postgres-create";
import {
	candidateValueParameter,
	executionParameter,
	expectedParameters,
	fieldByPath,
	inputParameter,
	items,
	linkedProgram,
	path,
	patchParameters,
	policyFor,
	policyParameters,
	projection,
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

function updateCandidate(
	operation: CollectionOperationProgramV1,
	collection: PostgresMutationCollectionV1,
	normalizer: RecordValue | null,
	serverValues: RecordValue | null,
	parameters: Parameters,
) {
	const expressions = new Map<string, string>(
		collection.fields.map(
			(field) =>
				[
					canonicalBytes(field.path),
					`${quote("qp_current")}.${quote(field.column)}`,
				] as const,
		),
	);
	const patch = new Map<
		string,
		Readonly<{ present: string; value: string; current: string }>
	>();
	const steps: Record<string, unknown>[] = [];
	for (const callerPath of operation.callerInputFields) {
		const field = fieldByPath(collection, callerPath);
		const bound = patchParameters(parameters, field);
		const current = `${quote("qp_current")}.${quote(field.column)}`;
		patch.set(canonicalBytes(field.path), { ...bound, current });
		expressions.set(
			canonicalBytes(field.path),
			`CASE WHEN ${bound.present} THEN ${bound.value} ELSE ${current} END`,
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
		const sourcePatch = patch.get(canonicalBytes(source));
		if (!sourcePatch)
			throw new TypeError("normalizer source is not update caller input");
		if (expression.kind !== "trim" && expression.kind !== "trimIfPresent")
			throw new TypeError(`unsupported normalizer ${String(expression.kind)}`);
		expressions.set(
			canonicalBytes(target),
			`CASE WHEN ${sourcePatch.present} THEN btrim(${sourcePatch.value}) ELSE ${sourcePatch.current} END`,
		);
		steps.push({ phase: "normalizer", target, transform: expression.kind });
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
		steps.push({ phase: "serverValue", target, mode: "overwrite", source });
	}
	for (const trustedPath of operation.trustedValueFields) {
		const field = fieldByPath(collection, trustedPath);
		const bound = trustedValueParameters(parameters, field);
		const current = expressions.get(canonicalBytes(field.path));
		if (!current)
			throw new TypeError(
				`${operation.identity} cannot construct current candidate Field ${field.path.join(".")}`,
			);
		expressions.set(
			canonicalBytes(field.path),
			`CASE WHEN ${bound.present} THEN ${bound.value} ELSE ${current} END`,
		);
		steps.push({ phase: "trustedValue", target: field.path });
	}
	return Object.freeze({
		columns: Object.freeze(
			collection.fields.map(
				(field) =>
					`${expressions.get(canonicalBytes(field.path))!} AS ${quote(field.column)}`,
			),
		),
		steps: Object.freeze(steps),
	});
}

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
	const selectedRules = policy.fields?.selectedOutput ?? [];
	const outputRules = operation.selectedFieldPaths.map((selectedPath) =>
		selectedRules.find(
			(rule) => canonicalBytes(rule.path) === canonicalBytes(selectedPath),
		),
	);
	const checks = lowerPostgresMutationPolicyChecks({
		schema,
		checks: [
			{ expression: read.rows, aliases: { row: "qp_row" } },
			...outputRules.flatMap((rule) =>
				rule ? [{ expression: rule.when, aliases: { row: "qp_row" } }] : [],
			),
		],
	});
	const readCheck = checks.checks[0]!;
	const guardChecks = checks.checks.slice(1);
	const parameters = policyParameters(checks.parameters);
	const lockParameters = new Parameters();
	const lockPredicates = operation.keyFields.map((keyPath) => {
		const field = fieldByPath(collection, keyPath);
		return `${quote("qp_lock_row")}.${quote(field.column)} IS NOT DISTINCT FROM ${inputParameter(lockParameters, "key", field)}`;
	});
	const predicates = operation.keyFields.map((keyPath) => {
		const field = fieldByPath(collection, keyPath);
		return `${quote("qp_row")}.${quote(field.column)} IS NOT DISTINCT FROM ${inputParameter(parameters, "key", field)}`;
	});
	const baseOutput = result(collection, operation.selectedFieldPaths);
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
		member: "get",
		policy: operation.policy,
		outputCardinality: "optionalOne",
		consistency: Object.freeze({
			standalone: "readSnapshot" as const,
			nestedMutation: "keyedLockThenFreshPolicyRead" as const,
		}),
		lifecycle: Object.freeze([
			"keyedRowLock",
			"freshPolicyRead",
			"selection",
			"outputFieldAuthority",
		] as const),
		lock: Object.freeze({
			sql: `SELECT TRUE AS ${quote("qp_locked")} FROM ${collection.table} AS ${quote("qp_lock_row")} WHERE ${lockPredicates.join(" AND ")} LIMIT 1 FOR UPDATE`,
			parameters: lockParameters.values(),
			outcome: "internalLockedOrAbsent" as const,
		}),
		read: Object.freeze({
			freshAfterRowLockWait: true as const,
			sql: `SELECT ${selected.join(", ")} FROM ${collection.table} AS ${quote("qp_row")}${joins.length > 0 ? ` ${joins.join(" ")}` : ""} WHERE ${[...predicates, readCheck.sql].join(" AND ")} LIMIT 1`,
			parameters: parameters.values(),
			result: output,
		}),
		outputAuthority: Object.freeze({
			freshAfterRowLockWait: true as const,
			selectedPaths: Object.freeze(outputAuthority),
		}),
		limits: Object.freeze({
			rows: 1,
			durationMilliseconds: operation.limits.durationMilliseconds,
		}),
	});
}

/**
 * Delete has no candidate: it re-uses `get`'s row-scope Policy idiom (a key
 * predicate plus a fresh Policy check, gating existence and authorization in
 * one `LIMIT 1` CTE) and `update`'s two-statement lock-then-write shape (a
 * `FOR UPDATE` lock so a later authored `validate`/`afterWrite` phase can be
 * added without reshaping the plan), but writes with a single `DELETE ...
 * RETURNING` joined against that CTE instead of an `UPDATE`. An empty CTE
 * (row missing, Policy-denied, or a future CAS predicate rejected) yields an
 * empty `DELETE`, so not-found and denied stay indistinguishable exactly as
 * they do for `update` ("authorized-or-absent").
 */
function deletePlan(
	operation: CollectionOperationProgramV1,
	collection: PostgresMutationCollectionV1,
	policy: PolicyProgramV1,
	schema: unknown,
): PostgresDeleteOperationPlanV1 {
	if (operation.outputCardinality !== "optionalOne")
		throw new TypeError(
			`${operation.identity} delete cardinality must be optionalOne`,
		);
	const del = policy.operations.delete;
	if (!del) throw new TypeError(`${policy.identity} has no delete Policy`);
	const selectedRules = policy.fields?.selectedOutput ?? [];
	const outputRules = operation.selectedFieldPaths.map((selectedPath) =>
		selectedRules.find(
			(rule) => canonicalBytes(rule.path) === canonicalBytes(selectedPath),
		),
	);
	const checks = lowerPostgresMutationPolicyChecks({
		schema,
		checks: [
			{ expression: del.current, aliases: { current: "qp_current" } },
			...outputRules.flatMap((rule) =>
				rule ? [{ expression: rule.when, aliases: { row: "qp_row" } }] : [],
			),
		],
	});
	const currentCheck = checks.checks[0]!;
	const guardChecks = checks.checks.slice(1);
	const parameters = policyParameters(checks.parameters);
	const lockParameters = new Parameters();
	const lockPredicates = operation.keyFields.map((keyPath) => {
		const field = fieldByPath(collection, keyPath);
		return `${quote("qp_lock_row")}.${quote(field.column)} IS NOT DISTINCT FROM ${inputParameter(lockParameters, "key", field)}`;
	});
	const keyPredicates = operation.keyFields.map((keyPath) => {
		const field = fieldByPath(collection, keyPath);
		return `${quote("qp_current")}.${quote(field.column)} IS NOT DISTINCT FROM ${inputParameter(parameters, "key", field)}`;
	});
	const targetPredicates = operation.keyFields.map((keyPath) => {
		const field = fieldByPath(collection, keyPath);
		return `${quote("qp_target")}.${quote(field.column)} IS NOT DISTINCT FROM ${inputParameter(parameters, "key", field)}`;
	});
	const baseOutput = result(collection, operation.selectedFieldPaths);
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
	const currentCte = `${quote("qp_current")} AS (SELECT * FROM ${collection.table} AS ${quote("qp_current")} WHERE ${[...keyPredicates, currentCheck.sql].join(" AND ")} LIMIT 1)`;
	const deletedCte = `${quote("qp_deleted")} AS (DELETE FROM ${collection.table} AS ${quote("qp_target")} USING ${quote("qp_current")} WHERE ${targetPredicates.join(" AND ")} RETURNING ${quote("qp_target")}.*)`;
	return Object.freeze({
		identity: operation.identity,
		target: operation.target,
		member: "delete",
		policy: operation.policy,
		outputCardinality: "optionalOne",
		lifecycle: Object.freeze([
			"keyedRowLock",
			"freshCurrentPolicy",
			"postgresConstraints",
			"selection",
			"outputFieldAuthority",
		] as const),
		lock: Object.freeze({
			sql: `SELECT TRUE AS ${quote("qp_locked")} FROM ${collection.table} AS ${quote("qp_lock_row")} WHERE ${lockPredicates.join(" AND ")} LIMIT 1 FOR UPDATE`,
			parameters: lockParameters.values(),
			outcome: "internalLockedOrAbsent" as const,
		}),
		currentPolicy: Object.freeze({
			freshAfterRowLockWait: true,
			mutableEvidenceCollections: currentCheck.mutableEvidenceCollections,
			sql: currentCheck.sql,
		}),
		outputAuthority: Object.freeze({
			freshAfterRowLockWait: true as const,
			selectedPaths: Object.freeze(outputAuthority),
		}),
		write: Object.freeze({
			sql: `WITH ${currentCte}, ${deletedCte} SELECT ${selected.join(", ")} FROM ${quote("qp_deleted")} AS ${quote("qp_row")}${joins.length > 0 ? ` ${joins.join(" ")}` : ""}`,
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

function updatePlan(
	operation: CollectionOperationProgramV1,
	collection: PostgresMutationCollectionV1,
	policy: PolicyProgramV1,
	schema: unknown,
	normalizer: RecordValue | null,
	serverValues: RecordValue | null,
): PostgresUpdateOperationPlanV1 {
	if (operation.outputCardinality !== "optionalOne")
		throw new TypeError(
			`${operation.identity} update cardinality must be optionalOne`,
		);
	const update = policy.operations.update;
	if (!update) throw new TypeError(`${policy.identity} has no update Policy`);
	const candidateExpression: PolicyExpressionV1 =
		update.candidate.kind === "sameRelationalScopeAsRead"
			? (policy.operations.read?.rows ??
				(() => {
					throw new TypeError(
						`${policy.identity} update candidate inherits a missing read Policy`,
					);
				})())
			: update.candidate;
	const candidateAliases: Readonly<Record<string, string>> =
		update.candidate.kind === "sameRelationalScopeAsRead"
			? { row: "qp_candidate" }
			: { current: "qp_current", candidate: "qp_candidate" };
	const selectedRules = policy.fields?.selectedOutput ?? [];
	const outputRules = operation.selectedFieldPaths.map((selectedPath) =>
		selectedRules.find(
			(rule) => canonicalBytes(rule.path) === canonicalBytes(selectedPath),
		),
	);
	const policyChecks = lowerPostgresMutationPolicyChecks({
		schema,
		checks: [
			{ expression: update.current, aliases: { current: "qp_current" } },
			{ expression: candidateExpression, aliases: candidateAliases },
			...outputRules.flatMap((rule) =>
				rule ? [{ expression: rule.when, aliases: { row: "qp_row" } }] : [],
			),
		],
	});
	const currentCheck = policyChecks.checks[0]!;
	const candidateCheck = policyChecks.checks[1]!;
	const candidatePolicyProof = lowerPostgresMutationPolicyChecks({
		schema,
		checks: [
			{ expression: update.current, aliases: { current: "qp_current" } },
			{ expression: candidateExpression, aliases: candidateAliases },
		],
	});
	const guardChecks = policyChecks.checks.slice(2);
	const parameters = policyParameters(policyChecks.parameters);
	const lockParameters = new Parameters();
	const lockPredicates = operation.keyFields.map((keyPath) => {
		const field = fieldByPath(collection, keyPath);
		return `${quote("qp_lock_row")}.${quote(field.column)} IS NOT DISTINCT FROM ${inputParameter(lockParameters, "key", field)}`;
	});
	const keyPredicates = operation.keyFields.map((keyPath) => {
		const field = fieldByPath(collection, keyPath);
		return `${quote("qp_current")}.${quote(field.column)} IS NOT DISTINCT FROM ${inputParameter(parameters, "key", field)}`;
	});
	const targetPredicates = operation.keyFields.map((keyPath) => {
		const field = fieldByPath(collection, keyPath);
		return `${quote("qp_target")}.${quote(field.column)} IS NOT DISTINCT FROM ${inputParameter(parameters, "key", field)}`;
	});
	const expectedPredicates = collection.fields.map((field) => {
		const bound = expectedParameters(parameters, field);
		return `CASE WHEN ${bound.present} THEN ${quote("qp_current")}.${quote(field.column)} IS NOT DISTINCT FROM ${bound.value} ELSE TRUE END`;
	});
	const candidate = updateCandidate(
		operation,
		collection,
		normalizer,
		serverValues,
		parameters,
	);
	const updateRules = policy.fields?.callerInput.update ?? [];
	const authorityChecks = operation.callerInputFields.map((callerPath) => {
		const rule = updateRules.find(
			(candidate) =>
				canonicalBytes(candidate.path) === canonicalBytes(callerPath),
		);
		if (!rule)
			throw new TypeError(
				`${policy.identity} has no update Field authority for ${callerPath.join(".")}`,
			);
		const lowered = lowerPostgresMutationPolicyChecks({
			schema,
			checks: [
				{ expression: update.current, aliases: { current: "qp_current" } },
				{ expression: rule.when, aliases: { current: "qp_current" } },
			],
		});
		const checkParameters = policyParameters(lowered.parameters);
		const predicates = operation.keyFields.map((keyPath) => {
			const field = fieldByPath(collection, keyPath);
			return `${quote("qp_current")}.${quote(field.column)} IS NOT DISTINCT FROM ${inputParameter(checkParameters, "key", field)}`;
		});
		return Object.freeze({
			path: callerPath,
			sql: `SELECT TRUE FROM ${collection.table} AS ${quote("qp_current")} WHERE ${[...predicates, lowered.checks[0]!.sql, lowered.checks[1]!.sql].join(" AND ")} LIMIT 1`,
			parameters: checkParameters.values(),
		});
	});
	const baseOutput = result(collection, operation.selectedFieldPaths);
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
	const assignments = collection.fields.map(
		(field) =>
			`${quote(field.column)} = ${quote("qp_candidate")}.${quote(field.column)}`,
	);
	const currentCte = `${quote("qp_current")} AS (SELECT * FROM ${collection.table} AS ${quote("qp_current")} WHERE ${[...keyPredicates, currentCheck.sql, ...expectedPredicates].join(" AND ")} LIMIT 1)`;
	const candidateCte = `${quote("qp_candidate")} AS (SELECT ${candidate.columns.join(", ")} FROM ${quote("qp_current")})`;
	const updatedCte = `${quote("qp_updated")} AS (UPDATE ${collection.table} AS ${quote("qp_target")} SET ${assignments.join(", ")} FROM ${quote("qp_candidate")}, ${quote("qp_current")} WHERE ${[...targetPredicates, candidateCheck.sql].join(" AND ")} RETURNING ${quote("qp_target")}.*)`;
	const validationPolicy = lowerPostgresMutationPolicyChecks({
		schema,
		checks: [
			{ expression: update.current, aliases: { current: "qp_current" } },
		],
	});
	const validationCheck = validationPolicy.checks[0]!;
	const validationParameters = policyParameters(validationPolicy.parameters);
	const validationKeyPredicates = operation.keyFields.map((keyPath) => {
		const field = fieldByPath(collection, keyPath);
		return `${quote("qp_current")}.${quote(field.column)} IS NOT DISTINCT FROM ${inputParameter(validationParameters, "key", field)}`;
	});
	const validationExpectedPredicates = collection.fields.map((field) => {
		const bound = expectedParameters(validationParameters, field);
		return `CASE WHEN ${bound.present} THEN ${quote("qp_current")}.${quote(field.column)} IS NOT DISTINCT FROM ${bound.value} ELSE TRUE END`;
	});
	const validationCandidate = updateCandidate(
		operation,
		collection,
		normalizer,
		serverValues,
		validationParameters,
	);
	const validationResult = result(
		collection,
		collection.fields.map(({ path: fieldPath }) => fieldPath),
	);
	const validationSelected = validationResult.map((item) => {
		const field = fieldByPath(collection, item.path);
		const value =
			field.codec.kind === "timestamp"
				? `pg_catalog.date_trunc('milliseconds', ${quote("qp_candidate")}.${quote(field.column)})`
				: `${quote("qp_candidate")}.${quote(field.column)}`;
		return `${value} AS ${quote(item.column)}`;
	});
	const validationCurrentResult = operation.lifecycleProgramDigest
		? result(
				collection,
				collection.fields.map(({ path: fieldPath }) => fieldPath),
			).map((item, index) =>
				Object.freeze({ ...item, column: `qp_current_${index}` }),
			)
		: undefined;
	const validationCurrentSelected = validationCurrentResult?.map((item) => {
		const field = fieldByPath(collection, item.path);
		const value =
			field.codec.kind === "timestamp"
				? `pg_catalog.date_trunc('milliseconds', ${quote("qp_current")}.${quote(field.column)})`
				: `${quote("qp_current")}.${quote(field.column)}`;
		return `${value} AS ${quote(item.column)}`;
	});
	const validationCurrentCte = `${quote("qp_current")} AS (SELECT * FROM ${collection.table} AS ${quote("qp_current")} WHERE ${[...validationKeyPredicates, validationCheck.sql, ...validationExpectedPredicates].join(" AND ")} LIMIT 1)`;
	const validationCandidateCte = `${quote("qp_candidate")} AS (SELECT ${validationCandidate.columns.join(", ")} FROM ${quote("qp_current")})`;
	const candidatePolicyCheck = operation.lifecycleProgramDigest
		? (() => {
				const proofParameters = policyParameters(
					candidatePolicyProof.parameters,
				);
				const proofKeyPredicates = operation.keyFields.map((keyPath) => {
					const field = fieldByPath(collection, keyPath);
					return `${quote("qp_current")}.${quote(field.column)} IS NOT DISTINCT FROM ${inputParameter(proofParameters, "key", field)}`;
				});
				const proofCandidateColumns = collection.fields.map(
					(field) =>
						`${candidateValueParameter(proofParameters, field)} AS ${quote(field.column)}`,
				);
				return Object.freeze({
					freshAfterRowLockWait: true as const,
					sql: `WITH ${quote("qp_current")} AS (SELECT * FROM ${collection.table} AS ${quote("qp_current")} WHERE ${proofKeyPredicates.join(" AND ")} LIMIT 1), ${quote("qp_candidate")} AS (SELECT ${proofCandidateColumns.join(", ")}) SELECT TRUE FROM ${quote("qp_current")} CROSS JOIN ${quote("qp_candidate")} WHERE ${candidatePolicyProof.checks.map(({ sql }) => sql).join(" AND ")} LIMIT 1`,
					parameters: proofParameters.values(),
					outcome: "authorizedOrUnavailable" as const,
				});
			})()
		: undefined;
	return Object.freeze({
		identity: operation.identity,
		target: operation.target,
		member: "update",
		policy: operation.policy,
		outputCardinality: "optionalOne",
		lifecycle: Object.freeze([
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
		] as const),
		normalizerProgram: normalizer,
		serverValueProgram: serverValues,
		candidate: Object.freeze({
			steps: candidate.steps,
			fields: Object.freeze(
				collection.fields.map((field) =>
					Object.freeze({
						path: field.path,
						column: field.column,
						codec: field.codec,
						nullable: field.nullable,
						requiredInput: false,
					}),
				),
			),
		}),
		lock: Object.freeze({
			sql: `SELECT TRUE AS ${quote("qp_locked")} FROM ${collection.table} AS ${quote("qp_lock_row")} WHERE ${lockPredicates.join(" AND ")} LIMIT 1 FOR UPDATE`,
			parameters: lockParameters.values(),
			outcome: "internalLockedOrAbsent" as const,
		}),
		candidateValidation: Object.freeze({
			freshAfterRowLockWait: true as const,
			sql: `WITH ${validationCurrentCte}, ${validationCandidateCte} SELECT ${[...validationSelected, ...(validationCurrentSelected ?? [])].join(", ")} FROM ${quote("qp_candidate")}${validationCurrentSelected ? ` CROSS JOIN ${quote("qp_current")}` : ""}`,
			parameters: validationParameters.values(),
			result: validationResult,
			...(validationCurrentResult
				? { currentResult: Object.freeze(validationCurrentResult) }
				: {}),
		}),
		fieldAuthority: Object.freeze({
			suppliedPathsOnly: true,
			checks: Object.freeze(authorityChecks),
		}),
		currentPolicy: Object.freeze({
			freshAfterRowLockWait: true,
			mutableEvidenceCollections: currentCheck.mutableEvidenceCollections,
			sql: currentCheck.sql,
		}),
		candidatePolicy: Object.freeze({
			freshAfterRowLockWait: true,
			mutableEvidenceCollections: candidateCheck.mutableEvidenceCollections,
			sql: candidateCheck.sql,
		}),
		...(candidatePolicyCheck ? { candidatePolicyCheck } : {}),
		outputAuthority: Object.freeze({
			freshAfterRowLockWait: true as const,
			selectedPaths: Object.freeze(outputAuthority),
		}),
		write: Object.freeze({
			sql: `WITH ${currentCte}, ${candidateCte}, ${updatedCte} SELECT ${selected.join(", ")} FROM ${quote("qp_updated")} AS ${quote("qp_row")}${joins.length > 0 ? ` ${joins.join(" ")}` : ""}`,
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
		.filter((operation) =>
			["get", "create", "update", "delete"].includes(operation.member),
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
			if (operation.member === "delete")
				return deletePlan(
					operation,
					collection,
					policy,
					input.schemaProjection,
				);
			const normalizer = linkedProgram(
				input.normalizerPrograms,
				"questpie.field-normalizer-programs",
				"programs",
				"normalizer program",
				operation,
				operation.normalizerProgramDigest,
			);
			const serverValues = linkedProgram(
				input.serverValuePrograms,
				"questpie.server-value-programs",
				"programs",
				"server value program",
				operation,
				operation.serverValueProgramDigest,
			);
			if (operation.member === "update")
				return updatePlan(
					operation,
					collection,
					policy,
					input.schemaProjection,
					normalizer,
					serverValues,
				);
			return lowerPostgresCreateOperationPlan({
				operation,
				collection,
				policy,
				schema: input.schemaProjection,
				normalizer,
				serverValues,
			});
		})
		.sort((left, right) => compareAscii(left.identity, right.identity));
	const unsigned = Object.freeze({
		format: "questpie.postgres-collection-operation-plans",
		version: 1,
		plans: Object.freeze(plans),
	});
	return Object.freeze({
		...unsigned,
		digest: digest("questpie-postgres-collection-operation-plans-v1", unsigned),
	});
}
