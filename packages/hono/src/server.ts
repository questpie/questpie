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

const adapterContexts = new WeakMap<
	Request,
	{ app: unknown; context: AdapterContext }
>();

function cloneAuthorityValue(value: unknown): unknown {
	try {
		return structuredClone(value);
	} catch (cause) {
		throw new TypeError(
			"questpieMiddleware cannot expose a non-cloneable authority context value",
			{ cause },
		);
	}
}

function createNativeContextView(context: RequestContext): RequestContext {
	const extensions = cloneAuthorityValue(context["~contextExtensions"]) as
		| Record<string, unknown>
		| undefined;
	const view: RequestContext = {
		...context,
		session: cloneAuthorityValue(context.session) as RequestContext["session"],
		principal: cloneAuthorityValue(
			context.principal,
		) as RequestContext["principal"],
		actor: cloneAuthorityValue(context.actor) as RequestContext["actor"],
		"~contextExtensions": extensions,
	};
	if (extensions) {
		for (const [key, value] of Object.entries(extensions)) view[key] = value;
	}
	return view;
}

/**
 * Hono adapter configuration
 */
export type HonoAdapterConfig = Pick<
	AdapterConfig,
	| "basePath"
	| "requestLogging"
	| "search"
	| "extendContext"
	| "getLocale"
	| "getSession"
>;

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
		c.set("user", cloneAuthorityValue(adapterContext.session?.user) ?? null);
		c.set("appContext", createNativeContextView(adapterContext.appContext));

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
	}>().use("*", async (c, next) => {
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
		if (response) return response;
		await next();
	});

	return honoApp;
}
