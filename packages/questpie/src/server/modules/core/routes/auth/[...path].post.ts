/**
 * Auth catch-all route — delegates POST /auth/* to Better Auth.
 */

import { route } from "#questpie/server/routes/define-route.js";

import { handleAuthRoute } from "./_handler.js";

export default route().post().raw().access(true).handler(handleAuthRoute);
