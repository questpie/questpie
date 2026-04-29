/**
 * Routes tree -> OpenAPI paths generator.
 */

import type { RoutesTree } from "questpie";

import type { OpenApiConfig, PathOperation } from "../types.js";
import { jsonRequestBody, jsonResponse, zodToJsonSchema } from "./schemas.js";

/**
 * Convert camelCase to kebab-case, matching the HTTP adapter's URL generation.
 * e.g. "createBooking" → "create-booking"
 */
function camelToKebab(str: string): string {
	return str.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

interface FlatRouteEntry {
	path: string;
	segments: string[];
	definition: any;
}

/**
 * Flatten a routes tree into a list of { path, definition }.
 */
function flattenRoutesTree(
	tree: RoutesTree,
	prefix: string[] = [],
): FlatRouteEntry[] {
	const entries: FlatRouteEntry[] = [];

	for (const [key, value] of Object.entries(tree)) {
		const segments = [...prefix, key];
		if (
			value &&
			typeof value === "object" &&
			"handler" in value &&
			typeof (value as any).handler === "function"
		) {
			entries.push({
				path: segments.join("/"),
				segments,
				definition: value,
			});
		} else if (value && typeof value === "object") {
			entries.push(...flattenRoutesTree(value as RoutesTree, segments));
		}
	}

	return entries;
}

/**
 * Generate OpenAPI paths for all routes in the routes tree.
 */
export function generateRoutePaths(
	routes: RoutesTree | undefined,
	config: OpenApiConfig,
): {
	paths: Record<string, Record<string, PathOperation>>;
	schemas: Record<string, unknown>;
	tags: Array<{ name: string; description?: string }>;
} {
	const paths: Record<string, Record<string, PathOperation>> = {};
	const schemas: Record<string, unknown> = {};
	const tags: Array<{ name: string; description?: string }> = [];

	if (!routes) return { paths, schemas, tags };

	const basePath = config.basePath ?? "/";
	const entries = flattenRoutesTree(routes);

	// Group by top-level key for tags
	const tagSet = new Set<string>();

	for (const entry of entries) {
		const def = entry.definition;
		const isRaw = def.mode === "raw";
		const method: string = (def.method ?? "post").toLowerCase();
		const topLevel = entry.segments[0] ?? "routes";

		if (!tagSet.has(topLevel)) {
			tagSet.add(topLevel);
			tags.push({
				name: `Routes: ${topLevel}`,
				description: `Routes under ${topLevel}`,
			});
		}

		const operationId = `route_${entry.segments.join("_")}`;
		const routePath = `${basePath}/${entry.segments.map(camelToKebab).join("/")}`;

		const operation: PathOperation = {
			operationId,
			summary: entry.path,
			tags: [`Routes: ${topLevel}`],
			responses: {},
		};

		if (isRaw) {
			// Raw routes take a raw request and return a raw response
			operation.description =
				"Raw route - accepts any request body and returns a raw response.";
			operation.requestBody = {
				content: {
					"application/json": { schema: {} },
					"application/octet-stream": {
						schema: { type: "string", format: "binary" },
					},
				},
			};
			operation.responses = {
				"200": { description: "Raw response" },
				"401": {
					description: "Unauthorized",
					content: {
						"application/json": {
							schema: { $ref: "#/components/schemas/ErrorResponse" },
						},
					},
				},
			};
		} else {
			// JSON routes - extract input/output schemas
			let inputSchema: unknown = {};
			let outputSchema: unknown = { type: "object" };

			if (def.schema) {
				const schemaName = `${operationId}_Input`;
				const converted = zodToJsonSchema(def.schema);
				schemas[schemaName] = converted;
				inputSchema = { $ref: `#/components/schemas/${schemaName}` };
			}

			if (def.outputSchema) {
				const schemaName = `${operationId}_Output`;
				const converted = zodToJsonSchema(def.outputSchema);
				schemas[schemaName] = converted;
				outputSchema = { $ref: `#/components/schemas/${schemaName}` };
			}

			operation.requestBody = jsonRequestBody(inputSchema, "Route input");
			operation.responses = jsonResponse(outputSchema, "Route output");
		}

		paths[routePath] = { [method]: operation };
	}

	return { paths, schemas, tags };
}
