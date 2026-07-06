/**
 * OAuth 2.1 Authorization Server metadata (RFC 8414), at the server root.
 *
 * GET /.well-known/oauth-authorization-server
 */

import { route } from "#questpie/server/routes/define-route.js";
import { routeApp } from "#questpie/server/routes/route-app.js";

import { oauthAuthorizationServerMetadata } from "./_metadata.js";

export default route()
	.get()
	.access(true)
	.raw()
	.handler((ctx) =>
		oauthAuthorizationServerMetadata(routeApp(ctx), ctx.request),
	);
