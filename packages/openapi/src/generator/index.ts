/**
 * OpenAPI spec generation orchestrator.
 */

import type { Questpie, RpcRouterTree } from "questpie";
import type { OpenApiConfig, OpenApiSpec } from "../types.js";
import { generateAuthPaths } from "./auth.js";
import { generateCollectionPaths } from "./collections.js";
import { generateGlobalPaths } from "./globals.js";
import { generateRpcPaths } from "./rpc.js";
import { baseComponentSchemas } from "./schemas.js";
import { generateSearchPaths } from "./search.js";

/**
 * Generate a complete OpenAPI 3.1 spec from a Questpie app instance and optional RPC router.
 */
export function generateOpenApiSpec(
	app: Questpie<any>,
	rpc?: RpcRouterTree<any>,
	config: OpenApiConfig = {},
): OpenApiSpec {
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

	// RPC
	const rpcResult = generateRpcPaths(rpc, config);
	Object.assign(allPaths, rpcResult.paths);
	Object.assign(allSchemas, rpcResult.schemas);
	allTags.push(...rpcResult.tags);

	// Auth
	const auth = generateAuthPaths(config);
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
