/**
 * Auth routes -> OpenAPI paths generator.
 *
 * When the Better Auth instance has the official `openAPI()` plugin configured,
 * the full auth OpenAPI document (all core + configured-plugin endpoints, with
 * real request/response schemas) is derived from
 * `app.auth.api.generateOpenAPISchema()`. Otherwise a minimal hardcoded set of
 * the four most common endpoints is used as a fallback so spec generation never
 * crashes and always documents the basics.
 */

import type { Questpie } from "questpie";

import type { OpenApiConfig, PathOperation } from "../types.js";
import { jsonRequestBody, jsonResponse } from "./schemas.js";

const AUTH_TAG = "Auth";

/** Prefix applied to Better Auth component schema names to avoid colliding with QUESTPIE schemas. */
const AUTH_SCHEMA_PREFIX = "Auth";

/**
 * Generate OpenAPI paths for Better Auth endpoints.
 *
 * Async so the schema can be derived from Better Auth's async
 * `auth.api.generateOpenAPISchema()` provider when the `openAPI()` plugin is
 * configured. Falls back to a hardcoded minimal set when the app/plugin/method
 * is unavailable or the call throws.
 */
export async function generateAuthPaths(
	config: OpenApiConfig,
	app?: Questpie<any>,
): Promise<{
	paths: Record<string, Record<string, PathOperation>>;
	schemas: Record<string, unknown>;
	securitySchemes: Record<string, unknown>;
	tags: Array<{ name: string; description?: string }>;
}> {
	if (config.auth === false) {
		return { paths: {}, schemas: {}, securitySchemes: {}, tags: [] };
	}

	// The `openAPI()` better-auth plugin exposes `generateOpenAPISchema` on
	// `auth.api`. The generator operates over `Questpie<any>`, so the plugin's
	// endpoints aren't known at the type level — read the method defensively.
	const authApi = app?.auth?.api as
		| { generateOpenAPISchema?: () => Promise<unknown> }
		| undefined;
	const generate = authApi?.generateOpenAPISchema;
	if (typeof generate === "function") {
		try {
			const doc = await generate.call(authApi);
			const derived = mapBetterAuthDoc(doc, config);
			if (derived) return derived;
		} catch {
			// Fall through to the hardcoded minimal set below.
		}
	}

	return fallbackAuthPaths(config);
}

/**
 * Map a Better Auth OpenAPI document (from the `openAPI()` plugin) into the
 * QUESTPIE spec shape: prefix every path with `<basePath>/auth`, namespace the
 * component schemas + their `$ref`s to avoid collisions, retag operations under
 * the `Auth` tag, and surface the auth security schemes for merging.
 */
function mapBetterAuthDoc(
	doc: unknown,
	config: OpenApiConfig,
):
	| {
			paths: Record<string, Record<string, PathOperation>>;
			schemas: Record<string, unknown>;
			securitySchemes: Record<string, unknown>;
			tags: Array<{ name: string; description?: string }>;
	  }
	| undefined {
	if (!doc || typeof doc !== "object") return undefined;
	const source = doc as {
		paths?: Record<string, Record<string, PathOperation>>;
		components?: {
			schemas?: Record<string, unknown>;
			securitySchemes?: Record<string, unknown>;
		};
	};
	if (!source.paths || typeof source.paths !== "object") return undefined;

	const basePath = config.basePath ?? "/";
	const authPrefix = `${basePath}/auth`;

	// Namespace schema names so QUESTPIE collection/route schemas never collide
	// with Better Auth's (User, Session, Account, ...). We rename the schema keys
	// and rewrite every `$ref` in both the schemas and the operations.
	const sourceSchemas = source.components?.schemas ?? {};
	const renameMap: Record<string, string> = {};
	for (const name of Object.keys(sourceSchemas)) {
		renameMap[name] = `${AUTH_SCHEMA_PREFIX}${name}`;
	}
	const rewriteRefs = (value: unknown): unknown =>
		remapSchemaRefs(value, renameMap);

	const schemas: Record<string, unknown> = {};
	for (const [name, schema] of Object.entries(sourceSchemas)) {
		schemas[renameMap[name] ?? name] = rewriteRefs(schema);
	}

	const paths: Record<string, Record<string, PathOperation>> = {};
	for (const [path, operations] of Object.entries(source.paths)) {
		if (!operations || typeof operations !== "object") continue;
		const prefixedPath = `${authPrefix}${path}`;
		const mappedOps: Record<string, PathOperation> = {};
		for (const [method, operation] of Object.entries(operations)) {
			if (!operation || typeof operation !== "object") continue;
			const op = rewriteRefs(operation) as PathOperation;
			// Retag under a single, meaningful "Auth" tag (Better Auth emits
			// generic "Default"/plugin tags that read poorly in the merged spec).
			op.tags = [AUTH_TAG];
			mappedOps[method] = op;
		}
		paths[prefixedPath] = mappedOps;
	}

	return {
		paths,
		schemas,
		securitySchemes: source.components?.securitySchemes ?? {},
		tags: [
			{ name: AUTH_TAG, description: "Authentication endpoints (Better Auth)" },
		],
	};
}

