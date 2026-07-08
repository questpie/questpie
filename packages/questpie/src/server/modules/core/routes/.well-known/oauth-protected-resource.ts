/**
 * OAuth 2.1 Protected Resource metadata (RFC 9728), at the server root.
 * Points MCP clients at this app's authorization server.
 *
 * GET /.well-known/oauth-protected-resource
 */

import { route } from "#questpie/server/routes/define-route.js";
import { routeApp } from "#questpie/server/routes/route-app.js";

import { oauthProtectedResourceMetadata } from "./_metadata.js";

export default route()
	.get()
	.access(true)
	.raw()
	.handler((ctx) => oauthProtectedResourceMetadata(routeApp(ctx), ctx.request));
