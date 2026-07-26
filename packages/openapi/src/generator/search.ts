/**
 * Search routes -> OpenAPI paths generator.
 */

import type { OpenApiConfig, PathOperation } from "../types.js";
import { jsonRequestBody, jsonResponse, ref } from "./schemas.js";

/**
 * Generate OpenAPI paths for search endpoints.
 */
export function generateSearchPaths(config: OpenApiConfig): {
	paths: Record<string, Record<string, PathOperation>>;
	tags: Array<{ name: string; description?: string }>;
} {
	if (config.search === false) {
		return { paths: {}, tags: [] };
	}

	const basePath = config.basePath ?? "/";
	const tag = "Search";
	const paths: Record<string, Record<string, PathOperation>> = {};

	// POST /search
	paths[`${basePath}/search`] = {
		post: {
			operationId: "search",
			summary: "Search across collections",
			tags: [tag],
			requestBody: jsonRequestBody({
				type: "object",
				properties: {
					query: { type: "string", description: "Search query" },
					collections: {
						type: "array",
						items: { type: "string" },
						description: "Collections to search (omit for all)",
					},
					limit: { type: "integer", default: 10 },
					offset: { type: "integer", default: 0 },
				},
				required: ["query"],
			}),
			responses: jsonResponse(
				{
					type: "object",
					properties: {
						docs: {
							type: "array",
							items: {
								type: "object",
								additionalProperties: true,
								properties: {
									_collection: { type: "string" },
									_search: {
										type: "object",
										properties: {
											score: { type: "number" },
										},
										required: ["score"],
									},
								},
								required: ["_collection", "_search"],
							},
						},
						total: { type: "integer" },
						facets: { type: "array", items: { type: "object" } },
					},
					required: ["docs", "total"],
				},
				"Search results",
			),
		},
	};

	// POST /search/reindex/{collection}
	paths[`${basePath}/search/reindex/{collection}`] = {
		post: {
			operationId: "search_reindex",
			summary: "Reindex a collection",
			description: "Requires admin authentication.",
			tags: [tag],
			parameters: [
				{
					name: "collection",
					in: "path",
					required: true,
					schema: { type: "string" },
					description: "Collection name to reindex",
				},
			],
			responses: jsonResponse(
				{
					type: "object",
					properties: {
						success: { type: "boolean" },
						collection: { type: "string" },
					},
				},
				"Reindex started",
			),
		},
	};

	return {
		paths,
		tags: [{ name: tag, description: "Full-text search endpoints" }],
	};
}
