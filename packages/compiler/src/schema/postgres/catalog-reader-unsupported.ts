import {
	defineCatalogStatement,
	executeCatalogStatement,
	type CatalogStatementSql,
} from "./catalog-reader-statements";
import type { JsonRecord } from "./catalog-reader-types";

function text(value: unknown): string {
	if (typeof value !== "string" || value.length === 0) throw new TypeError();
	return value;
}

export const catalogUnsupportedStatement = defineCatalogStatement({
	name: "readiness.catalog.unsupported",
	text: `SELECT CASE p.prokind WHEN 'f' THEN 'function' WHEN 'p' THEN 'procedure' ELSE 'other' END,
       CASE p.prokind WHEN 'f' THEN 'function' WHEN 'p' THEN 'procedure' ELSE p.prokind::text END
         || ':' || $1 || '.' || p.proname || '('
         || COALESCE((
           SELECT pg_catalog.string_agg(
             pg_catalog.format_type(argument.type_oid, null),
             ',' ORDER BY argument.ordinality
           )
           FROM pg_catalog.unnest(p.proargtypes::oid[])
             WITH ORDINALITY AS argument(type_oid, ordinality)
         ), '') || ')',
       null::text
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = $1
UNION ALL
SELECT CASE t.typtype WHEN 'd' THEN 'domain' WHEN 'e' THEN 'enum' ELSE 'compositeType' END,
       $1 || '.' || t.typname,
       null::text
FROM pg_catalog.pg_type t
JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
LEFT JOIN pg_catalog.pg_class composite ON composite.oid = t.typrelid
WHERE n.nspname = $1
  AND (t.typtype IN ('d', 'e') OR (t.typtype = 'c' AND composite.relkind = 'c'))
UNION ALL
SELECT 'trigger', $1 || '.' || c.relname || '.' || tg.tgname,
       $1 || '.' || c.relname
FROM pg_catalog.pg_trigger tg
JOIN pg_catalog.pg_class c ON c.oid = tg.tgrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = $1 AND NOT tg.tgisinternal
UNION ALL
SELECT 'policy', $1 || '.' || c.relname || '.' || pol.polname,
       $1 || '.' || c.relname
FROM pg_catalog.pg_policy pol
JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = $1
UNION ALL
SELECT 'rule', $1 || '.' || c.relname || '.' || r.rulename,
       $1 || '.' || c.relname
FROM pg_catalog.pg_rewrite r
JOIN pg_catalog.pg_class c ON c.oid = r.ev_class
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = $1 AND r.rulename <> '_RETURN'`,
	decodeRow(row): JsonRecord {
		if (row.length !== 3 || (row[2] !== null && typeof row[2] !== "string"))
			throw new TypeError();
		return Object.freeze({
			kind: text(row[0]),
			qualifiedIdentity: text(row[1]),
			attachedTo: row[2] === null ? null : text(row[2]),
		});
	},
});

export async function readUnsupportedCatalogObjects(
	sql: CatalogStatementSql,
	applicationSchema: string,
): Promise<readonly JsonRecord[]> {
	return executeCatalogStatement(
		sql,
		catalogUnsupportedStatement,
		applicationSchema,
	);
}
