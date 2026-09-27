import { sql } from "drizzle-orm";

import type { Collection } from "#questpie/server/collection/builder/index.js";
import type { AnyCollectionState } from "#questpie/server/collection/builder/types.js";
import {
	executeAccessRule,
	mergeFieldAccessRules,
} from "#questpie/server/collection/crud/shared/access-control.js";
import { getColumn } from "#questpie/server/collection/crud/shared/index.js";
import type { Questpie } from "#questpie/server/config/questpie.js";

import { buildAuthorizedCandidateCondition } from "../access-plan.js";
import type { CollectionAccessFilter } from "../types.js";
import { searchDocuments } from "./schema.js";
import type { PassageContext, PassageSource } from "./types.js";

export function passageSource(app: Questpie<any>, source: PassageSource) {
	const collections: Record<
		string,
		Collection<AnyCollectionState>
	> = app.getCollections();
	const collection = collections[source.collection];
	if (
		!collection ||
		!source.tokenFields.length ||
		!source.projectionFields.length
	)
		throw new Error("Invalid passage source");
	const fieldAccess = mergeFieldAccessRules(
		collection.state.access?.fields as Parameters<
			typeof mergeFieldAccessRules
		>[0],
		collection.state.fieldDefinitions,
	);
	for (const name of source.projectionFields) {
		const field = collection.state.fieldDefinitions[name];
		const access = fieldAccess?.[name]?.read;
		if (
			!field ||
			(access !== undefined && access !== true) ||
			field._state.localized
		)
			throw new Error(
				`Passage projection field is not uniformly readable: ${source.collection}.${name}`,
			);
	}
	const columns = source.tokenFields.map((name) => {
		const column = getColumn(collection.table, name);
		if (!column) throw new Error(`Unknown source token field: ${name}`);
		return sql`${column}`;
	});
	const token = sql<string>`md5(jsonb_build_array(${sql.join(columns, sql`, `)})::text)`;
	return { collection, token };
}

export async function passageAuthority(
	app: Questpie<any>,
	sources: PassageSource[],
	context: PassageContext,
	where: Record<string, Record<string, unknown>> = {},
) {
	const filters: CollectionAccessFilter[] = [];
	const tokens = new Map<string, ReturnType<typeof passageSource>["token"]>();
	for (const source of sources) {
		const { collection, token } = passageSource(app, source);
		const accessWhere = await executeAccessRule(
			collection.state.access?.read ?? app.defaultAccess?.read,
			{
				app,
				db: context.db ?? app.db,
				session: context.session,
				principal: context.principal,
				actor: context.actor,
				locale: context.locale,
				request: context.request,
				contextExtensions: context["~contextExtensions"],
			},
		);
		if (accessWhere === false) continue;
		const restrictions = [source.where, where[source.collection]].filter(
			Boolean,
		);
		const restriction = restrictions.length ? { AND: restrictions } : undefined;
		filters.push({
			collection: source.collection,
			table: collection.table,
			state: collection.state,
			accessWhere: restriction
				? accessWhere === true
					? restriction
					: { AND: [accessWhere, restriction] }
				: accessWhere,
			softDelete: collection.state.options?.softDelete ?? false,
			context,
			app,
			db: context.db ?? app.db,
		});
		tokens.set(source.collection, token);
	}
	return buildAuthorizedCandidateCondition(
		filters,
		{
			collection: searchDocuments.collection,
			recordId: searchDocuments.recordId,
		},
		(filter) =>
			sql`${tokens.get(filter.collection)!} = ${searchDocuments.sourceToken}`,
	)!;
}
