import { sql } from "drizzle-orm";

export function jsonbPathRef(
	column: unknown,
	path: readonly string[] | undefined,
	preserveJsonb: boolean,
): ReturnType<typeof sql> {
	const normalizedPath = Array.isArray(path) ? [...path] : [];
	if (preserveJsonb) {
		return sql`${column}#>${textArray(normalizedPath)}`;
	}
	return sql`${column}#>>${textArray(normalizedPath)}`;
}

export function textArray(values: readonly string[]): ReturnType<typeof sql> {
	if (values.length === 0) return sql`ARRAY[]::text[]`;
	return sql`ARRAY[${sql.join(
		values.map((value) => sql`${value}`),
		sql`, `,
	)}]::text[]`;
}
