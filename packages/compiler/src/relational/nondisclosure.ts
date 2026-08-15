import { compareAscii, digest } from "../canonical";

export interface RelationalNondisclosureQueryV1 {
	readonly queryDigest: string;
	readonly templateDigest: string;
	readonly policy: string;
	readonly policyProgramDigest: string;
	readonly postgresQueryPlanDigest: string;
	readonly keyedLookup: Readonly<{
		proofPlanDigest: string;
		keyField: string;
		outcomeColumn: "qp_key_outcome";
		disclosure: "outcomeOnly";
		outcomes: Readonly<{
			authorized: "found";
			unavailable: "notFound";
		}>;
	}>;
	readonly countOracle: "absent";
	readonly page: Readonly<{
		rows: "authorizedBaseOnly";
		firstPlusOneSentinel: "authorizedBaseOnly";
	}>;
	readonly relation: Readonly<{
		missing: null;
		policyInvisible: null;
	}>;
	readonly selectedFieldDenied: "omitProperty";
}

export interface RelationalNondisclosureV1 {
	readonly format: "questpie.relational-nondisclosure";
	readonly version: 1;
	readonly queries: readonly RelationalNondisclosureQueryV1[];
}

function record(
	value: unknown,
	label: string,
): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new TypeError(`${label} must be an object`);
	return value as Readonly<Record<string, unknown>>;
}

function projectionEntries(
	value: unknown,
	format: string,
	key: "plans" | "policies" | "queries",
): readonly unknown[] {
	const projection = record(value, format);
	if (
		projection.format !== format ||
		projection.version !== 1 ||
		!Array.isArray(projection[key])
	)
		throw new TypeError(`invalid ${format}`);
	return projection[key];
}

function requiredString(
	value: Readonly<Record<string, unknown>>,
	key: string,
	label: string,
): string {
	const member = value[key];
	if (typeof member !== "string" || member.length === 0)
		throw new TypeError(`${label}.${key} must be a non-empty string`);
	return member;
}

function exactlyOne(
	values: readonly Readonly<Record<string, unknown>>[],
	predicate: (value: Readonly<Record<string, unknown>>) => boolean,
	label: string,
): Readonly<Record<string, unknown>> {
	const matches = values.filter(predicate);
	if (matches.length !== 1) throw new TypeError(`expected one ${label}`);
	return matches[0]!;
}

export function projectRelationalNondisclosure(
	input: Readonly<{
		policyProjection: unknown;
		queryProjection: unknown;
		postgresQueryPlans: unknown;
	}>,
): RelationalNondisclosureV1 {
	const policies = projectionEntries(
		input.policyProjection,
		"questpie.policy-projection",
		"policies",
	).map((value) => record(value, "Policy projection entry"));
	const queries = projectionEntries(
		input.queryProjection,
		"questpie.query-projection",
		"queries",
	).map((value) => record(value, "Query projection entry"));
	const plans = projectionEntries(
		input.postgresQueryPlans,
		"questpie.postgres-query-plans",
		"plans",
	).map((value) => record(value, "Postgres query plan"));

	if (queries.length !== plans.length)
		throw new TypeError(
			"every Query must have exactly one Postgres query plan",
		);

	const joined = plans.map((plan) => {
		const queryDigest = requiredString(plan, "queryDigest", "Postgres plan");
		const templateDigest = requiredString(
			plan,
			"templateDigest",
			"Postgres plan",
		);
		const policy = requiredString(plan, "policy", "Postgres plan");
		const policyProgramDigest = requiredString(
			plan,
			"policyProgramDigest",
			"Postgres plan",
		);
		const query = exactlyOne(
			queries,
			(candidate) => candidate.digest === queryDigest,
			`Query ${queryDigest}`,
		);
		if (query.policy !== policy)
			throw new TypeError(
				`Query ${queryDigest} does not select Policy ${policy}`,
			);
		if (templateDigest !== queryDigest)
			throw new TypeError(
				`Postgres plan ${queryDigest} does not preserve its Query digest`,
			);
		const selectedPolicy = exactlyOne(
			policies,
			(candidate) => {
				const program = record(candidate.program, "Policy program");
				return program.identity === policy;
			},
			`Policy ${policy}`,
		);
		const program = record(selectedPolicy.program, "Policy program");
		if (digest("questpie-policy-program-v1", program) !== policyProgramDigest)
			throw new TypeError(
				`Postgres plan ${queryDigest} does not preserve its Policy digest`,
			);
		const nondisclosure = record(
			plan.nondisclosure,
			"Postgres nondisclosure proof",
		);
		const keyedLookup = record(
			nondisclosure.keyedLookup,
			"Postgres keyed lookup proof",
		);
		if (
			keyedLookup.outcomeColumn !== "qp_key_outcome" ||
			typeof keyedLookup.sql !== "string" ||
			!Array.isArray(keyedLookup.parameters)
		)
			throw new TypeError("invalid Postgres keyed lookup proof");
		const keyField = requiredString(
			keyedLookup,
			"keyField",
			"Postgres keyed lookup proof",
		);

		return {
			queryDigest,
			templateDigest,
			policy,
			policyProgramDigest,
			postgresQueryPlanDigest: digest("questpie-postgres-query-plan-v1", plan),
			keyedLookup: {
				proofPlanDigest: digest(
					"questpie-postgres-keyed-lookup-proof-v1",
					keyedLookup,
				),
				keyField,
				outcomeColumn: "qp_key_outcome",
				disclosure: "outcomeOnly",
				outcomes: { authorized: "found", unavailable: "notFound" },
			},
			countOracle: "absent",
			page: {
				rows: "authorizedBaseOnly",
				firstPlusOneSentinel: "authorizedBaseOnly",
			},
			relation: { missing: null, policyInvisible: null },
			selectedFieldDenied: "omitProperty",
		} as const;
	});
	if (
		new Set(joined.map(({ queryDigest }) => queryDigest)).size !== joined.length
	)
		throw new TypeError(
			"every Query must have exactly one Postgres query plan",
		);

	return {
		format: "questpie.relational-nondisclosure",
		version: 1,
		queries: joined.sort((left, right) =>
			compareAscii(left.queryDigest, right.queryDigest),
		),
	};
}
