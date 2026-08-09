import { Elysia } from "elysia";
import {
	createFetchHandler,
	type AdapterConfig,
	type Questpie,
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
export type ElysiaAdapterConfig = Pick<
	AdapterConfig,
	| "basePath"
	| "requestLogging"
	| "search"
	| "extendContext"
	| "getLocale"
	| "getSession"
>;

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
 *     getLocale: (request) => request.headers.get('x-locale') ?? 'en'
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
	const configuredBasePath = config.basePath ?? "/";
	const prefixedBasePath = configuredBasePath.startsWith("/")
		? configuredBasePath
		: `/${configuredBasePath}`;
	const basePath =
		prefixedBasePath.length > 1 && prefixedBasePath.endsWith("/")
			? prefixedBasePath.slice(0, -1)
			: prefixedBasePath;
	const handler = createFetchHandler(app, {
		...config,
		basePath,
		accessMode: "user",
	});

	const handle = async ({ request }: { request: Request }) => {
		const response = await handler(request);
		return response ?? new Response("Not found", { status: 404 });
	};
	const server = new Elysia({ name: "questpie" });
	server.all(basePath, handle);
	if (basePath !== "/") server.all(`${basePath}/*`, handle);
	else server.all("/*", handle);

	return server;
}
