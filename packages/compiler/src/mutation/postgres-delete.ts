import { canonicalBytes } from "../canonical";
import {
	lowerPostgresMutationPolicyChecks,
	type PolicyProgramV1,
	type PostgresMutationCollectionV1,
} from "../relational";
import type { CollectionOperationProgramV1 } from "./operation-set-contract";
import type { PostgresDeleteOperationPlanV1 } from "./postgres-contract";
import {
	fieldByPath,
	inputParameter,
	policyParameters,
	quote,
	result,
	Parameters,
} from "./postgres-shared";

type OutputAuthorityEntry = Readonly<{
	path: readonly string[];
	conditional: boolean;
	guardColumn?: string;
	mutableEvidenceCollections: readonly `collection:${string}`[];
}>;

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
export function lowerPostgresDeleteOperationPlan(
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
	// Only built when the Collection has an authored lifecycle program: a
	// fresh, separate row-scope read (own Parameters, own Policy check) that
	// hands the runtime the full locked current row to interpret `validate`
	// against, mirroring get's key+Policy read idiom rather than update's
	// candidate construction, since delete has no candidate.
	const currentValidation = operation.lifecycleProgramDigest
		? (() => {
				const validationChecks = lowerPostgresMutationPolicyChecks({
					schema,
					checks: [
						{ expression: del.current, aliases: { current: "qp_current" } },
					],
				});
				const validationCheck = validationChecks.checks[0]!;
				const validationParameters = policyParameters(
					validationChecks.parameters,
				);
				const validationKeyPredicates = operation.keyFields.map((keyPath) => {
					const field = fieldByPath(collection, keyPath);
					return `${quote("qp_current")}.${quote(field.column)} IS NOT DISTINCT FROM ${inputParameter(validationParameters, "key", field)}`;
				});
				const validationResult = result(
					collection,
					collection.fields.map(({ path: fieldPath }) => fieldPath),
				);
				const validationSelected = validationResult.map((item) => {
					const field = fieldByPath(collection, item.path);
					const value =
						field.codec.kind === "timestamp"
							? `pg_catalog.date_trunc('milliseconds', ${quote("qp_current")}.${quote(field.column)})`
							: `${quote("qp_current")}.${quote(field.column)}`;
					return `${value} AS ${quote(item.column)}`;
				});
				return Object.freeze({
					freshAfterRowLockWait: true as const,
					sql: `SELECT ${validationSelected.join(", ")} FROM ${collection.table} AS ${quote("qp_current")} WHERE ${[...validationKeyPredicates, validationCheck.sql].join(" AND ")} LIMIT 1`,
					parameters: validationParameters.values(),
					result: validationResult,
				});
			})()
		: undefined;
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
		...(currentValidation ? { currentValidation } : {}),
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
