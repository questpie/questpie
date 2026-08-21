import {
	definePostgresStatement,
	type PostgresParameter,
	type PostgresStatement,
	type PostgresTransactionRunner,
} from "../postgres";
import type {
	PostgresQueryPlanV1,
	PostgresQueryResultV1,
	PostgresQueryRow,
} from "./query";

export type LinkedPostgresQueryPlan = Readonly<{
	plan: PostgresQueryPlanV1;
	statement: PostgresStatement<
		readonly PostgresParameter[],
		readonly PostgresQueryRow[]
	>;
}>;

export type LinkedPostgresQueryPlans = Readonly<{
	plans: readonly LinkedPostgresQueryPlan[];
	get(queryDigest: string): LinkedPostgresQueryPlan | undefined;
}>;

function freeze<T>(value: T): T {
	if (!value || typeof value !== "object" || Object.isFrozen(value))
		return value;
	for (const child of Object.values(value)) freeze(child);
	return Object.freeze(value);
}

function resultColumns(
	result: readonly PostgresQueryResultV1[],
): readonly string[] {
	return result.flatMap((item) => {
		if (item.kind === "field")
			return item.guardColumn === undefined
				? [item.column]
				: [item.column, item.guardColumn];
		return [item.presenceColumn, ...item.fields.map(({ column }) => column)];
	});
}

function validateParameters(plan: PostgresQueryPlanV1): void {
	const referenced = new Set(
		[...plan.sql.matchAll(/\$(\d+)(?!\d)/g)].map((match) => Number(match[1])),
	);
	if (
		referenced.size !== plan.parameters.length ||
		plan.parameters.some(
			(parameter, index) =>
				parameter.position !== index + 1 ||
				!referenced.has(parameter.position) ||
				!plan.sql.includes(
					"$" + parameter.position + "::" + parameter.postgresType,
				),
		)
	)
		throw new TypeError("Query SQL placeholders do not match its parameters");
}

function validateResultColumns(plan: PostgresQueryPlanV1): readonly string[] {
	const columns = resultColumns(plan.result);
	if (
		columns.length === 0 ||
		new Set(columns).size !== columns.length ||
		columns.some((column) => !/^qp_[A-Za-z0-9_]+$/u.test(column))
	)
		throw new TypeError("Query result columns are invalid");
	let previous = -1;
	for (const column of columns) {
		const projection = 'AS "' + column + '"';
		const position = plan.sql.indexOf(projection);
		if (
			position === -1 ||
			position <= previous ||
			plan.sql.indexOf(projection, position + projection.length) !== -1
		)
			throw new TypeError(
				"Query SQL result projection does not match its result columns",
			);
		previous = position;
	}
	return Object.freeze(columns);
}

export function linkPostgresQueryPlan(
	input: PostgresQueryPlanV1,
): LinkedPostgresQueryPlan {
	const plan = freeze(structuredClone(input));
	if (
		plan.format !== "questpie.postgres-query-plan" ||
		plan.version !== 1 ||
		!/^[0-9a-f]{64}$/u.test(plan.queryDigest) ||
		plan.queryDigest !== plan.templateDigest ||
		!/^[0-9a-f]{64}$/u.test(plan.policyProgramDigest) ||
		typeof plan.sql !== "string" ||
		plan.sql.trim().length === 0
	)
		throw new TypeError("invalid compiled PostgreSQL Query plan");
	validateParameters(plan);
	const columns = validateResultColumns(plan);
	const statement = definePostgresStatement({
		name: "query." + plan.queryDigest,
		text: plan.sql,
		parameterCount: plan.parameters.length,
		parameters: (parameters: readonly PostgresParameter[]) => parameters,
		decode(result): readonly PostgresQueryRow[] {
			if (
				result.command !== "SELECT" ||
				result.rowCount === null ||
				result.rowCount !== result.rows.length
			)
				throw new TypeError("Query statement result cardinality is invalid");
			return Object.freeze(
				result.rows.map((row) => {
					if (row.length !== columns.length)
						throw new TypeError("Query statement result width is invalid");
					return Object.freeze(
						Object.fromEntries(
							columns.map((column, index) => [column, row[index]]),
						),
					);
				}),
			);
		},
	});
	return Object.freeze({ plan, statement });
}

export function linkPostgresQueryPlans(
	artifact: string,
	expectedQueryDigests: readonly string[],
): LinkedPostgresQueryPlans {
	let decoded: unknown;
	try {
		decoded = JSON.parse(artifact);
	} catch {
		throw new TypeError("invalid PostgreSQL Query plans artifact");
	}
	if (!decoded || typeof decoded !== "object" || Array.isArray(decoded))
		throw new TypeError("invalid PostgreSQL Query plans artifact");
	const envelope = decoded as Readonly<Record<string, unknown>>;
	if (
		Object.keys(envelope).sort().join(",") !== "format,plans,version" ||
		envelope.format !== "questpie.postgres-query-plans" ||
		envelope.version !== 1 ||
		!Array.isArray(envelope.plans)
	)
		throw new TypeError("invalid PostgreSQL Query plans artifact");
	const plans = Object.freeze(
		envelope.plans.map((plan) =>
			linkPostgresQueryPlan(plan as PostgresQueryPlanV1),
		),
	);
	for (let index = 1; index < plans.length; index += 1) {
		if (plans[index - 1]!.plan.queryDigest >= plans[index]!.plan.queryDigest)
			throw new TypeError(
				"PostgreSQL Query plans must have unique sorted identities",
			);
	}
	if (
		expectedQueryDigests.length !== plans.length ||
		expectedQueryDigests.some(
			(queryDigest, index) =>
				!/^[0-9a-f]{64}$/u.test(queryDigest) ||
				(index > 0 && expectedQueryDigests[index - 1]! >= queryDigest) ||
				plans[index]!.plan.queryDigest !== queryDigest,
		)
	)
		throw new TypeError(
			"PostgreSQL Query plans do not match the Runtime Query identities",
		);
	const byDigest = new Map(
		plans.map((linked) => [linked.plan.queryDigest, linked] as const),
	);
	return Object.freeze({
		plans,
		get: (queryDigest: string) => byDigest.get(queryDigest),
	});
}

export async function executeLinkedPostgresQueryPlan(
	database: PostgresTransactionRunner,
	linked: LinkedPostgresQueryPlan,
	parameters: readonly PostgresParameter[],
	signal?: AbortSignal,
): Promise<readonly PostgresQueryRow[]> {
	return database.transaction({
		mode: { isolation: "repeatableRead", access: "readOnly" },
		control: { signal },
		use: (transaction) => transaction.execute(linked.statement, parameters),
	});
}
