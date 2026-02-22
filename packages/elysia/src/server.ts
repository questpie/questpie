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
	app: Questpie<any>;
	appContext: Awaited<ReturnType<Questpie<any>["createContext"]>>;
	user: any;
};

/**
 * Elysia adapter configuration
 */
export type ElysiaAdapterConfig = {
	/**
	 * Base path for QUESTPIE routes
	 * Use '/' for server-only apps or '/api' for fullstack apps.
	 * @default '/'
	 */
	basePath?: string;
	rpc?: RpcRouterTree<any>;
};

/**
 * Create Elysia app with QUESTPIE integration
 *
 * @example
 * ```ts
 * import { Elysia } from 'elysia'
 * import { questpieElysia } from '@questpie/elysia'
 * import { app } from './app'
 *
 * const server = new Elysia()
 *   .use(questpieElysia(app))
 *
 * export default server
 * export type App = typeof server
 * ```
 *
 * @example
 * ```ts
 * // With custom config
 * const server = new Elysia()
 *   .use(questpieElysia(app, {
 *     basePath: '/api',
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
 * const posts = await client.api.posts.get()
 * const post = await client.api.posts({ id: '123' }).get()
 * const newPost = await client.api.posts.post({ title: 'Hello' })
 * ```
 */
export function questpieElysia(
	app: Questpie<any>,
	config: ElysiaAdapterConfig = {},
) {
	const basePath = config.basePath || "/";
	const handler = createFetchHandler(app, {
		basePath,
		accessMode: "user",
		rpc: config.rpc,
	});

	const server = new Elysia({ prefix: basePath, name: "questpie" }).all(
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

	return server;
}
