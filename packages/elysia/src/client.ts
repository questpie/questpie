import { treaty } from "@elysiajs/eden";
import type { Treaty } from "@elysiajs/eden";
import { createClient, type QuestpieClient } from "questpie/client";
import type { Questpie } from "questpie";
import type Elysia from "elysia";

/**
 * Elysia client configuration
 */
export type ElysiaClientConfig = {
  /**
   * Server URL (domain with optional port, no protocol needed for Eden)
   * @example 'localhost:3000'
   * @example 'api.example.com'
   */
  server: string;

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
};

/**
 * Create a unified client that combines QUESTPIE CRUD operations
 * with Elysia's native Eden Treaty client for custom routes
 *
 * @example
 * ```ts
 * import { createClientFromEden } from '@questpie/elysia/client'
 * import type { App } from './app'
 *
 * const client = createClientFromEden<App, App>({
 *   server: 'localhost:3000'
 * })
 *
 * // Use CRUD operations
 * const posts = await client.collections.posts.find({ limit: 10 })
 *
 * // Use Eden Treaty for custom routes (fully type-safe!)
 * const result = await client.api.custom.route.get()
 * ```
 */
export function createClientFromEden<
  TApp extends Elysia<any, any, any, any, any, any, any> = any,
  TQP extends Questpie<any> = any,
>(config: ElysiaClientConfig): QuestpieClient<TQP> & Treaty.Create<TApp> {
  // Determine baseURL with protocol for app client
  const baseURL = config.server.startsWith("http")
    ? config.server
    : `http://${config.server}`;

  // Create QuestPie client for CRUD operations
  const qpClient = createClient<TQP>({
    baseURL,
    fetch: config.fetch,
    basePath: config.basePath,
    headers: config.headers,
  });

  // Create Eden Treaty client for custom routes
  const edenClient = treaty<TApp>(config.server, {
    fetcher: config.fetch,
    headers: config.headers,
  });

  // Merge both clients
  return {
    ...edenClient,
    collections: qpClient.collections,
    globals: qpClient.globals,
  } as QuestpieClient<TQP> & Treaty.Create<TApp>;
}
