import { Elysia, t } from "elysia";
import { cors } from "@elysiajs/cors";
import type { QCMS } from "@questpie/cms/server";
import qs from "qs";

/**
 * Context stored in Elysia decorator
 */
export type QCMSContext = {
	cms: QCMS<any, any, any>;
	cmsContext: Awaited<ReturnType<QCMS<any, any, any>["createContext"]>>;
	user: any;
};

/**
 * Elysia adapter configuration
 */
export type ElysiaAdapterConfig = {
	/**
	 * CORS configuration
	 * Set to false to disable CORS
	 */
	cors?:
		| false
		| {
				origin?: string | string[] | RegExp | ((origin: string) => boolean);
				credentials?: boolean;
				allowedHeaders?: string | string[];
				exposedHeaders?: string | string[];
				methods?: string | string[];
				maxAge?: number;
		  };

	/**
	 * Base path for CMS routes
	 * @default '/api'
	 */
	basePath?: string;
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
 * const posts = await client.api.cms.posts.get()
 * const post = await client.api.cms.posts({ id: '123' }).get()
 * const newPost = await client.api.cms.posts.post({ title: 'Hello' })
 * ```
 */
export function questpieElysia(
	cms: QCMS<any, any, any>,
	config: ElysiaAdapterConfig = {},
) {
	const basePath = config.basePath || "/api";

	const app = new Elysia({ prefix: basePath, name: "questpie-cms" })
		// Apply CORS if enabled
		.use(
			config.cors !== false
				? cors({
						origin: config.cors?.origin ?? "*",
						credentials: config.cors?.credentials ?? true,
						allowedHeaders: config.cors?.allowedHeaders ?? [
							"Content-Type",
							"Authorization",
							"Accept-Language",
						],
						exposedHeaders: config.cors?.exposedHeaders,
						methods: config.cors?.methods ?? [
							"GET",
							"POST",
							"PATCH",
							"DELETE",
							"OPTIONS",
						],
						maxAge: config.cors?.maxAge,
					})
				: (app: any) => app,
		)
		// Inject CMS instance
		.decorate("cms", cms)
		// Extract user from session
		.derive(async ({ request, cms }) => {
			if (!cms.auth) {
				return { user: null };
			}

			try {
				const session = await cms.auth.api.getSession({
					headers: request.headers,
				});
				return { user: session?.user || null };
			} catch {
				return { user: null };
			}
		})
		// Create CMS context
		.derive(async ({ user, request, cms }) => {
			const locale =
				request.headers.get("accept-language")?.split(",")[0] || "en";

			const cmsContext = await cms.createContext({
				user,
				locale,
				accessMode: "user",
			});

			return { cmsContext };
		})
		// Auth routes
		.all("/auth/*", async ({ request, cms }) => {
			if (!cms.auth) {
				return new Response(JSON.stringify({ error: "Auth not configured" }), {
					status: 500,
					headers: { "Content-Type": "application/json" },
				});
			}
			return cms.auth.handler(request);
		})
		// Storage upload
		.post(
			"/storage/upload",
			async ({ body, cms, cmsContext }) => {
				const file = body.file;

				if (!file || !(file instanceof File)) {
					throw new Error("No file uploaded. Send 'file' in form-data.");
				}

				const key = `${crypto.randomUUID()}-${file.name}`;
				const buffer = await file.arrayBuffer();
				await cms.storage.put(key, new Uint8Array(buffer));

				const url = await cms.storage.getUrl(key);

				const asset = await cms.api.collections[
					"questpie_assets" as any
				].create(
					{
						key,
						url,
						filename: file.name,
						mimeType: file.type,
						size: file.size,
					},
					cmsContext,
				);

				return asset;
			},
			{
				body: t.Object({
					file: t.File(),
				}),
			},
		)
		// Collection CRUD routes
		.get(
			"/cms/:collection",
			async ({ params, query, cms, cmsContext, request }) => {
				const crud = cms.api.collections[params.collection as any];

				if (!crud) {
					throw new Error(`Collection "${params.collection}" not found`);
				}

				// Parse query string with qs for nested objects support
				const url = new URL(request.url);
				const queryString = url.search.slice(1); // Remove leading '?'
				const parsedQuery = qs.parse(queryString, {
					allowDots: true,
					comma: true,
				});

				const options: any = {};
				if (parsedQuery.limit) options.limit = Number(parsedQuery.limit);
				if (parsedQuery.offset) options.offset = Number(parsedQuery.offset);
				if (parsedQuery.where) options.where = parsedQuery.where;
				if (parsedQuery.orderBy) options.orderBy = parsedQuery.orderBy;
				if (parsedQuery.with) options.with = parsedQuery.with;

				return await crud.find(options, cmsContext);
			},
			{
				params: t.Object({
					collection: t.String(),
				}),
			},
		)
		.post(
			"/cms/:collection",
			async ({ params, body, cms, cmsContext }) => {
				const crud = cms.api.collections[params.collection as any];

				if (!crud) {
					throw new Error(`Collection "${params.collection}" not found`);
				}

				return await crud.create(body, cmsContext);
			},
			{
				params: t.Object({
					collection: t.String(),
				}),
				body: t.Any(),
			},
		)
		.get(
			"/cms/:collection/:id",
			async ({ params, query, cms, cmsContext, request }) => {
				const crud = cms.api.collections[params.collection as any];

				if (!crud) {
					throw new Error(`Collection "${params.collection}" not found`);
				}

				// Parse query string with qs
				const url = new URL(request.url);
				const queryString = url.search.slice(1);
				const parsedQuery = qs.parse(queryString, {
					allowDots: true,
					comma: true,
				});

				const options: any = { where: { id: params.id } };
				if (parsedQuery.with) options.with = parsedQuery.with;

				const result = await crud.findOne(options, cmsContext);
				if (!result) {
					throw new Error("Not found");
				}
				return result;
			},
			{
				params: t.Object({
					collection: t.String(),
					id: t.String(),
				}),
			},
		)
		.patch(
			"/cms/:collection/:id",
			async ({ params, body, cms, cmsContext }) => {
				const crud = cms.api.collections[params.collection as any];

				if (!crud) {
					throw new Error(`Collection "${params.collection}" not found`);
				}

				return await crud.updateById({ id: params.id, data: body }, cmsContext);
			},
			{
				params: t.Object({
					collection: t.String(),
					id: t.String(),
				}),
				body: t.Any(),
			},
		)
		.delete(
			"/cms/:collection/:id",
			async ({ params, cms, cmsContext }) => {
				const crud = cms.api.collections[params.collection as any];

				if (!crud) {
					throw new Error(`Collection "${params.collection}" not found`);
				}

				await crud.deleteById({ id: params.id }, cmsContext);
				return { success: true };
			},
			{
				params: t.Object({
					collection: t.String(),
					id: t.String(),
				}),
			},
		)
		// Global CRUD routes
		.get(
			"/cms/globals/:global",
			async ({ params, cms, cmsContext }) => {
				const globalInstance = cms.getGlobalConfig(params.global as any);
				const crud = globalInstance.generateCRUD(cmsContext.db, cms);
				return await crud.get({}, cmsContext);
			},
			{
				params: t.Object({
					global: t.String(),
				}),
			},
		)
		.patch(
			"/cms/globals/:global",
			async ({ params, body, cms, cmsContext }) => {
				const globalInstance = cms.getGlobalConfig(params.global as any);
				const crud = globalInstance.generateCRUD(cmsContext.db, cms);
				return await crud.update(body, cmsContext);
			},
			{
				params: t.Object({
					global: t.String(),
				}),
				body: t.Any(),
			},
		)
		.as("global");

	return app;
}
