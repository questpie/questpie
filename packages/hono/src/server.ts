import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import {
	type AdapterContext,
	createAdapterContext,
	createFetchHandler,
	type Questpie,
	type RequestContext,
	type RpcRouterTree,
} from "questpie";

/**
 * Variables stored in Hono context
 */
export type QuestpieVariables<TQuestpie extends Questpie<any> = Questpie<any>> =
	{
		app: TQuestpie;
		appContext: RequestContext;
		user: any;
	};

/**
 * Hono adapter configuration
 */
export type HonoAdapterConfig = {
	/**
	 * Base path for QUESTPIE routes
	 * Use '/' for server-only apps or '/api' for fullstack apps.
	 * @default '/'
	 */
	basePath?: string;
	rpc?: RpcRouterTree<any>;
};

export function questpieMiddleware<TQuestpie extends Questpie<any>>(
	app: TQuestpie,
) {
	return createMiddleware<{
		Variables: QuestpieVariables<TQuestpie>;
	}>(async (c, next) => {
		c.set("app", app);
		const adapterContext = await createAdapterContext(app, c.req.raw, {
			accessMode: "user",
		});

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
 * import { questpieHono } from '@questpie/hono'
 * import { app } from './app'
 *
 * const server = new Hono()
 * server.route('/', questpieHono(app))
 *
 * export default server
 * ```
 *
 * @example
 * ```ts
 * // With custom config
 * server.route('/', questpieHono(app, {
 *   basePath: '/api',
 *   cors: {
 *     origin: 'https://example.com',
 *     credentials: true
 *   }
 * }))
 * ```
 */
export function questpieHono<TQuestpie extends Questpie<any>>(
	app: TQuestpie,
	config: HonoAdapterConfig = {},
) {
	const basePath = config.basePath || "/";
	const handler = createFetchHandler(app, {
		basePath,
		accessMode: "user",
		rpc: config.rpc,
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
