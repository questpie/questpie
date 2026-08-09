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

import { tryGetContext } from "#questpie/server/config/context.js";
import {
	getInternalAdapterContext,
	getInternalHttpBindingConfig,
} from "#questpie/server/config/internal-context.js";
import type { Questpie } from "#questpie/server/config/questpie.js";
import type { QuestpieConfig } from "#questpie/server/config/types.js";

export function routeApp(ctx: object): Questpie<QuestpieConfig> {
	return (ctx as { app: Questpie<QuestpieConfig> }).app;
}

export function routeHttpBindingConfig<T>(): T | undefined {
	return getInternalHttpBindingConfig<T>(
		getInternalAdapterContext(tryGetContext()),
	);
}
