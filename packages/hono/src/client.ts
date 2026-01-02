import { hc } from "hono/client";
import type { ClientRequestOptions } from "hono/client";
import { createQCMSClient } from "@questpie/cms/client";
import type { QCMS } from "@questpie/cms/server";
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
	 * Base path for CMS routes
	 * @default '/cms'
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
 * Create a unified client that combines QUESTPIE CMS CRUD operations
 * with Hono's native RPC client for custom routes
 *
 * @example
 * ```ts
 * import { createClientFromHono } from '@questpie/hono/client'
 * import type { AppType } from './server'
 * import type { AppCMS } from './cms'
 *
 * const client = createClientFromHono<AppType, AppCMS>({
 *   baseURL: 'http://localhost:3000'
 * })
 *
 * // Use CMS CRUD operations
 * const posts = await client.collections.posts.find({ limit: 10 })
 *
 * // Use Hono RPC for custom routes
 * const result = await client.api.custom.route.$get()
 * ```
 */
export function createClientFromHono<
	TApp extends Hono<any, any, any>,
	TCMS extends QCMS<any>,
>(
	config: HonoClientConfig,
): ReturnType<typeof hc<TApp>> & ReturnType<typeof createQCMSClient<TCMS>> {
	// Create CMS client for CRUD operations
	const cmsClient = createQCMSClient<TCMS>({
		baseURL: config.baseURL,
		fetch: config.fetch,
		basePath: config.basePath,
		headers: config.headers,
	});

	// Create Hono RPC client for custom routes
	const honoClient = hc<TApp>(config.baseURL, {
		fetch: config.fetch,
		headers: config.headers,
		...config.honoOptions,
	});

	// Merge both clients
	(honoClient as typeof honoClient & typeof cmsClient).collections =
		cmsClient.collections;
	(honoClient as typeof honoClient & typeof cmsClient).globals =
		cmsClient.globals;

	return honoClient as typeof honoClient & typeof cmsClient;
}
