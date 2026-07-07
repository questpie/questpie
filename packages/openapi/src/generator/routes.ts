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

/**
 * Convert a route key segment to its URL pattern segment, matching the HTTP
 * adapter (adapters/http.ts:56-64): `[param]` / `[...slug]` pass through
 * untouched, literal segments are kebab-cased.
 */
function routeKeySegmentToPatternSegment(segment: string): string {
	if (segment.startsWith("[") && segment.endsWith("]")) {
		return segment;
	}
	return camelToKebab(segment);
}

/**
 * Convert a file-convention pattern segment to an OpenAPI path-template
 * segment: `[...slug]` → `{slug}`, `[param]` → `{param}`, literal → as-is.
 */
function patternSegmentToOpenApi(segment: string): {
	out: string;
	param?: string;
} {
	if (segment.startsWith("[...") && segment.endsWith("]")) {
		const name = segment.slice(4, -1);
		return { out: `{${name}}`, param: name };
	}
	if (segment.startsWith("[") && segment.endsWith("]")) {
		const name = segment.slice(1, -1);
		return { out: `{${name}}`, param: name };
	}
	return { out: segment };
}

/**
 * Whether a route's `access` declaration marks it explicitly public.
 *
 * Mirrors the runtime's `extractAccessRule` (routes/execute.ts): `access` is
 * either a rule (`boolean | fn`) or `{ execute?: rule }`. A route is public iff
 * the resolved execute rule is exactly the boolean `true` — i.e. `access(true)`
 * or `access({ execute: true })`. A function rule, `false`, or no `access`
 * declaration is NOT treated as public here (it inherits the global scheme).
 */
function isExplicitlyPublicRouteAccess(access: unknown): boolean {
	const rule =
		access !== null && typeof access === "object" && "execute" in access
			? (access as { execute?: unknown }).execute
			: access;
	return rule === true;
}

interface FlatRouteEntry {
	/** URL path pattern with file-convention brackets (e.g. "user/[id]"). */
	path: string;
	segments: string[];
	/** HTTP methods this route serves (lower-cased downstream). */
	methods: string[];
	definition: any;
}

/**
 * Flatten a routes tree into a list of route entries.
 *
 * Mirrors the HTTP adapter's key parsing (adapters/http.ts:82-89) and the
 * route introspection (routes/introspection.ts:52-72) — the single source of
 * truth for how a route key maps to a path + HTTP methods:
 *   1. a trailing `:METHOD` suffix on the key sets the method, path is the prefix;
 *   2. otherwise the route definition's method is used.
 */
