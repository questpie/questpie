import {
	and,
	Column,
	eq,
	getTableColumns,
	is,
	Name,
	not,
	or,
	SQL,
	type SQLChunk,
	sql,
} from "drizzle-orm";
import { alias, type PgTable } from "drizzle-orm/pg-core";

import type {
	AccessWhere,
	CollectionBuilderState,
} from "#questpie/server/collection/builder/types.js";
import { buildWhereClause } from "#questpie/server/collection/crud/query-builders/where-builder.js";
import {
	checkFieldWriteAccess,
	executeAccessRule,
	getRestrictedReadFields,
	mergeFieldAccessRules,
} from "#questpie/server/collection/crud/shared/access-control.js";
import type { CRUDContext } from "#questpie/server/collection/crud/types.js";
import type { Questpie } from "#questpie/server/config/questpie.js";
import { rowsOf } from "#questpie/server/db/driver-result.js";

import type { CrdtAuthentication } from "./authority.js";
import {
	createCrdtAuthorizationResolverV1,
	type CrdtResolvedOwnerV1,
} from "./authorization-resolver.js";

export function createQuestpieCrdtAuthorizationResolverV1(
	app: Questpie<any>,
	requestContexts: WeakMap<Request, CRUDContext> = new WeakMap(),
) {
	const runtime = app.config.crdt;
	if (!runtime) {
		throw new TypeError(
			"QUESTPIE CRDT authorization requires runtimeConfig({ crdt })",
		);
	}
	return createCrdtAuthorizationResolverV1({
		db: app.db,
		namespace: runtime.namespace,
		manifests: app.crdtManifests,
		engines: runtime.engines ?? {},
		loadOwnerRecord: async ({ owner, authentication, request }) => {
			await contextFor(app, requestContexts, request, authentication);
			return loadQuestpieCrdtOwnerRecord(app, owner);
		},
		authorizePolicy: async ({ owner, authentication, request, record }) => {
			const context = await contextFor(
				app,
				requestContexts,
				request,
				authentication,
			);
			return evaluateQuestpieCrdtOwnerPolicy(app, owner, record, context);
		},
		isAwarenessEnabled: (owner) =>
			Boolean(
				(owner.kind === "collection"
					? app.crdtRegistry.collections[owner.key]
					: app.crdtRegistry.globals[owner.key]
				)?.awarenessSchema,
			),
	});
}

async function contextFor(
	app: Questpie<any>,
	cache: WeakMap<Request, CRUDContext>,
	request: Request,
	authentication: CrdtAuthentication,
): Promise<CRUDContext> {
	const cached = cache.get(request);
	if (cached) return cached;
	if (authentication.actor.kind === "human") {
		const principal = authentication.principal;
		if (!principal)
			throw new Error("CRDT Human context is missing a principal");
		const context = await app.createContext({
			principal,
			session:
				principal.kind === "user"
					? { user: principal.user, session: principal.session }
					: null,
			actor: authentication.actor,
			accessMode: "user",
			request,
		});
		cache.set(request, context as CRUDContext);
		return context as CRUDContext;
	}
	const context = await app.createContext({
		session: null,
		actor: authentication.actor,
		accessMode: "user",
		request,
	});
	cache.set(request, context as CRUDContext);
	return context as CRUDContext;
}

export async function loadQuestpieCrdtOwnerRecord(
	app: Questpie<any>,
	owner: CrdtResolvedOwnerV1,
	database: Questpie<any>["db"] = app.db,
): Promise<Record<string, unknown> | null> {
	const crud =
		owner.kind === "collection"
			? (app.collections as Record<string, any>)[owner.key]
			: (app.globals as Record<string, any>)[owner.key];
	const table = crud?.["~internalRelatedTable"];
	if (!table) return null;
	if (owner.kind === "global") {
		const [record] = await database.select().from(table).limit(1);
		return (record as Record<string, unknown> | undefined) ?? null;
	}
	const id = getTableColumns(table).id;
	if (!id) return null;
	const [record] = await database
		.select()
		.from(table)
		.where(eq(id, owner.id))
		.limit(1);
	return (record as Record<string, unknown> | undefined) ?? null;
}

