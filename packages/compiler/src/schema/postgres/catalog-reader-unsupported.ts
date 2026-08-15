import type { SQL } from "bun";

import type { JsonRecord } from "./catalog-reader-types";

export async function readUnsupportedCatalogObjects(
	sql: SQL,
	applicationSchema: string,
): Promise<readonly JsonRecord[]> {
	return sql<
		{ kind: string; qualifiedIdentity: string; attachedTo: string | null }[]
	>`
		select case p.prokind when 'f' then 'function' when 'p' then 'procedure' else 'other' end as kind,
		       case p.prokind when 'f' then 'function' when 'p' then 'procedure' else p.prokind::text end
		         || ':' || ${applicationSchema} || '.' || p.proname || '('
		         || coalesce((
		           select pg_catalog.string_agg(
		             pg_catalog.format_type(argument.type_oid, null),
		             ',' order by argument.ordinality
		           )
		           from pg_catalog.unnest(p.proargtypes::oid[])
		             with ordinality as argument(type_oid, ordinality)
		         ), '') || ')' as "qualifiedIdentity",
		       null::text as "attachedTo"
		from pg_catalog.pg_proc p
		join pg_catalog.pg_namespace n on n.oid = p.pronamespace
		where n.nspname = ${applicationSchema}
		union all
		select case t.typtype when 'd' then 'domain' when 'e' then 'enum' else 'compositeType' end,
		       ${applicationSchema} || '.' || t.typname,
		       null::text
		from pg_catalog.pg_type t
		join pg_catalog.pg_namespace n on n.oid = t.typnamespace
		left join pg_catalog.pg_class composite on composite.oid = t.typrelid
		where n.nspname = ${applicationSchema}
		  and (
		    t.typtype in ('d', 'e')
		    or (t.typtype = 'c' and composite.relkind = 'c')
		  )
		union all
		select 'trigger', ${applicationSchema} || '.' || c.relname || '.' || tg.tgname,
		       ${applicationSchema} || '.' || c.relname
		from pg_catalog.pg_trigger tg
		join pg_catalog.pg_class c on c.oid = tg.tgrelid
		join pg_catalog.pg_namespace n on n.oid = c.relnamespace
		where n.nspname = ${applicationSchema} and not tg.tgisinternal
		union all
		select 'policy', ${applicationSchema} || '.' || c.relname || '.' || pol.polname,
		       ${applicationSchema} || '.' || c.relname
		from pg_catalog.pg_policy pol
		join pg_catalog.pg_class c on c.oid = pol.polrelid
		join pg_catalog.pg_namespace n on n.oid = c.relnamespace
		where n.nspname = ${applicationSchema}
		union all
		select 'rule', ${applicationSchema} || '.' || c.relname || '.' || r.rulename,
		       ${applicationSchema} || '.' || c.relname
		from pg_catalog.pg_rewrite r
		join pg_catalog.pg_class c on c.oid = r.ev_class
		join pg_catalog.pg_namespace n on n.oid = c.relnamespace
		where n.nspname = ${applicationSchema} and r.rulename <> '_RETURN'
	`;
}
