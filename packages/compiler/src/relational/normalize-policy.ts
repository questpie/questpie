import { compareAscii } from "../canonical";
import { CompilerDiagnosticError } from "../diagnostic";
import {
	array,
	cloneJson,
	compareCanonical,
	invalidOperator,
	record,
	string,
} from "./shared";
import type {
	CollectionIdentity,
	PolicyExpressionV1,
	PolicyFieldsV1,
	PolicyIdentity,
	PolicyOperationsV1,
	PolicyProgramV1,
} from "./types";

const policyExpressionKinds = new Set([
	"and",
	"constant",
	"equal",
	"exists",
	"in",
	"not",
	"notEqual",
	"or",
]);

function normalizeExpression(value: unknown): PolicyExpressionV1 {
	const expression = record(value, "Policy expression");
	const kind = string(expression.kind, "Policy expression kind");
	if (!policyExpressionKinds.has(kind)) invalidOperator(kind);
	if (kind === "and" || kind === "or")
		return {
			kind,
			items: array(expression.items, `${kind} items`).map(normalizeExpression),
		};
	if (kind === "not")
		return {
			kind,
			expression: normalizeExpression(expression.expression),
		};
	if (kind === "exists")
		return {
			kind,
			collection: string(
				expression.collection,
				"Policy evidence Collection",
			) as CollectionIdentity,
			scope: string(expression.scope, "Policy evidence scope"),
			semantics: "policyEvidenceBooleanOnly",
			targetDisclosurePolicy: "notApplied",
			predicate: normalizeExpression(expression.predicate),
		};
	if (kind === "in") {
		const values = array(expression.values, "Policy membership values")
			.map(cloneJson)
			.sort(compareCanonical)
			.filter(
				(value, index, items) =>
					index === 0 || compareCanonical(value, items[index - 1]) !== 0,
			);
		return {
			kind,
			operand: cloneJson(expression.operand),
			values,
		} as PolicyExpressionV1;
	}
	return cloneJson(expression) as PolicyExpressionV1;
}

function normalizeOperation(value: unknown): unknown {
	const operation = record(value, "Policy operation");
	return Object.fromEntries(
		Object.entries(operation).map(([key, child]) => [
			key,
			key === "rows" || key === "current" || key === "candidate"
				? record(child, key).kind === "sameRelationalScopeAsRead"
					? cloneJson(child)
					: normalizeExpression(child)
				: cloneJson(child),
		]),
	);
}

function normalizeFieldRules(value: unknown): PolicyFieldsV1 {
	const fields = record(value, "Policy fields");
	const normalizeRules = (rules: unknown): unknown[] =>
		array(rules, "Policy Field rules")
			.map((rawRule) => {
				const rule = record(rawRule, "Policy Field rule");
				return record(
					{ ...rule, when: normalizeExpression(rule.when) },
					"normalized Policy Field rule",
				);
			})
			.sort((left, right) =>
				compareAscii(JSON.stringify(left.path), JSON.stringify(right.path)),
			);
	const callerInput = fields.callerInput
		? Object.fromEntries(
				Object.entries(record(fields.callerInput, "caller input rules")).map(
					([key, rules]) => [
						key,
						Array.isArray(rules) ? normalizeRules(rules) : cloneJson(rules),
					],
				),
			)
		: undefined;
	return {
		...fields,
		...(callerInput ? { callerInput } : {}),
		...(fields.selectedOutput
			? { selectedOutput: normalizeRules(fields.selectedOutput) }
			: {}),
	} as unknown as PolicyFieldsV1;
}

function normalizePolicyProgram(value: unknown): PolicyProgramV1 {
	const input = record(value, "Policy program");
	const operations = Object.fromEntries(
		Object.entries(record(input.operations, "Policy operations")).map(
			([key, operation]) => [key, normalizeOperation(operation)],
		),
	);
	return {
		format: "questpie.policy-program",
		version: 1,
		identity: string(input.identity, "Policy identity") as PolicyIdentity,
		target: string(input.target, "Policy target") as CollectionIdentity,
		attachment: cloneJson(input.attachment) as PolicyProgramV1["attachment"],
		operations: operations as PolicyOperationsV1,
		...(input.limits
			? { limits: cloneJson(input.limits) as PolicyProgramV1["limits"] }
			: {}),
		...(input.fields ? { fields: normalizeFieldRules(input.fields) } : {}),
		...(input.phaseOrder
			? {
					phaseOrder: cloneJson(
						input.phaseOrder,
					) as PolicyProgramV1["phaseOrder"],
				}
			: {}),
		...(input.evidenceUse
			? {
					evidenceUse: cloneJson(
						input.evidenceUse,
					) as PolicyProgramV1["evidenceUse"],
				}
			: {}),
		...(input.disclosureUse
			? {
					disclosureUse: cloneJson(
						input.disclosureUse,
					) as PolicyProgramV1["disclosureUse"],
				}
			: {}),
	};
}

export function normalizePolicyPrograms(
	values: readonly unknown[],
): readonly PolicyProgramV1[] {
	return values
		.map(normalizePolicyProgram)
		.sort((left, right) => compareAscii(left.identity, right.identity));
}

export function selectDefaultPolicy(
	collection: CollectionIdentity,
	programs: readonly PolicyProgramV1[],
): PolicyProgramV1 {
	const candidates = programs
		.filter(
			(program) =>
				program.target === collection && program.attachment.kind === "default",
		)
		.sort((left, right) => compareAscii(left.identity, right.identity));
	if (candidates.length === 1) return candidates[0]!;
	const identities = candidates.map(({ identity }) => identity);
	if (candidates.length === 0)
		throw new CompilerDiagnosticError(
			"QP-POLICY-001",
			"missingDefaultPolicy",
			`no default Policy targets ${collection}`,
			{ collection, candidates: identities, failClosed: true },
		);
	throw new CompilerDiagnosticError(
		"QP-POLICY-002",
		"ambiguousDefaultPolicy",
		`multiple default Policies target ${collection}: ${identities.join(", ")}`,
		{ collection, candidates: identities, failClosed: true },
	);
}
