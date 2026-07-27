/**
 * Shared MCP Streamable-HTTP handler.
 *
 * `route()` is single-method, so the MCP endpoint's four verbs (POST = JSON-RPC
 * messages, GET/DELETE = explicit stateless 405, OPTIONS = CORS preflight) are
 * registered as separate method-suffixed route files under `routes/`
 * (`mcp.ts` = POST, `mcp.get.ts`, `mcp.delete.ts`, `mcp.options.ts`) per the
 * codegen file convention — NOT method chaining and NOT a hand-written
 * `module.ts`. All four share THIS handler, which dispatches on
 * `request.method` internally because the transport needs one object for every
 * verb on the path. Stateful sessions and reconnect semantics are intentionally
 * absent.
 */

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { RawRouteHandlerArgs } from "questpie";

import { createMcpServer } from "./create-server.js";
import { assertBoundedMcpValue } from "./execution-boundary.js";
import { validateMcpPrincipal } from "./principal.js";
import { getAppMcpRelease } from "./release.js";
import type { QuestpieApp } from "./runtime.js";

const MAX_MCP_HTTP_BODY_BYTES = 1024 * 1024;
const MAX_MCP_HTTP_BATCH_SIZE = 16;
const MAX_MCP_HTTP_RESPONSE_BYTES = 4 * 1024 * 1024;
const CORS_ALLOWED_HEADERS = new Set([
	"authorization",
	"content-type",
	"mcp-protocol-version",
	"x-api-key",
]);

export const mcpMeta = {
	title: "MCP endpoint",
	description: "Model Context Protocol endpoint for QUESTPIE.",
};

function appFromRouteContext(ctx: object): QuestpieApp {
	return (ctx as { app: QuestpieApp }).app;
}

function executionContextFromRouteContext(ctx: object) {
	const routeCtx = { ...ctx } as Record<string, unknown>;
	delete routeCtx.app;
	delete routeCtx.request;
	return routeCtx;
}

function withCors(response: Response, allowedOrigin?: string): Response {
	const headers = new Headers(response.headers);
	if (allowedOrigin) {
		headers.set("Access-Control-Allow-Origin", allowedOrigin);
		headers.set("Vary", "Origin");
	}
	headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
	headers.set(
		"Access-Control-Allow-Headers",
		"Content-Type, Authorization, MCP-Protocol-Version, x-api-key",
	);
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

function allowedOrigin(
	appUrl: string,
	request: Request,
	additions: readonly string[] | undefined,
): string | undefined | null {
	const requested = request.headers.get("origin");
	if (!requested) return undefined;

	const origins = new Set([new URL(appUrl).origin]);
	for (const addition of additions ?? []) {
		const origin = canonicalConfiguredOrigin(addition);
		if (origin) origins.add(origin);
	}
	const canonicalRequested = canonicalConfiguredOrigin(requested);
	return canonicalRequested && origins.has(canonicalRequested)
		? canonicalRequested
		: null;
}

function canonicalConfiguredOrigin(value: string): string | null {
	try {
		const url = new URL(value);
		if (
			url.username ||
			url.password ||
			url.pathname !== "/" ||
			url.search ||
			url.hash ||
			value !== url.origin
		) {
			return null;
		}
		return url.origin;
	} catch {
		return null;
	}
}

function canonicalHost(value: string, protocol: string): string | null {
	if (
		!value ||
		value.trim() !== value ||
		value.includes("://") ||
		/[/?#@\\]/.test(value)
	) {
		return null;
	}
	try {
		const url = new URL(`${protocol}//${value}`);
		if (url.username || url.password || url.pathname !== "/" || !url.host) {
			return null;
		}
		return url.host.toLowerCase();
	} catch {
		return null;
	}
}

function hasAllowedHost(
	appUrl: string,
	request: Request,
	additions: readonly string[] | undefined,
): boolean {
	const app = new URL(appUrl);
	const allowed = new Set([app.host.toLowerCase()]);
	for (const addition of additions ?? []) {
		const host = canonicalHost(addition, app.protocol);
		if (host) allowed.add(host);
	}

	const requestedValue =
		request.headers.get("host") ?? new URL(request.url).host;
	const requested = canonicalHost(requestedValue, app.protocol);
	return requested !== null && allowed.has(requested);
}

function isAllowedPreflight(request: Request): boolean {
	if (!request.headers.has("origin")) return false;
	if (
		request.headers.get("access-control-request-method")?.toUpperCase() !==
		"POST"
	) {
		return false;
	}
	const requestedHeaders = request.headers.get(
		"access-control-request-headers",
	);
	if (!requestedHeaders) return true;
	const headers = requestedHeaders
		.split(",")
		.map((header) => header.trim().toLowerCase());
	return (
		headers.length <= CORS_ALLOWED_HEADERS.size &&
		headers.every(
			(header) => header.length > 0 && CORS_ALLOWED_HEADERS.has(header),
		)
	);
}

async function readBoundedBody(
	request: Request,
): Promise<Uint8Array<ArrayBuffer> | undefined> {
	if (!request.body) return new Uint8Array(new ArrayBuffer(0));
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > MAX_MCP_HTTP_BODY_BYTES) {
			await reader.cancel();
			return undefined;
		}
		chunks.push(value);
	}

	const body = new Uint8Array(new ArrayBuffer(size));
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return body;
}