export async function evaluateQuestpieCrdtOwnerPolicy(
	app: Questpie<any>,
	owner: CrdtResolvedOwnerV1,
	record: Record<string, unknown>,
	context: CRUDContext,
	database: Questpie<any>["db"] = app.db,
) {
	const crud =
		owner.kind === "collection"
			? (app.collections as Record<string, any>)[owner.key]
			: (app.globals as Record<string, any>)[owner.key];
	const state = crud?.["~internalState"] as
		| (CollectionBuilderState & {
				access?: Record<string, any>;
		  })
		| undefined;
	const table = crud?.["~internalRelatedTable"] as PgTable | undefined;
	const i18nTable = crud?.["~internalI18nTable"] as PgTable | null | undefined;
	const crdtFields = new Set(
		Object.keys(app.crdtRegistry.collections[owner.key]?.fields ?? {}),
	);
	if (!state) throw new Error("CRDT owner policy state is unavailable");
	const read = await ownerAccess(
		app,
		state,
		"read",
		context,
		record,
		undefined,
		owner.kind === "collection",
		database,
		table,
		i18nTable,
		crdtFields,
	);
	if (!read) {
		return { ownerRead: false, ownerEdit: false, fields: {} };
	}
	let edit = false;
	try {
		edit = await ownerAccess(
			app,
			state,
			"update",
			context,
			record,
			Object.freeze({}),
			owner.kind === "collection",
			database,
			table,
			i18nTable,
			crdtFields,
		);
	} catch {
		edit = false;
	}
	const fieldAccess = mergeFieldAccessRules(
		state.access?.fields,
		state.fieldDefinitions,
	);
	const restricted = new Set(
		await getRestrictedReadFields(structuredClone(record), context, {
			app,
			db: database,
			fieldAccess,
		}),
	);
	const fields: Record<string, { read: boolean; edit: boolean }> = {};
	for (const path of Object.keys(
		owner.kind === "collection"
			? (app.crdtRegistry.collections[owner.key]?.fields ?? {})
			: (app.crdtRegistry.globals[owner.key]?.fields ?? {}),
	)) {
		const readField = !restricted.has(path);
		const editField =
			readField &&
			edit &&
			(await checkFieldWriteAccess(
				path,
				fieldAccess,
				context,
				{ app, db: database },
				"update",
				record,
			));
		fields[path] = { read: readField, edit: editField };
	}
	return { ownerRead: true, ownerEdit: edit, fields };
}

