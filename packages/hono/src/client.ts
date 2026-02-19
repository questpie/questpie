import { hc } from "hono/client";
import type { ClientRequestOptions } from "hono/client";
import { createClient } from "questpie/client";
import type { Questpie } from "questpie";
import type { Hono } from "hono";

/**
 * Hono client configuration
 */
export type HonoClientConfig = {
  /**
   * Base URL of the API
   * @example 'http://localhost:3000'
   */
  baseURL: string;

  /**
   * Custom fetch implementation
   * @default globalThis.fetch
   */
  fetch?: typeof fetch;

  /**
   * Base path for routes
   * @default '/'
   */
  basePath?: string;

  /**
   * Default headers to include in all requests
   */
  headers?: Record<string, string>;

  /**
   * Hono client options
   */
  honoOptions?: ClientRequestOptions;
};

/**
 * Create a unified client that combines QUESTPIE CRUD operations
 * with Hono's native RPC client for custom routes
 *
 * @example
 * ```ts
 * import { createClientFromHono } from '@questpie/hono/client'
 * import type { AppType } from './server'
 * import type { App } from './app'
 *
 * const client = createClientFromHono<AppType, App>({
 *   baseURL: 'http://localhost:3000'
 * })
 *
 * // Use CRUD operations
 * const posts = await client.collections.posts.find({ limit: 10 })
 *
 * // Use Hono RPC for custom routes
 * const result = await client.api.custom.route.$get()
 * ```
 */
export function createClientFromHono<
  THono extends Hono<any, any, any>,
  TApp extends Questpie<any>,
>(
  config: HonoClientConfig,
): ReturnType<typeof hc<THono>> & ReturnType<typeof createClient<TApp>> {
  // Create QuestPie client for CRUD operations
  const qpClient = createClient<TApp>({
    baseURL: config.baseURL,
    fetch: config.fetch,
    basePath: config.basePath,
    headers: config.headers,
  });

  // Create Hono RPC client for custom routes
  const honoClient = hc<THono>(config.baseURL, {
    fetch: config.fetch,
    headers: config.headers,
    ...config.honoOptions,
  });

  // Merge both clients
  (honoClient as typeof honoClient & typeof qpClient).collections =
    qpClient.collections;
  (honoClient as typeof honoClient & typeof qpClient).globals =
    qpClient.globals;

  return honoClient as typeof honoClient & typeof qpClient;
}