function hasBoundedJsonRpcBatch(
	body: Uint8Array,
	limits: {
		maxInputDepth: number;
		maxValueNodes: number;
	},
): boolean {
	try {
		const payload = JSON.parse(
			new TextDecoder("utf-8", { fatal: true }).decode(body),
		);
		assertBoundedMcpValue(
			payload,
			{
				maxBytes: MAX_MCP_HTTP_BODY_BYTES,
				maxValueDepth: limits.maxInputDepth,
				maxValueNodes: limits.maxValueNodes,
			},
			"input_too_large",
		);
		return (
			!Array.isArray(payload) ||
			(payload.length > 0 && payload.length <= MAX_MCP_HTTP_BATCH_SIZE)
		);
	} catch {
		return false;
	}
}

async function finalizeResponse(
	response: Response,
	close: () => Promise<void>,
): Promise<Response> {
	if (!response.body) {
		await close();
		return response;
	}

	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		while (true) {
			const next = await reader.read();
			if (next.done) break;
			size += next.value.byteLength;
			if (size > MAX_MCP_HTTP_RESPONSE_BYTES) {
				await reader.cancel();
				throw new Error("MCP response exceeded limit");
			}
			chunks.push(next.value);
		}
	} finally {
		await close();
	}
	const body = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new Response(body, {
		status: response.status,
		statusText: response.statusText,
		headers: response.headers,
	});
}

/**
 * Build the `WWW-Authenticate` challenge value for an unauthenticated HTTP MCP
 * request. `resource_metadata` points at this app's Protected Resource metadata
 * document (RFC 9728), served beside the MCP route by the core
 * `oauth-protected-resource` route (MO4). An MCP client reads it to discover
 * the authorization server and start the OAuth 2.1 flow.
 *
 * The public origin comes from `app.config.app.url`, while the mount path comes
 * from the actual MCP request. This keeps the canonical external host used for
 * token audience binding, and also preserves adapter base paths such as `/api`.
 */
function protectedResourceChallenge(
	appUrl: string,
	requestUrl: string,
): string {
	const request = new URL(requestUrl);
	request.pathname = request.pathname.replace(/\/+$/, "");
	const metadataPath = new URL(".well-known/oauth-protected-resource", request)
		.pathname;
	const metadataUrl = new URL(appUrl);
	metadataUrl.pathname = metadataPath;
	metadataUrl.search = "";
	metadataUrl.hash = "";
	return `Bearer resource_metadata="${metadataUrl.href}"`;
}

/**
 * A verified principal is required to reach MCP tool execution over HTTP. The
 * request context resolves one for a cookie/bearer session (`kind: "user"`) or a
 * valid OAuth access token (`kind: "oauth"`); an unauthenticated request has
 * none. Read it structurally — the handler-args type does not surface it.
 */
function hasVerifiedPrincipal(ctx: RawRouteHandlerArgs): boolean {
	const principal = (ctx as { principal?: unknown }).principal;
	const validated = validateMcpPrincipal(principal);
	return validated?.kind === "user" || validated?.kind === "oauth";
}