async function ownerAccess(
	app: Questpie<any>,
	state: CollectionBuilderState & { access?: Record<string, any> },
	operation: "read" | "update",
	context: CRUDContext,
	record: Record<string, unknown>,
	input: unknown,
	allowWhere: boolean,
	database: Questpie<any>["db"],
	table?: PgTable,
	i18nTable?: PgTable | null,
	crdtFields: ReadonlySet<string> = new Set(),
): Promise<boolean> {
	const rule = state.access?.[operation] ?? app.defaultAccess?.[operation];
	const result = await executeAccessRule(rule, {
		app,
		db: database,
		session: context.session,
		principal: context.principal,
		actor: context.actor,
		locale: context.locale,
		row: record,
		input,
		request: (context as CRUDContext & { request?: Request }).request,
		contextExtensions: context["~contextExtensions"],
	});
	if (result === true) return true;
	if (allowWhere && result && typeof result === "object" && table) {
		const sourceId = getTableColumns(table).id;
		const recordId = record.id;
		if (
			!sourceId ||
			(typeof recordId !== "string" && typeof recordId !== "number")
		) {
			return false;
		}
		const useI18n = Boolean(i18nTable);
		const needsFallback =
			useI18n &&
			context.localeFallback !== false &&
			context.locale !== context.defaultLocale;
		const i18nCurrentTable = useI18n
			? alias(i18nTable!, "crdt_i18n_current")
			: null;
		const i18nFallbackTable = needsFallback
			? alias(i18nTable!, "crdt_i18n_fallback")
			: null;
		const sourceColumns = getTableColumns(table);
		const currentCrdtExpressions = Object.fromEntries(
			[...crdtFields]
				.filter((field) => field in record && sourceColumns[field])
				.map((field) => [
					field,
					sql`CAST(${sql.param(record[field], sourceColumns[field])} AS ${sql.raw(sourceColumns[field]!.getSQLType())})`,
				]),
		);
		const currentAwareVirtuals = Object.fromEntries(
			Object.entries(state.virtuals ?? {}).map(([field, expression]) => [
				field,
				rewriteCrdtVirtualExpression(
					expression,
					sourceColumns,
					currentCrdtExpressions,
				),
			]),
		);
		const policyState = {
			...state,
			virtuals: { ...currentAwareVirtuals, ...currentCrdtExpressions },
		};
		const compiledAccess = buildCrdtAccessWhereClause(result as AccessWhere, {
			table,
			state: policyState,
			i18nCurrentTable,
			i18nFallbackTable,
			useI18n,
			context,
			app,
			db: database,
			failClosedAccess: true,
			parentRecord: record,
			relationAliasDepth: 0,
		});
		const access = rewriteCrdtVirtualExpression(
			compiledAccess,
			sourceColumns,
			currentCrdtExpressions,
		);
		const projectionGuards = buildCrdtProjectionGuards(
			access,
			crdtFields,
			sourceColumns,
			record,
		);
		const currentLocaleJoin = i18nCurrentTable
			? sql`LEFT JOIN ${i18nTable} AS ${sql.identifier("crdt_i18n_current")} ON ${and(
					eq(getTableColumns(i18nCurrentTable).parentId, sourceId),
					eq(
						getTableColumns(i18nCurrentTable).locale,
						context.locale ?? context.defaultLocale ?? "en",
					),
				)}`
			: sql.empty();
		const fallbackLocaleJoin = i18nFallbackTable
			? sql`LEFT JOIN ${i18nTable} AS ${sql.identifier("crdt_i18n_fallback")} ON ${and(
					eq(getTableColumns(i18nFallbackTable).parentId, sourceId),
					eq(
						getTableColumns(i18nFallbackTable).locale,
						context.defaultLocale ?? "en",
					),
				)}`
			: sql.empty();
		const [match] = rowsOf<{ matched: number }>(
			await database.execute(sql`
				SELECT 1 AS matched
				FROM ${table}
				${currentLocaleJoin}
				${fallbackLocaleJoin}
				WHERE ${and(eq(sourceId, recordId), ...projectionGuards, access)}
				LIMIT 1
			`),
		);
		return match !== undefined;
	}
	return false;
}

function rewriteCrdtVirtualExpression(
	expression: SQL,
	columns: ReturnType<typeof getTableColumns>,
	currentValues: Readonly<Record<string, SQL>>,
): SQL {
	const replacements = new Map(
		Object.entries(currentValues).flatMap(([field, current]) => {
			const column = columns[field];
			return column ? [[column, current] as const] : [];
		}),
	);
	const byName = new Map(
		Object.entries(currentValues).map(([field, current]) => [
			columns[field]?.name ?? field,
			current,
		]),
	);
	const rewriteUnqualifiedNames = hasOnlyTopLevelUnqualifiedNames(expression);
	const rewrite = (chunk: SQLChunk): SQLChunk => {
		if (is(chunk, Column)) return replacements.get(chunk) ?? chunk;
		if (is(chunk, Name) && rewriteUnqualifiedNames) {
			return byName.get(chunk.value) ?? chunk;
		}
		if (is(chunk, SQL)) {
			return new SQL(chunk.queryChunks.map(rewrite));
		}
		if (is(chunk, SQL.Aliased)) {
			return new SQL.Aliased(rewrite(chunk.sql) as SQL, chunk.fieldAlias);
		}
		return chunk;
	};
	return rewrite(expression) as SQL;
}

