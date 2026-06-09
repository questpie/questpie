import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import {
	type AdapterContext,
	type AdapterConfig,
	createAdapterContext,
	createFetchHandler,
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

/**
 * Hono adapter configuration
 */
export type HonoAdapterConfig = Pick<AdapterConfig, "requestLogging"> & {
	/**
	 * Base path for QUESTPIE routes
	 * Use '/' for server-only apps or '/api' for fullstack apps.
	 * @default '/'
	 */
	basePath?: string;
};

export function questpieMiddleware<TQuestpie = Questpie<any>>(app: TQuestpie) {
	return createMiddleware<{
		Variables: QuestpieVariables<TQuestpie>;
	}>(async (c, next) => {
		c.set("app", app);
		const adapterContext = await createAdapterContext(
			app as Questpie<any>,
			c.req.raw,
			{ accessMode: "user" },
		);

		c.set("user", adapterContext.session?.user ?? null);
		c.set("appContext", adapterContext.appContext);

		await next();
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
	const basePath = config.basePath || "/";
	const handler = createFetchHandler(app as Questpie<any>, {
		basePath,
		accessMode: "user",
		requestLogging: config.requestLogging,
	});

	const resolveContext = (
		context?: QuestpieVariables<TQuestpie>["appContext"],
		user?: any,
	) => {
		if (!context) {
			return undefined;
		}

		// Build session object - prefer user override, fallback to context's session user
		const sessionUser = user ?? context.session?.user ?? null;
		const session = sessionUser
			? { user: sessionUser, session: context.session?.session ?? null }
			: (context.session ?? null);

		return {
			session,
			locale: context.locale,
			appContext: context,
		} satisfies AdapterContext;
	};

	const honoApp = new Hono<{ Variables: QuestpieVariables<TQuestpie> }>().all(
		`${basePath}/*`,
		async (c) => {
			const response = await handler(
				c.req.raw,
				resolveContext(c.get("appContext"), c.get("user")),
			);
			return response ?? c.notFound();
		},
	);

	return honoApp;
}