/**
 * Recursively rewrite `#/components/schemas/<Name>` `$ref`s according to the
 * rename map so namespaced schemas resolve.
 */
function remapSchemaRefs(
	value: unknown,
	renameMap: Record<string, string>,
): unknown {
	if (Array.isArray(value)) {
		return value.map((item) => remapSchemaRefs(item, renameMap));
	}
	if (value && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [key, val] of Object.entries(value)) {
			if (
				key === "$ref" &&
				typeof val === "string" &&
				val.startsWith("#/components/schemas/")
			) {
				const original = val.slice("#/components/schemas/".length);
				out[key] = `#/components/schemas/${renameMap[original] ?? original}`;
			} else {
				out[key] = remapSchemaRefs(val, renameMap);
			}
		}
		return out;
	}
	return value;
}

/**
 * Minimal hardcoded fallback for the four most common Better Auth endpoints.
 * Used when the `openAPI()` plugin is not configured (or its schema generation
 * throws) so the spec still documents the basics without crashing.
 */
function fallbackAuthPaths(config: OpenApiConfig): {
	paths: Record<string, Record<string, PathOperation>>;
	schemas: Record<string, unknown>;
	securitySchemes: Record<string, unknown>;
	tags: Array<{ name: string; description?: string }>;
} {
	const basePath = config.basePath ?? "/";
	const tag = AUTH_TAG;
	const paths: Record<string, Record<string, PathOperation>> = {};

	// POST /auth/sign-in/email
	paths[`${basePath}/auth/sign-in/email`] = {
		post: {
			operationId: "auth_signInEmail",
			summary: "Sign in with email and password",
			tags: [tag],
			requestBody: jsonRequestBody({
				type: "object",
				properties: {
					email: { type: "string", format: "email" },
					password: { type: "string" },
				},
				required: ["email", "password"],
			}),
			responses: jsonResponse(
				{
					type: "object",
					properties: {
						user: { type: "object" },
						session: { type: "object" },
					},
				},
				"Authentication successful",
			),
		},
	};

	// POST /auth/sign-up/email
	paths[`${basePath}/auth/sign-up/email`] = {
		post: {
			operationId: "auth_signUpEmail",
			summary: "Sign up with email and password",
			tags: [tag],
			requestBody: jsonRequestBody({
				type: "object",
				properties: {
					email: { type: "string", format: "email" },
					password: { type: "string" },
					name: { type: "string" },
				},
				required: ["email", "password", "name"],
			}),
			responses: jsonResponse(
				{
					type: "object",
					properties: {
						user: { type: "object" },
						session: { type: "object" },
					},
				},
				"Registration successful",
			),
		},
	};

	// GET /auth/get-session
	paths[`${basePath}/auth/get-session`] = {
		get: {
			operationId: "auth_getSession",
			summary: "Get current session",
			tags: [tag],
			responses: jsonResponse(
				{
					type: "object",
					properties: {
						user: { type: "object" },
						session: { type: "object" },
					},
				},
				"Current session",
			),
		},
	};

	// POST /auth/sign-out
	paths[`${basePath}/auth/sign-out`] = {
		post: {
			operationId: "auth_signOut",
			summary: "Sign out",
			tags: [tag],
			responses: jsonResponse(
				{ type: "object", properties: { success: { type: "boolean" } } },
				"Signed out",
			),
		},
	};

	return {
		paths,
		schemas: {},
		securitySchemes: {},
		tags: [
			{ name: tag, description: "Authentication endpoints (Better Auth)" },
		],
	};
}
