/**
 * Context Factory
 *
 * Creates a typed `createContext()` function bound to an app instance.
 * Previously emitted as 12 lines of string code in every generated index.ts —
 * now a single importable utility.
 *
 * @see QUE-163 — Codegen Simplification
 */

import type { AppContext } from "#questpie/server/config/app-context.js";
import { extractAppServices } from "#questpie/server/config/app-context.js";

/**
 * Create a `createContext()` function bound to the given app instance.
 *
 * The returned function creates a typed `AppContext` for use in scripts,
 * tests, or standalone code outside of request handlers.
 *
 * @example
 * ```ts
 * // In .generated/index.ts:
 * import { createContextFactory } from "questpie";
 * export const createContext = createContextFactory(app);
 *
 * // In user code:
 * import { createContext } from "#questpie";
 * const ctx = await createContext();
 * const posts = await ctx.collections.posts.find({});
 * ```
 */
export function createContextFactory(
	app: any,
): (options?: { accessMode?: "system" | "user" }) => Promise<AppContext> {
	return async (options) => {
		const reqCtx = await app.createContext({
			accessMode: options?.accessMode ?? "system",
		});
		const services = extractAppServices(app, {
			db: app.db,
			session: reqCtx.session,
		});
		return { ...services, locale: reqCtx.locale } as AppContext;
	};
}