async function handleMcpRequest(ctx: RawRouteHandlerArgs): Promise<Response> {
	const { request } = ctx;
	const app = appFromRouteContext(ctx);
	const release = getAppMcpRelease(app);
	const config = release.config;
	const corsOrigin = allowedOrigin(
		app.config.app.url,
		request,
		config.http?.allowedOrigins,
	);
	if (
		corsOrigin === null ||
		!hasAllowedHost(app.config.app.url, request, config.http?.allowedHosts)
	) {
		return new Response(null, { status: 403 });
	}
	if (request.method === "GET" || request.method === "DELETE") {
		return new Response(null, {
			status: 405,
			headers: { Allow: "POST, OPTIONS" },
		});
	}
	if (request.method === "OPTIONS") {
		if (!isAllowedPreflight(request)) {
			return new Response(null, { status: 403 });
		}
		return withCors(new Response(null, { status: 204 }), corsOrigin);
	}
	if (
		request.headers.has("mcp-session-id") ||
		request.headers.has("last-event-id")
	) {
		return new Response(null, { status: 400 });
	}
	const declaredLength = request.headers.get("content-length");
	if (declaredLength) {
		if (!/^\d+$/.test(declaredLength)) {
			return new Response(null, { status: 400 });
		}
		if (Number(declaredLength) > MAX_MCP_HTTP_BODY_BYTES) {
			return new Response(null, { status: 413 });
		}
	}

	// Require a verified principal before any MCP dispatch. The framework's
	// adapter has already resolved identity onto `ctx` by the time this handler
	// runs: a cookie/bearer session yields `kind: "user"`, a valid OAuth access
	// token yields `kind: "oauth"`, and an unauthenticated request yields none.
	// Without one, answer 401 + `WWW-Authenticate` so an MCP client auto-discovers
	// the authorization server and starts the OAuth flow — instead of the old
	// silent `session = null` happy path that only failed later on access checks.
	// (OPTIONS already returned above, so CORS preflight is unaffected.)
	if (!hasVerifiedPrincipal(ctx)) {
		return withCors(
			new Response(null, {
				status: 401,
				headers: {
					"WWW-Authenticate": protectedResourceChallenge(
						app.config.app.url,
						request.url,
					),
				},
			}),
			corsOrigin,
		);
	}

	const body = await readBoundedBody(request);
	if (!body) {
		return withCors(new Response(null, { status: 413 }), corsOrigin);
	}
	if (!hasBoundedJsonRpcBatch(body, release.execution.limits)) {
		return withCors(new Response(null, { status: 400 }), corsOrigin);
	}
	const boundedRequest = new Request(request.url, {
		method: request.method,
		headers: request.headers,
		body,
		signal: request.signal,
	});

	let server: Awaited<ReturnType<typeof createMcpServer>> | undefined;
	try {
		server = await createMcpServer(app, {
			transport: "http",
			accessMode: "user",
			request: boundedRequest,
			ctx: executionContextFromRouteContext(ctx) as any,
		});
		const appUrl = new URL(app.config.app.url);
		const transportOrigins = [
			...new Set([
				appUrl.origin,
				...(config.http?.allowedOrigins ?? [])
					.map(canonicalConfiguredOrigin)
					.filter((origin): origin is string => origin !== null),
			]),
		];
		const transportHosts = [
			...new Set([
				appUrl.host.toLowerCase(),
				...(config.http?.allowedHosts ?? [])
					.map((host) => canonicalHost(host, appUrl.protocol))
					.filter((host): host is string => host !== null),
			]),
		];
		const transport = new WebStandardStreamableHTTPServerTransport({
			sessionIdGenerator: undefined,
			allowedOrigins: transportOrigins,
			allowedHosts: transportHosts,
			enableJsonResponse: config.http?.enableJsonResponse ?? true,
		});

		await server.connect(transport);
		const response = await transport.handleRequest(boundedRequest);
		return withCors(
			await finalizeResponse(response, () => server!.close()),
			corsOrigin,
		);
	} catch {
		await server?.close().catch(() => undefined);
		return withCors(new Response(null, { status: 500 }), corsOrigin);
	}
}

export async function mcpHandler(ctx: RawRouteHandlerArgs): Promise<Response> {
	try {
		return await handleMcpRequest(ctx);
	} catch {
		return new Response(null, { status: 500 });
	}
}
