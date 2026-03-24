/**
 * Search reindex route — POST /search/reindex/:collection
 *
 * PROTECTED: Requires authentication and reindex access policy.
 * This is a potentially expensive operation that rebuilds the search index.
 *
 * Access policy: derives from the target collection's `update` access rule.
 * If the adapter config provides `search.reindexAccess`, that takes precedence
 * (handled at the adapter level).
 */
import { z } from "zod";
import { route } from "#questpie/server/routes/define-route.js";
import { executeAccessRule } from "#questpie/server/collection/crud/shared/access-control.js";
import { ApiError } from "#questpie/server/errors/index.js";

export default route()
	.post()
	.schema(z.object({}))
	.access(({ session }: any) => !!session)
	.handler(async (ctx: any) => {
		const app = ctx.app;
		const collectionName = ctx.params?.collection;

		if (!app.search) {
			throw ApiError.notFound("Search", "Search service not configured");
		}

		if (!collectionName) {
			throw ApiError.badRequest("Collection name is required");
		}

		// Check if collection exists
		const collection = app.getCollections()[collectionName];
		if (!collection) {
			throw ApiError.notFound("Collection", collectionName);
		}

		const db = ctx.db ?? app.db;
		const session = ctx.session;
		const locale = ctx.locale;

		// Derive reindex access from collection's update access rule
		const updateAccessRule =
			(collection as any)?.state?.access?.update ?? app.defaultAccess?.update;
		const updateAccessResult = await executeAccessRule(updateAccessRule, {
			app,
			db,
			session,
			locale,
		});

		if (updateAccessResult === false) {
			throw ApiError.forbidden({
				operation: "update",
				resource: `search/reindex/${collectionName}`,
				reason: "Reindex access denied by policy",
			});
		}

		await app.search.reindex(collectionName);
		return { success: true, collection: collectionName };
	});
