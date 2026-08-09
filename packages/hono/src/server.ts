import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import {
	type AdapterContext,
	createAdapterContext,
	createFetchHandler,
	createNativeAdapterContextView,
	type NativeAdapterConfig,
	type Questpie,
	type RequestContext,
} from "questpie";

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
	{ app: unknown; context: AdapterContext }
>();

/**
 * Hono adapter configuration
 */
export type HonoAdapterConfig = NativeAdapterConfig;

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

		adapterContexts.set(request, { app, context: adapterContext });
		const nativeContext = createNativeAdapterContextView(adapterContext);
		c.set("user", nativeContext.session?.user ?? null);
		c.set("appContext", nativeContext);

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
		.notFound((context) => context.res)
		.use("*", async (c, next) => {
			const storedContext = adapterContexts.get(c.req.raw);
			const adapterContext =
				storedContext?.app === app ? storedContext.context : undefined;
			if (
				adapterContext &&
				(config.getSession || config.getLocale || config.extendContext)
			) {
				throw new Error(
					"questpieMiddleware cannot be combined with questpieHono context resolvers",
				);
			}

			const response = await handler(c.req.raw, adapterContext);
			if (response) {
				c.res = response;
				await next();
				return c.res;
			}
			await next();
			return c.res;
		});

	return honoApp;
}
