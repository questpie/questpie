/**
 * Auth catch-all route — delegates GET /auth/* to Better Auth.
 */

import { route } from "#questpie/server/routes/define-route.js";

import { handleAuthRoute } from "./_handler.js";

export default route().get().raw().access(true).handler(handleAuthRoute);
