import { Elysia } from "elysia";
import {
	createFetchHandler,
	type AdapterConfig,
	type Questpie,
} from "questpie";

import {
	createElysiaCrdtHost,
	type ElysiaCrdtTrustedProxyResolver,
} from "./crdt-host.js";

export {
	createElysiaCrdtHost,
	type ElysiaCrdtHostConfig,
	type ElysiaCrdtTrustedProxyResolver,
} from "./crdt-host.js";

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
export type ElysiaAdapterConfig = Pick<AdapterConfig, "requestLogging"> & {
	/**
	 * Base path for QUESTPIE routes
	 * Use '/' for server-only apps or '/api' for fullstack apps.
	 * @default '/'
	 */
	basePath?: string;
	/**
	 * CRDT endpoints relative to `basePath`.
	 *
	 * The Elysia host implementation is added separately; declaring this
	 * namespace does not replace the existing HTTP realtime transport.
	 */
	crdt?: {
		/** @default "/crdt" */
		path?: `/${string}`;
		resolveTrustedProxyClientIp?: ElysiaCrdtTrustedProxyResolver;
	};
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
		requestLogging: config.requestLogging,
	});

	const server = new Elysia({ prefix: basePath, name: "questpie" });
	if (config.crdt) {
		const application = app.crdtHostApplication;
		if (!application) {
			throw new TypeError(
				"QUESTPIE Elysia CRDT host requires the CRDT session kernel",
			);
		}
		server.use(
			createElysiaCrdtHost({
				path: config.crdt.path,
				application,
				resolveTrustedProxyClientIp: config.crdt.resolveTrustedProxyClientIp,
			}),
		);
	}
	server.all("/*", async ({ request }) => {
		const response = await handler(request);
		return (
			response ??
			new Response(JSON.stringify({ error: "Not found" }), {
				status: 404,
				headers: { "Content-Type": "application/json" },
			})
		);
	});

	return server;
}
