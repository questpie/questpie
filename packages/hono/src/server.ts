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
    cms: TQuestpie;
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
  rpc?: RpcRouterTree<any>;
};

export function questpieMiddleware<TQuestpie extends Questpie<any>>(
  cms: TQuestpie,
) {
  return createMiddleware<{
    Variables: QuestpieVariables<TQuestpie>;
  }>(async (c, next) => {
    c.set("cms", cms);
    const adapterContext = await createAdapterContext(cms, c.req.raw, {
      accessMode: "user",
    });

    c.set("user", adapterContext.session?.user ?? null);
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
export function questpieHono<TQuestpie extends Questpie<any>>(
  cms: TQuestpie,
  config: HonoAdapterConfig = {},
) {
  const basePath = config.basePath || "/cms";
  const handler = createFetchHandler(cms, {
    basePath,
    accessMode: "user",
    rpc: config.rpc,
  });

  const resolveContext = (
    context?: QuestpieVariables<TQuestpie>["cmsContext"],
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
      cmsContext: context,
    } satisfies AdapterContext;
  };

  const app = new Hono<{ Variables: QuestpieVariables<TQuestpie> }>().all(
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
