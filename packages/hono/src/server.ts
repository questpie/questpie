import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import {
	type AdapterContext,
	createAdapterContext,
	createFetchHandler,
	type NativeAdapterConfig,
	type Questpie,
	type RequestContext,
} from "questpie";
import { createIsolatedAdapterContextResolver } from "questpie/internal/http-adapter";

/**
 * Variables stored in Hono context
 */
export type QuestpieVariables<TQuestpie = Questpie<any>> = {
	app: TQuestpie;
	appContext: RequestContext;
	user: any;
};

const adapterContexts = new WeakMap<
	Request,
	{ app: unknown; resolveAuthorityContext: () => Promise<AdapterContext> }
>();

/**
 * Hono adapter configuration
 */
export type HonoAdapterConfig = NativeAdapterConfig;

/**
 * @deprecated Prefer `questpieHono(app, config)`. When both APIs are composed,
 * QUESTPIE rebuilds app context once for the private mount authority boundary.
 */
export function questpieMiddleware<TQuestpie = Questpie<any>>(app: TQuestpie) {
	return createMiddleware<{
		Variables: QuestpieVariables<TQuestpie>;
	}>(async (c, next) => {
		c.set("app", app);
		const request = c.req.raw;
		const adapterContext = await createAdapterContext(
			app as Questpie<any>,
			request,
			{ accessMode: "user" },
		);

		adapterContexts.set(request, {
			app,
			resolveAuthorityContext: createIsolatedAdapterContextResolver(
				app as Questpie<any>,
				request,
				adapterContext,
			),
		});
		c.set("user", adapterContext.session?.user ?? null);
		c.set("appContext", adapterContext.appContext);

		try {
			await next();
		} finally {
			adapterContexts.delete(request);
		}
	});
}

/**
 * Create Hono app with QUESTPIE integration
 *
 * @example
 * ```ts
 * import { Hono } from 'hono'
 * import { questpieHono } from '@questpie/hono/server'
 * import { app as questpieApp } from './app'
 *
 * const server = new Hono()
 * server.route('/', questpieHono(questpieApp))
 *
 * export default server
 * ```
 *
 * @example
 * ```ts
 * // With custom config
 * server.route('/', questpieHono(questpieApp, {
 *   basePath: '/api'
 * }))
 * ```
 */
export function questpieHono<TQuestpie = Questpie<any>>(
	app: TQuestpie,
	config: HonoAdapterConfig = {},
) {
	const { basePath = "/", ...handlerConfig } = config;
	const handler = createFetchHandler(app as Questpie<any>, {
		...handlerConfig,
		basePath,
		accessMode: "user",
	});

	const honoApp = new Hono<{
		Variables: QuestpieVariables<TQuestpie>;
	}>()
		.notFound((context) => context.body(null, 404))
		.use("*", async (c, next) => {
			const storedContext = adapterContexts.get(c.req.raw);
			const hasCompatibilityContext = storedContext?.app === app;
			if (
				hasCompatibilityContext &&
				(config.getSession || config.getLocale || config.extendContext)
			) {
				throw new Error(
					"questpieMiddleware cannot be combined with questpieHono context resolvers",
				);
			}
			const adapterContext = hasCompatibilityContext
				? await storedContext.resolveAuthorityContext()
				: undefined;

			const response = await handler(c.req.raw, adapterContext);
			if (response) {
				c.res = response;
				await next();
				c.res = response;
				return response;
			}
			await next();
			return c.res;
		});

	return honoApp;
}
