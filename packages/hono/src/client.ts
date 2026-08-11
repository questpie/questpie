import type { Hono } from "hono";
import type { ClientRequestOptions } from "hono/client";
import { hc } from "hono/client";
import {
	createClient,
	type QuestpieApp,
	type QuestpieClientConfig,
} from "questpie/client";

/**
 * Hono client configuration
 */
export type HonoClientConfig<TApp extends QuestpieApp = QuestpieApp> =
	QuestpieClientConfig<TApp> & {
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
	TApp extends QuestpieApp,
>(
	config: HonoClientConfig<TApp>,
): ReturnType<typeof hc<THono>> & ReturnType<typeof createClient<TApp>> {
	// Create QUESTPIE client for CRUD operations
	const qpClient = createClient<TApp>(config);

	// Create Hono RPC client for custom routes
	const honoClient = hc<THono>(config.baseURL, {
		fetch: config.fetch,
		headers: config.headers,
		...config.honoOptions,
	});

	// Hono's client is itself a Proxy and ignores properties assigned to it.
	// Resolve QUESTPIE surfaces before forwarding all other reads to Hono.
	return new Proxy(honoClient as object, {
		get(target, property, receiver) {
			if (property === "collections") return qpClient.collections;
			if (property === "globals") return qpClient.globals;
			if (property === "routes") return qpClient.routes;
			return Reflect.get(target, property, receiver);
		},
	}) as typeof honoClient & typeof qpClient;
}
