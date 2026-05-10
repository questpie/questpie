import { filePathToRoutePattern } from "./file-path-convention.js";
import type {
	HttpMethod,
	RouteDefinition,
	RouteMeta,
	RoutesTree,
} from "./types.js";

export interface IntrospectedRoute {
	key: string;
	path: string;
	pattern: string;
	methods: HttpMethod[];
	mode: RouteDefinition["mode"];
	params: string[];
	meta?: RouteMeta;
	definition: RouteDefinition;
}

const HTTP_METHODS = new Set<HttpMethod>([
	"GET",
	"POST",
	"PUT",
	"DELETE",
	"PATCH",
	"HEAD",
	"OPTIONS",
]);

function isRouteDefinition(value: unknown): value is RouteDefinition {
	return (
		!!value &&
		typeof value === "object" &&
		(value as { __brand?: unknown }).__brand === "route" &&
		typeof (value as { handler?: unknown }).handler === "function"
	);
}

function camelToKebabSegment(segment: string): string {
	return segment.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

function normalizeRouteKey(key: string): string {
	return key
		.split("/")
		.map((segment) =>
			segment.startsWith("[") ? segment : camelToKebabSegment(segment),
		)
		.join("/");
}

function splitRouteKeyAndMethods(
	key: string,
	definition: RouteDefinition,
): { key: string; methods: HttpMethod[] } {
	const colonIndex = key.lastIndexOf(":");
	if (colonIndex > 0) {
		const maybeMethod = key.slice(colonIndex + 1).toUpperCase() as HttpMethod;
		if (HTTP_METHODS.has(maybeMethod)) {
			return {
				key: key.slice(0, colonIndex),
				methods: [maybeMethod],
			};
		}
	}

	return {
		key,
		methods: Array.isArray(definition.method)
			? definition.method
			: [definition.method],
	};
}

function extractParams(pattern: string): string[] {
	const params = new Set<string>();
	for (const part of pattern.split("/")) {
		if (part.startsWith(":")) {
			params.add(part.slice(1));
		} else if (part.startsWith("*")) {
			params.add(part.slice(1));
		}
	}
	return [...params];
}

function visitRoutes(
	routes: RoutesTree,
	prefix: string,
	result: IntrospectedRoute[],
) {
	for (const [rawKey, value] of Object.entries(routes)) {
		if (isRouteDefinition(value)) {
			const { key, methods } = splitRouteKeyAndMethods(rawKey, value);
			const fullKey = prefix ? `${prefix}/${key}` : key;
			const normalizedKey = normalizeRouteKey(fullKey);
			const pattern = filePathToRoutePattern(normalizedKey);
			result.push({
				key: fullKey,
				pattern,
				path: `/${pattern}`,
				methods,
				mode: value.mode,
				params: extractParams(pattern),
				meta: value.meta,
				definition: value,
			});
			continue;
		}

		if (value && typeof value === "object") {
			const fullKey = prefix ? `${prefix}/${rawKey}` : rawKey;
			visitRoutes(value as RoutesTree, fullKey, result);
		}
	}
}

/**
 * Flatten route records into stable route introspection entries.
 */
export function introspectRoutes(
	source:
		| RoutesTree
		| { config?: { routes?: RoutesTree } }
		| { routes?: RoutesTree }
		| undefined,
): IntrospectedRoute[] {
	let routes: RoutesTree | undefined;
	if (!source) {
		routes = undefined;
	} else if (
		typeof source === "object" &&
		"config" in source &&
		(source as { config?: { routes?: RoutesTree } }).config?.routes
	) {
		routes = (source as { config?: { routes?: RoutesTree } }).config?.routes;
	} else if (
		typeof source === "object" &&
		"routes" in source &&
		!isRouteDefinition((source as { routes?: unknown }).routes)
	) {
		routes = (source as { routes?: RoutesTree }).routes;
	} else {
		routes = source as RoutesTree;
	}

	if (!routes) return [];

	const result: IntrospectedRoute[] = [];
	visitRoutes(routes as RoutesTree, "", result);
	return result.sort((a, b) => a.key.localeCompare(b.key));
}