function flattenRoutesTree(
	tree: RoutesTree,
	prefix: string[] = [],
): FlatRouteEntry[] {
	const entries: FlatRouteEntry[] = [];

	for (const [key, value] of Object.entries(tree)) {
		if (
			value &&
			typeof value === "object" &&
			"handler" in value &&
			typeof (value as any).handler === "function"
		) {
			const def = value as any;

			// Split a trailing `:METHOD` key suffix from the path (mirrors http.ts).
			let keyPath = key;
			let methods: string[];
			const colonIdx = key.lastIndexOf(":");
			if (colonIdx > 0) {
				keyPath = key.slice(0, colonIdx);
				methods = [key.slice(colonIdx + 1).toUpperCase()];
			} else {
				methods = Array.isArray(def.method)
					? def.method
					: [def.method ?? "post"];
			}

			const segments = [...prefix, ...keyPath.split("/")];
			entries.push({
				path: segments.join("/"),
				segments,
				methods,
				definition: def,
			});
		} else if (value && typeof value === "object") {
			entries.push(...flattenRoutesTree(value as RoutesTree, [...prefix, key]));
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
	const pathMethodCounts = new Map<string, number>();
	for (const entry of entries) {
		const patternSegments = entry.segments.map((segment) => {
			const { out } = patternSegmentToOpenApi(
				routeKeySegmentToPatternSegment(segment),
			);
			return out;
		});
		const routePath = `${basePath}/${patternSegments.join("/")}`;
		pathMethodCounts.set(
			routePath,
			(pathMethodCounts.get(routePath) ?? 0) + entry.methods.length,
		);
	}

	// Group by top-level key for tags
	const tagSet = new Set<string>();

	for (const entry of entries) {
		const def = entry.definition;
		const isRaw = def.mode === "raw";

		// Build the OpenAPI path template + path params from the pattern segments.
		// Literal segments are kebab-cased to match the served URLs (http.ts),
		// `[param]` / `[...slug]` become `{param}` / `{slug}` templates.
		const pathParams: string[] = [];
		const patternSegments = entry.segments.map((segment) => {
			const { out, param } = patternSegmentToOpenApi(
				routeKeySegmentToPatternSegment(segment),
			);
			if (param) pathParams.push(param);
			return out;
		});
		const routePath = `${basePath}/${patternSegments.join("/")}`;

		const topLevel = patternSegments[0] ?? "routes";

		// Serializable route metadata (`.meta({ title, description, tags })`),
		// the single seam shared with route introspection + MCP.
		const meta = (def.meta ?? undefined) as
			| {
					title?: string;
					description?: string;
					tags?: string[];
			  }
			| undefined;

		// Operation tags: prefer explicit `meta.tags`, else the default
		// `Routes: <topLevel>` bucket. Register whichever set is used at the
		// spec level so there are no orphan tags.
		const metaTags =
			Array.isArray(meta?.tags) && meta.tags.length > 0
				? meta.tags
				: undefined;
		const operationTags = metaTags ?? [`Routes: ${topLevel}`];

		if (metaTags) {
			for (const tag of metaTags) {
				if (!tagSet.has(tag)) {
					tagSet.add(tag);
					tags.push({ name: tag });
				}
			}
		} else if (!tagSet.has(`Routes: ${topLevel}`)) {
			tagSet.add(`Routes: ${topLevel}`);
			tags.push({
				name: `Routes: ${topLevel}`,
				description: `Routes under ${topLevel}`,
			});
		}

		const baseOperationId = `route_${entry.segments.join("_")}`;
		// Method-suffixed sibling routes can share one path; suffix the
		// operationId with the method so each operation stays unique.
		const multiMethod = (pathMethodCounts.get(routePath) ?? 0) > 1;
		const schemaOperationId =
			multiMethod && entry.methods.length === 1
				? `${baseOperationId}_${entry.methods[0].toLowerCase()}`
				: baseOperationId;

		const parameters = pathParams.map((name) => ({
			name,
			in: "path",
			required: true,
			schema: { type: "string" },
		}));

		// Explicitly public routes (`access(true)`) opt out of the spec-level
		// security scheme via an empty `security: []`; gated routes (function
		// rule or no access) inherit the global scheme by emitting nothing.
		const isPublic = isExplicitlyPublicRouteAccess(def.access);

		const operation: PathOperation = {
			operationId: baseOperationId,
			// `meta.title` -> summary, falling back to the URL path string.
			summary: meta?.title ?? entry.path,
			tags: operationTags,
			...(meta?.description ? { description: meta.description } : {}),
			...(parameters.length > 0 ? { parameters } : {}),
			...(isPublic ? { security: [] } : {}),
			responses: {},
		};

		if (isRaw) {
			// Raw routes take a raw request and return a raw response. Keep the
			// default blurb only when `meta.description` did not already set one.
			if (!operation.description) {
				operation.description =
					"Raw route - accepts any request body and returns a raw response.";
			}
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
				const schemaName = `${schemaOperationId}_Input`;
				const converted = zodToJsonSchema(def.schema);
				schemas[schemaName] = converted;
				inputSchema = { $ref: `#/components/schemas/${schemaName}` };
			}

			if (def.outputSchema) {
				const schemaName = `${schemaOperationId}_Output`;
				const converted = zodToJsonSchema(def.outputSchema);
				schemas[schemaName] = converted;
				outputSchema = { $ref: `#/components/schemas/${schemaName}` };
			}

			operation.requestBody = jsonRequestBody(inputSchema, "Route input");
			operation.responses = jsonResponse(outputSchema, "Route output");
		}

		// Emit one operation per method onto the SAME path object so method
		// siblings are not clobbered.
		const pathItem = (paths[routePath] ??= {});
		for (const method of entry.methods) {
			pathItem[method.toLowerCase()] = multiMethod
				? {
						...operation,
						operationId: `${baseOperationId}_${method.toLowerCase()}`,
					}
				: operation;
		}
	}

	return { paths, schemas, tags };
}
