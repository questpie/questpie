import { Elysia } from "elysia";
import {
  createFetchHandler,
  type Questpie,
  type RpcRouterTree,
} from "questpie";

/**
 * Context stored in Elysia decorator
 */
export type QuestpieContext = {
  cms: Questpie<any>;
  cmsContext: Awaited<ReturnType<Questpie<any>["createContext"]>>;
  user: any;
};

/**
 * Elysia adapter configuration
 */
export type ElysiaAdapterConfig = {
  /**
   * Base path for CMS routes
   * Use '/cms' for server-only apps or '/api/cms' for fullstack apps.
   * @default '/cms'
   */
  basePath?: string;
  rpc?: RpcRouterTree<any>;
};

/**
 * Create Elysia app with QUESTPIE CMS integration
 *
 * @example
 * ```ts
 * import { Elysia } from 'elysia'
 * import { questpieElysia } from '@questpie/elysia'
 * import { cms } from './cms'
 *
 * const app = new Elysia()
 *   .use(questpieElysia(cms))
 *
 * export default app
 * export type App = typeof app
 * ```
 *
 * @example
 * ```ts
 * // With custom config
 * const app = new Elysia()
 *   .use(questpieElysia(cms, {
 *     basePath: '/cms-api',
 *     cors: {
 *       origin: 'https://example.com',
 *       credentials: true
 *     }
 *   }))
 * ```
 *
 * @example
 * ```ts
 * // Client usage with Eden Treaty
 * import { treaty } from '@elysiajs/eden'
 * import type { App } from './server'
 *
 * const client = treaty<App>('localhost:3000')
 *
 * // Fully type-safe!
 * const posts = await client.cms.posts.get()
 * const post = await client.cms.posts({ id: '123' }).get()
 * const newPost = await client.cms.posts.post({ title: 'Hello' })
 * ```
 */
export function questpieElysia(
  cms: Questpie<any>,
  config: ElysiaAdapterConfig = {},
) {
  const basePath = config.basePath || "/cms";
  const handler = createFetchHandler(cms, {
    basePath,
    accessMode: "user",
    rpc: config.rpc,
  });

  const app = new Elysia({ prefix: basePath, name: "questpie-cms" }).all(
    "/*",
    async ({ request }) => {
      const response = await handler(request);
      return (
        response ??
        new Response(JSON.stringify({ error: "Not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        })
      );
    },
  );

  return app;
}
