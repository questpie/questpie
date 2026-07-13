/**
 * JSON Web Key Set for OAuth access-token verification, at the server root.
 * Re-exposes the `jwt()` plugin's JWKS (served under the auth basePath).
 *
 * GET /jwks
 */

import { route } from "#questpie/server/routes/define-route.js";
import { routeApp } from "#questpie/server/routes/route-app.js";

import { jwks } from "./.well-known/_metadata.js";

export default route()
	.get()
	.access(true)
	.raw()
	.handler((ctx) => jwks(routeApp(ctx), ctx.request));
