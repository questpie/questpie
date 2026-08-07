/**
 * Cross-collection transaction route — an ordered list of mutations spanning
 * several collections, applied as one server-side transaction.
 *
 * `transaction` joins `health`, `search`, `jwks`, `realtime`, `channels` and
 * `globals` as a literal sibling of `[collection]`. Literal segments beat
 * parameterized ones in the router, so a collection actually named
 * `transaction` would have its root routes shadowed — the same reservation
 * those existing literals already carry.
 *
 * POST /transaction
 */

import { collectionsTransaction } from "#questpie/server/adapters/routes/transaction.js";
import { route } from "#questpie/server/routes/define-route.js";
import { routeApp } from "#questpie/server/routes/route-app.js";

export default route()
	.post()
	.raw()
	.handler(async (ctx) => {
		const { request } = ctx;
		const app = routeApp(ctx);
		return collectionsTransaction(app, request);
	});
