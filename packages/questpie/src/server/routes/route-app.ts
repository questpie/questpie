/**
 * Framework-internal accessor for the app instance on a route handler context.
 *
 * App code gets a fully typed `ctx.app` from the generated `AppContext`
 * augmentation. Framework module routes compile before any codegen exists
 * (their `AppContext` is empty), so they read the app through this cast
 * instead of relying on a type-erasing `app: any` member on the handler args.
 *
 * @internal
 */

import type { Questpie } from "#questpie/server/config/questpie.js";
import type { QuestpieConfig } from "#questpie/server/config/types.js";

export function routeApp(ctx: object): Questpie<QuestpieConfig> {
	return (ctx as { app: Questpie<QuestpieConfig> }).app;
}
