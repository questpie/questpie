/**
 * OpenAPI spec generation orchestrator.
 */

import type { Questpie, RoutesTree } from "questpie";

import type { OpenApiConfig, OpenApiSpec } from "../types.js";
import { generateAuthPaths } from "./auth.js";
import { generateCollectionPaths } from "./collections.js";
import { generateGlobalPaths } from "./globals.js";
import { generateRoutePaths } from "./routes.js";
import { baseComponentSchemas } from "./schemas.js";
import { generateSearchPaths } from "./search.js";

/**
 * Generate a complete OpenAPI 3.1 spec from a Questpie app instance and optional routes tree.
 *
 * Async-capable: sync sources (collections/globals/routes/search) are merged
 * eagerly, while the auth fragment is `await`ed so a later task can source it
 * from an async provider (e.g. Better Auth's `auth.api.generateOpenAPISchema()`)
 * without changing this signature. For apps whose fragments are all sync
 * (today's case), the resolved spec is byte-identical to the sync output.
 */
export async function generateOpenApiSpec(
	app: Questpie<any>,
	routes?: RoutesTree,
	config: OpenApiConfig = {},
): Promise<OpenApiSpec> {
	const allPaths: OpenApiSpec["paths"] = {};
	const allSchemas: Record<string, unknown> = { ...baseComponentSchemas() };
	const allTags: OpenApiSpec["tags"] = [];

	// Collections
	const collections = generateCollectionPaths(app, config);
	Object.assign(allPaths, collections.paths);
	Object.assign(allSchemas, collections.schemas);
	allTags.push(...collections.tags);

	// Globals
	const globals = generateGlobalPaths(app, config);
	Object.assign(allPaths, globals.paths);
	Object.assign(allSchemas, globals.schemas);
	allTags.push(...globals.tags);

	// Routes
	const routeResult = generateRoutePaths(routes, config);
	Object.assign(allPaths, routeResult.paths);
	Object.assign(allSchemas, routeResult.schemas);
	allTags.push(...routeResult.tags);

	// Auth — awaited so an async auth-schema fragment can be merged here later.
	const auth = await generateAuthPaths(config);
	Object.assign(allPaths, auth.paths);
	allTags.push(...auth.tags);

	// Search
	const search = generateSearchPaths(config);
	Object.assign(allPaths, search.paths);
	allTags.push(...search.tags);

	return {
		openapi: "3.1.0",
		info: {
			title: config.info?.title ?? "QUESTPIE API",
			version: config.info?.version ?? "1.0.0",
			description: config.info?.description,
		},
		servers: config.servers,
		paths: allPaths,
		components: {
			schemas: allSchemas,
			securitySchemes: {
				bearerAuth: {
					type: "http",
					scheme: "bearer",
				},
				cookieAuth: {
					type: "apiKey",
					in: "cookie",
					name: "better-auth.session_token",
				},
			},
		},
		tags: allTags,
		security: [{ bearerAuth: [] }, { cookieAuth: [] }],
	};
}
