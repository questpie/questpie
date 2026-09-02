import { isDeepStrictEqual } from "node:util";

import type { CursorOrderTerm, CursorScalar } from "./cursor";
import { DataQueryExecutionError } from "./query-error";
import type {
	PostgresInverseListResultV2,
	PostgresQueryPlan,
	PostgresQueryResultV1,
	ResultFieldV1,
	ScalarValue,
} from "./query-plan";
import { decodeRelationalScalar } from "./scalar";

export type PostgresQueryRow = Readonly<Record<string, unknown>>;

function decodeField(
	row: PostgresQueryRow,
	field: ResultFieldV1,
	timestampResult: "canonical" | "date" = "date",
): Date | ScalarValue | null {
	const value = row[field.column];
	if (value === null && field.nullable) return null;
	try {
		return decodeRelationalScalar(value, field.codec, timestampResult) as
			| Date
			| ScalarValue;
	} catch {
		throw new DataQueryExecutionError("QP-DATA-001", "execute");
	}
}

function decodeRelatedRow(
	row: PostgresQueryRow,
	item: Extract<PostgresQueryResultV1, { kind: "toOne" }>,
): Readonly<Record<string, unknown>> {
	const related: Record<string, unknown> = {};
	for (const field of item.fields) {
		if (field.guardColumn !== undefined) {
			const guard = row[field.guardColumn];
			if (guard === false) continue;
			if (guard !== true)
				throw new DataQueryExecutionError("QP-DATA-001", "execute");
		}
		related[field.key] = decodeField(row, field);
	}
	for (const nested of item.relations ?? []) {
		const present = row[nested.presenceColumn];
		if (present === null) related[nested.key] = null;
		else if (present === true)
			related[nested.key] = decodeRelatedRow(row, nested);
		else throw new DataQueryExecutionError("QP-DATA-001", "execute");
	}
	return Object.freeze(related);
}

export function decodePostgresQueryRow(
	row: PostgresQueryRow,
	result: readonly (PostgresQueryResultV1 | PostgresInverseListResultV2)[],
	inverseLists: ReadonlyMap<
		PostgresInverseListResultV2,
		readonly Readonly<Record<string, unknown>>[]
	> = new Map(),
): Readonly<Record<string, unknown>> {
	const output: Record<string, unknown> = {};
	for (const item of result) {
		if (item.kind === "inverseList") {
			const children = inverseLists.get(item);
			if (!children)
				throw new DataQueryExecutionError("QP-DATA-001", "execute");
			output[item.key] = children;
			continue;
		}
		if (item.kind === "field") {
			if (item.guardColumn !== undefined) {
				const guard = row[item.guardColumn];
				if (guard === false) continue;
				if (guard !== true)
					throw new DataQueryExecutionError("QP-DATA-001", "execute");
			}
			output[item.key] = decodeField(row, item);
			continue;
		}
		const present = row[item.presenceColumn];
		if (present === null) {
			output[item.key] = null;
			continue;
		}
		if (present !== true)
			throw new DataQueryExecutionError("QP-DATA-001", "execute");
		output[item.key] = decodeRelatedRow(row, item);
	}
	return Object.freeze(output);
}

function decodeInverseRow(
	row: PostgresQueryRow,
	item: PostgresInverseListResultV2,
): Readonly<Record<string, unknown>> {
	const child: Record<string, unknown> = {};
	for (const field of item.fields) {
		if (field.guardColumn !== undefined) {
			const guard = row[field.guardColumn];
			if (guard === false) continue;
			if (guard !== true)
				throw new DataQueryExecutionError("QP-DATA-001", "execute");
		}
		child[field.key] = decodeField(row, field);
	}
	for (const relation of item.relations) {
		const present = row[relation.presenceColumn];
		if (present === null) child[relation.key] = null;
		else if (present === true)
			child[relation.key] = decodeRelatedRow(row, relation);
		else throw new DataQueryExecutionError("QP-DATA-001", "execute");
	}
	return Object.freeze(child);
}

export function postgresQueryOrderTerms(
	plan: PostgresQueryPlan,
): readonly CursorOrderTerm[] {
	const result: readonly (
		| PostgresQueryResultV1
		| PostgresInverseListResultV2
	)[] = plan.result;
	return plan.page.order.map((term) => {
		const selected = result.find(
			(item): item is ResultFieldV1 & Readonly<{ kind: "field" }> =>
				item.kind === "field" && item.field === term.field,
		);
		if (
			!selected ||
			selected.guardColumn !== undefined ||
			selected.codec.kind !== term.codec ||
			selected.nullable !== term.nullable ||
			!term.field.startsWith("collection:") ||
			!term.field.includes("/field:") ||
			![
				"bigint",
				"boolean",
				"date",
				"integer",
				"numeric",
				"text",
				"timestamp",
				"uuid",
			].includes(term.codec)
		)
			throw new TypeError("invalid compiled cursor order");
		const codec = selected.codec;
		return {
			field: term.field as CursorOrderTerm["field"],
			codec: term.codec as CursorOrderTerm["codec"],
			nullable: term.nullable,
			...(codec.kind === "timestamp"
				? { withTimezone: codec.withTimezone }
				: codec.kind === "integer" || codec.kind === "bigint"
					? { minimum: codec.minimum, maximum: codec.maximum }
					: codec.kind === "numeric"
						? { precision: codec.precision, scale: codec.scale }
						: {}),
		};
	});
}

