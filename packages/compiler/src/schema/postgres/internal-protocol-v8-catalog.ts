import {
	internalProtocolV7Columns,
	internalProtocolV7Constraints,
	internalProtocolV7Indexes,
	internalProtocolV7Tables,
} from "./internal-protocol-v7-catalog";

const traceColumns = [
	["durable_runs", "trace_id", "bytea", false],
	["durable_runs", "span_id", "bytea", false],
	["durable_runs", "trace_flags", "smallint", false],
] as const;

const traceConstraint = [
	"durable_runs",
	"durable_run_trace_context_complete",
	"c",
	"CHECK (trace_id IS NULL AND span_id IS NULL AND trace_flags IS NULL OR octet_length(trace_id) = 16 AND trace_id <> decode(repeat('00'::text, 16), 'hex'::text) AND octet_length(span_id) = 8 AND span_id <> decode(repeat('00'::text, 8), 'hex'::text) AND trace_flags >= 0 AND trace_flags <= 255)",
] as const;

function insertAfterTable<Row extends readonly unknown[]>(
	rows: readonly Row[],
	table: string,
	additions: readonly Row[],
): readonly Row[] {
	const result = [...rows];
	const index = result.findLastIndex((row) => row[0] === table) + 1;
	if (index === 0) throw new TypeError(`catalog table ${table} is absent`);
	result.splice(index, 0, ...additions);
	return Object.freeze(result);
}

function compareCatalogRows(
	left: readonly unknown[],
	right: readonly unknown[],
): number {
	const leftKey = `${String(left[0])}\0${String(left[1])}`;
	const rightKey = `${String(right[0])}\0${String(right[1])}`;
	return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

export const internalProtocolV8Tables = Object.freeze([
	...internalProtocolV7Tables,
]);
export const internalProtocolV8Columns = insertAfterTable<
	readonly [string, string, string, boolean]
>(
	// Widen the generated v7 literal union so the exact v8 additions can join it.
	// The production catalog verifier still compares every tuple.
	internalProtocolV7Columns,
	"durable_runs",
	traceColumns as readonly (readonly [string, string, string, boolean])[],
);
export const internalProtocolV8Constraints = Object.freeze(
	(
		[...internalProtocolV7Constraints, traceConstraint] as (readonly [
			string,
			string,
			string,
			string,
		])[]
	).sort(compareCatalogRows),
);
export const internalProtocolV8Indexes = Object.freeze([
	...internalProtocolV7Indexes,
]);