function hasOnlyTopLevelUnqualifiedNames(expression: SQL): boolean {
	let unsafeRawSql = false;
	const nestedScope = /\b(?:select|with|from|join|table|lateral|values)\b/i;
	const visit = (chunk: unknown): void => {
		if (!chunk || typeof chunk !== "object") return;
		if ("value" in chunk) {
			const value = (chunk as { value?: unknown }).value;
			if (
				Array.isArray(value) &&
				value.some(
					(part) =>
						typeof part === "string" &&
						(nestedScope.test(part) || part.includes(".")),
				)
			) {
				unsafeRawSql = true;
			}
		}
		if ("queryChunks" in chunk) {
			const children = (chunk as { queryChunks?: unknown }).queryChunks;
			if (Array.isArray(children)) children.forEach(visit);
		}
		if ("sql" in chunk) visit((chunk as { sql?: unknown }).sql);
	};
	visit(expression);
	return !unsafeRawSql;
}

function buildCrdtProjectionGuards(
	access: SQL,
	crdtFields: ReadonlySet<string>,
	columns: ReturnType<typeof getTableColumns>,
	record: Record<string, unknown>,
): SQL[] {
	return [...crdtFields].flatMap((field) => {
		const column = columns[field];
		if (!column || !(field in record)) return [];
		return sqlExpressionReferencesColumn(access, column.name)
			? [eq(column, sql.param(record[field], column))]
			: [];
	});
}

function sqlExpressionReferencesColumn(
	expression: unknown,
	columnName: string,
): boolean {
	const identifier = new RegExp(
		`(?:^|[^A-Za-z0-9_])${escapeRegExp(columnName)}(?:$|[^A-Za-z0-9_])`,
		"i",
	);
	const visit = (chunk: unknown): boolean => {
		if (!chunk || typeof chunk !== "object") return false;
		if (
			"name" in chunk &&
			"table" in chunk &&
			(chunk as { name?: unknown }).name === columnName
		) {
			return true;
		}
		if ("value" in chunk) {
			const value = (chunk as { value?: unknown }).value;
			if (
				typeof value === "string" &&
				value.toLocaleLowerCase("en-US") ===
					columnName.toLocaleLowerCase("en-US")
			) {
				return true;
			}
			if (
				Array.isArray(value) &&
				value.some((part) => typeof part === "string" && identifier.test(part))
			) {
				return true;
			}
		}
		if ("queryChunks" in chunk) {
			const children = (chunk as { queryChunks?: unknown }).queryChunks;
			if (Array.isArray(children) && children.some(visit)) return true;
		}
		if ("sql" in chunk) return visit((chunk as { sql?: unknown }).sql);
		return false;
	};
	return visit(expression);
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildCrdtAccessWhereClause(
	where: AccessWhere,
	options: Parameters<typeof buildWhereClause>[1],
): SQL {
	const clauses: SQL[] = [];
	const fields: Record<string, unknown> = {};

	for (const [key, value] of Object.entries(where)) {
		if (key === "AND" && Array.isArray(value)) {
			clauses.push(
				and(
					...(value as AccessWhere[]).map((entry) =>
						buildCrdtAccessWhereClause(entry, options),
					),
				) ?? sql`true`,
			);
		} else if (key === "OR" && Array.isArray(value)) {
			clauses.push(
				or(
					...(value as AccessWhere[]).map((entry) =>
						buildCrdtAccessWhereClause(entry, options),
					),
				) ?? sql`false`,
			);
		} else if (key === "NOT" && value && typeof value === "object") {
			clauses.push(
				not(buildCrdtAccessWhereClause(value as AccessWhere, options)),
			);
		} else {
			fields[key] = value;
		}
	}

	if (Object.keys(fields).length > 0) {
		const fieldsClause = buildWhereClause(fields, options);
		clauses.push(fieldsClause ?? sql`false`);
	}
	return and(...clauses) ?? sql`true`;
}