export function postgresQueryCursorValues(
	plan: PostgresQueryPlan,
	row: PostgresQueryRow,
): readonly CursorScalar[] {
	const result: readonly (
		| PostgresQueryResultV1
		| PostgresInverseListResultV2
	)[] = plan.result;
	return plan.page.order.map((term) => {
		const field = result.find(
			(item): item is ResultFieldV1 & Readonly<{ kind: "field" }> =>
				item.kind === "field" && item.field === term.field,
		);
		if (!field || field.guardColumn !== undefined)
			throw new TypeError("invalid compiled cursor result Field");
		return decodeField(row, field, "canonical") as CursorScalar;
	});
}

export function positivePostgresOrdinal(value: unknown): number | null {
	if (value === null) return null;
	const ordinal =
		typeof value === "bigint"
			? Number(value)
			: typeof value === "string" && /^[1-9][0-9]*$/u.test(value)
				? Number(value)
				: value;
	if (!Number.isSafeInteger(ordinal) || Number(ordinal) < 1)
		throw new DataQueryExecutionError("QP-DATA-001", "execute");
	return Number(ordinal);
}

function inversePhysicalValues(
	row: PostgresQueryRow,
	item: PostgresInverseListResultV2,
): readonly unknown[] {
	const related = (
		relations: readonly Extract<PostgresQueryResultV1, { kind: "toOne" }>[],
	): readonly unknown[] =>
		relations.flatMap((relation) => [
			row[relation.presenceColumn],
			...relation.fields.flatMap((field) => [
				row[field.column],
				...(field.guardColumn === undefined ? [] : [row[field.guardColumn]]),
			]),
			...related(relation.relations ?? []),
		]);
	return [
		...item.fields.flatMap((field) => [
			row[field.column],
			...(field.guardColumn === undefined ? [] : [row[field.guardColumn]]),
		]),
		...related(item.relations),
	];
}

export function decodePostgresInversePage(
	plan: Extract<PostgresQueryPlan, { version: 2 }>,
	rows: readonly PostgresQueryRow[],
	first: number,
): Readonly<{
	nodes: readonly Readonly<Record<string, unknown>>[];
	representativeRows: readonly PostgresQueryRow[];
	flattenedVisibleRows: readonly PostgresQueryRow[];
	hasNextPage: boolean;
}> {
	const inverseLists = plan.result.filter(
		(result): result is PostgresInverseListResultV2 =>
			result.kind === "inverseList",
	);
	if (inverseLists.length !== 1)
		throw new TypeError("invalid linked inverse Query result");
	const inverse = inverseLists[0]!;
	if (rows.length > (first + 1) * inverse.first || rows.length > 5_050)
		throw new DataQueryExecutionError("QP-DATA-012", "execute");

	const groups: { ordinal: number; rows: PostgresQueryRow[] }[] = [];
	for (const row of rows) {
		const ordinal = positivePostgresOrdinal(row[plan.ordinalColumns[0]]);
		if (ordinal === null || ordinal > first + 1)
			throw new DataQueryExecutionError("QP-DATA-001", "execute");
		const current = groups.at(-1);
		if (current?.ordinal === ordinal) current.rows.push(row);
		else {
			if (ordinal !== groups.length + 1)
				throw new DataQueryExecutionError("QP-DATA-001", "execute");
			groups.push({ ordinal, rows: [row] });
		}
	}
	if (groups.length > first + 1)
		throw new DataQueryExecutionError("QP-DATA-012", "execute");

	const decoded = groups.map((group): Readonly<Record<string, unknown>> => {
		const firstRow = group.rows[0]!;
		const withoutChildren = new Map([[inverse, Object.freeze([])] as const]);
		const root = decodePostgresQueryRow(firstRow, plan.result, withoutChildren);
		for (const duplicate of group.rows.slice(1))
			if (
				!isDeepStrictEqual(
					decodePostgresQueryRow(duplicate, plan.result, withoutChildren),
					root,
				)
			)
				throw new DataQueryExecutionError("QP-DATA-001", "execute");

		const children: Readonly<Record<string, unknown>>[] = [];
		for (const [index, row] of group.rows.entries()) {
			const childOrdinal = positivePostgresOrdinal(row[inverse.ordinalColumn]);
			if (childOrdinal === null) {
				if (
					group.rows.length !== 1 ||
					inversePhysicalValues(row, inverse).some((value) => value !== null)
				)
					throw new DataQueryExecutionError("QP-DATA-001", "execute");
				continue;
			}
			if (childOrdinal !== index + 1 || childOrdinal > inverse.first)
				throw new DataQueryExecutionError("QP-DATA-001", "execute");
			children.push(decodeInverseRow(row, inverse));
		}
		return decodePostgresQueryRow(
			firstRow,
			plan.result,
			new Map([[inverse, Object.freeze(children)]]),
		);
	});
	return Object.freeze({
		nodes: Object.freeze(decoded.slice(0, first)),
		representativeRows: Object.freeze(
			groups.slice(0, first).map(({ rows: groupRows }) => groupRows[0]!),
		),
		flattenedVisibleRows: Object.freeze(
			groups.slice(0, first).flatMap(({ rows: groupRows }) => groupRows),
		),
		hasNextPage: groups.length > first,
	});
}
