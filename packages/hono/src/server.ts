import { Hono } from "hono";
import { cors } from "hono/cors";
import type { QCMS } from "@questpie/cms/server";
import qs from "qs";

/**
 * Variables stored in Hono context
 */
export type QCMSVariables = {
	cms: QCMS<any, any, any>;
	cmsContext: Awaited<ReturnType<QCMS<any, any, any>["createContext"]>>;
	user: any;
};
declare module "hono" {
	interface ContextVariableMap {
		cms: QCMS<any, any, any>;
		cmsContext: Awaited<ReturnType<QCMS<any, any, any>["createContext"]>>;
		user: any;
	}
}

/**
 * Hono adapter configuration
 */
export type HonoAdapterConfig = {
	/**
	 * CORS configuration
	 * Set to false to disable CORS
	 */
	cors?:
		| false
		| {
				origin?: string | string[] | ((origin: string) => boolean);
				credentials?: boolean;
				allowMethods?: string[];
				allowHeaders?: string[];
				exposeHeaders?: string[];
		  };

	/**
	 * Base path for CMS routes
	 * @default '/api'
	 */
	basePath?: string;
};

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
export function questpieHono(
	cms: QCMS<any, any, any>,
	config: HonoAdapterConfig = {},
) {
	const basePath = config.basePath || "/api";
	const app = new Hono<{ Variables: QCMSVariables }>()
		.use(
			"*",
			cors({
				origin: config.cors?.origin || "*",
				credentials: config.cors?.credentials ?? true,
				allowMethods: config.cors?.allowMethods || [
					"GET",
					"POST",
					"PATCH",
					"DELETE",
					"OPTIONS",
				],
				allowHeaders: config.cors?.allowHeaders || [
					"Content-Type",
					"Authorization",
					"Accept-Language",
				],
				exposeHeaders: config.cors?.exposeHeaders,
			}),
		)
		.use("*", async (c, next) => {
			c.set("cms", cms);
			await next();
		})
		.use("*", async (c, next) => {
			if (!cms.auth) {
				c.set("user", null);
				await next();
				return;
			}

			try {
				const session = await cms.auth.api.getSession({
					headers: c.req.raw.headers,
				});
				c.set("user", session?.user || null);
			} catch {
				c.set("user", null);
			}

			await next();
		})
		.use("*", async (c, next) => {
			const user = c.get("user");
			const locale = c.req.header("accept-language")?.split(",")[0] || "en";

			const cmsContext = await cms.createContext({
				user,
				locale,
				accessMode: "user",
			});

			c.set("cmsContext", cmsContext);
			await next();
		})
		.all(`${basePath}/auth/*`, async (c) => {
			if (!cms.auth) {
				return c.json({ error: "Auth not configured" }, 500);
			}
			return cms.auth.handler(c.req.raw);
		})
		.post(`${basePath}/storage/upload`, async (c) => {
			const formData = await c.req.formData();
			const file = formData.get("file");

			if (!file || !(file instanceof File)) {
				return c.json(
					{ error: "No file uploaded. Send 'file' in form-data." },
					400,
				);
			}

			const key = `${crypto.randomUUID()}-${file.name}`;
			const buffer = await file.arrayBuffer();
			await cms.storage.put(key, new Uint8Array(buffer));

			const url = await cms.storage.getUrl(key);
			const context = c.get("cmsContext");

			const asset = await cms.api.collections["questpie_assets" as any].create(
				{
					key,
					url,
					filename: file.name,
					mimeType: file.type,
					size: file.size,
					// TODO: Add image processing for width/height
				},
				context,
			);

			return c.json(asset);
		})
		.get(`${basePath}/cms/:collection`, async (c) => {
			const collection = c.req.param("collection");
			const context = c.get("cmsContext");
			const crud = cms.api.collections[collection as any];

			if (!crud) {
				return c.json({ error: `Collection "${collection}" not found` }, 404);
			}

			// Parse query string with qs for nested objects support
			const queryString = c.req.url.split("?")[1] || "";
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

			try {
				const result = await crud.find(options, context);
				return c.json(result);
			} catch (error) {
				return c.json(
					{ error: error instanceof Error ? error.message : "Unknown error" },
					500,
				);
			}
		})
		.post(`${basePath}/cms/:collection`, async (c) => {
			const collection = c.req.param("collection");
			const context = c.get("cmsContext");
			const crud = cms.api.collections[collection as any];

			if (!crud) {
				return c.json({ error: `Collection "${collection}" not found` }, 404);
			}

			const body = await c.req.json();

			try {
				const result = await crud.create(body, context);
				return c.json(result);
			} catch (error) {
				return c.json(
					{ error: error instanceof Error ? error.message : "Unknown error" },
					400,
				);
			}
		})
		.get(`${basePath}/cms/:collection/:id`, async (c) => {
			const collection = c.req.param("collection");
			const id = c.req.param("id");
			const context = c.get("cmsContext");
			const crud = cms.api.collections[collection as any];

			if (!crud) {
				return c.json({ error: `Collection "${collection}" not found` }, 404);
			}

			// Parse query string with qs
			const queryString = c.req.url.split("?")[1] || "";
			const parsedQuery = qs.parse(queryString, {
				allowDots: true,
				comma: true,
			});

			const options: any = { where: { id } };
			if (parsedQuery.with) options.with = parsedQuery.with;

			try {
				const result = await crud.findOne(options, context);
				if (!result) {
					return c.json({ error: "Not found" }, 404);
				}
				return c.json(result);
			} catch (error) {
				return c.json(
					{ error: error instanceof Error ? error.message : "Unknown error" },
					500,
				);
			}
		})
		.patch(`${basePath}/cms/:collection/:id`, async (c) => {
			const collection = c.req.param("collection");
			const id = c.req.param("id");
			const context = c.get("cmsContext");
			const crud = cms.api.collections[collection as any];

			if (!crud) {
				return c.json({ error: `Collection "${collection}" not found` }, 404);
			}

			const body = await c.req.json();

			try {
				const result = await crud.updateById({ id, data: body }, context);
				return c.json(result);
			} catch (error) {
				return c.json(
					{ error: error instanceof Error ? error.message : "Unknown error" },
					400,
				);
			}
		})
		.delete(`${basePath}/cms/:collection/:id`, async (c) => {
			const collection = c.req.param("collection");
			const id = c.req.param("id");
			const context = c.get("cmsContext");
			const crud = cms.api.collections[collection as any];

			if (!crud) {
				return c.json({ error: `Collection "${collection}" not found` }, 404);
			}

			try {
				await crud.deleteById({ id }, context);
				return c.json({ success: true });
			} catch (error) {
				return c.json(
					{ error: error instanceof Error ? error.message : "Unknown error" },
					400,
				);
			}
		})
		.get(`${basePath}/cms/globals/:global`, async (c) => {
			const global = c.req.param("global");
			const context = c.get("cmsContext");

			try {
				const globalInstance = cms.getGlobalConfig(global as any);
				const crud = globalInstance.generateCRUD(context.db, cms);
				const result = await crud.get({}, context);
				return c.json(result);
			} catch (error) {
				return c.json(
					{ error: error instanceof Error ? error.message : "Unknown error" },
					500,
				);
			}
		})
		.patch(`${basePath}/cms/globals/:global`, async (c) => {
			const global = c.req.param("global");
			const context = c.get("cmsContext");
			const body = await c.req.json();

			try {
				const globalInstance = cms.getGlobalConfig(global as any);
				const crud = globalInstance.generateCRUD(context.db, cms);
				const result = await crud.update(body, context);
				return c.json(result);
			} catch (error) {
				return c.json(
					{ error: error instanceof Error ? error.message : "Unknown error" },
					400,
				);
			}
		});

	return app;
}
