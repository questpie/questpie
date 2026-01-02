import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import {
	createCMSAdapterContext,
	createCMSFetchHandler,
	type CMSAdapterContext,
	type QCMS,
	type RequestContext,
} from "@questpie/cms/server";

/**
 * Variables stored in Hono context
 */
export type QCMSVariables<
	TQCMS extends QCMS<any> = QCMS<any>,
> = {
	cms: TQCMS;
	cmsContext: RequestContext;
	user: any;
};

/**
 * Hono adapter configuration
 */
export type HonoAdapterConfig = {
	/**
	 * Base path for CMS routes
	 * Use '/cms' for server-only apps or '/api/cms' for fullstack apps.
	 * @default '/cms'
	 */
	basePath?: string;
};

export function questpieMiddleware<TQCMS extends QCMS<any>>(
	cms: TQCMS,
) {
	return createMiddleware<{
		Variables: QCMSVariables<TQCMS>;
	}>(async (c, next) => {
		c.set("cms", cms);
		const adapterContext = await createCMSAdapterContext(cms, c.req.raw, {
			accessMode: "user",
		});

		c.set("user", adapterContext.user);
		c.set("cmsContext", adapterContext.cmsContext);

		await next();
	});
}

/**
 * Create Hono app with QUESTPIE CMS integration
 *
 * @example
 * ```ts
 * import { Hono } from 'hono'
 * import { questpieHono } from '@questpie/hono'
 * import { cms } from './cms'
 *
 * const app = new Hono()
 * app.route('/', questpieHono(cms))
 *
 * export default app
 * ```
 *
 * @example
 * ```ts
 * // With custom config
 * app.route('/', questpieHono(cms, {
 *   basePath: '/cms-api',
 *   cors: {
 *     origin: 'https://example.com',
 *     credentials: true
 *   }
 * }))
 * ```
 */
export function questpieHono<TQCMS extends QCMS<any>>(
	cms: TQCMS,
	config: HonoAdapterConfig = {},
) {
	const basePath = config.basePath || "/cms";
	const handler = createCMSFetchHandler(cms, {
		basePath,
		accessMode: "user",
	});

	const resolveContext = (
		context?: QCMSVariables<TQCMS>["cmsContext"],
		user?: any,
	) => {
		if (!context) {
			return undefined;
		}

		return {
			user: user ?? context.user ?? null,
			session: context.session,
			locale: context.locale,
			cmsContext: context,
		} satisfies CMSAdapterContext;
	};

	const app = new Hono<{ Variables: QCMSVariables<TQCMS> }>().all(
		`${basePath}/*`,
		async (c) => {
			const response = await handler(
				c.req.raw,
				resolveContext(c.get("cmsContext"), c.get("user")),
			);
			return response ?? c.notFound();
		},
	);

	return app;
}
