import { ApiError } from "#questpie/server/errors/index.js";
import { routeApp } from "#questpie/server/routes/route-app.js";
import type { RawRouteHandlerArgs } from "#questpie/server/routes/types.js";

import { handleError } from "../../../../adapters/utils/response.js";

const SESSION_LIST_LIMIT = 100;

type BetterAuthSessionRow = {
	id: string;
	token: string;
	userId: string;
	createdAt: unknown;
	updatedAt: unknown;
	expiresAt: unknown;
	ipAddress?: unknown;
	userAgent?: unknown;
};

function authSiblingUrl(request: Request, endpoint: string): URL {
	const url = new URL(request.url);
	url.pathname = url.pathname.replace(/\/[^/]+$/, `/${endpoint}`);
	url.search = "";
	return url;
}

function authInternalRequest(
	request: Request,
	endpoint: string,
	init?: RequestInit,
): Request {
	const headers = new Headers(request.headers);
	headers.delete("content-length");
	return new Request(authSiblingUrl(request, endpoint), {
		method: init?.method ?? "GET",
		headers,
		body: init?.body,
		signal: request.signal,
	});
}

async function readSessionRows(
	response: Response,
): Promise<BetterAuthSessionRow[]> {
	if (!response.ok) return [];
	const value = await response.json();
	if (!Array.isArray(value)) return [];
	return value.filter(
		(row): row is BetterAuthSessionRow =>
			!!row &&
			typeof row === "object" &&
			typeof row.id === "string" &&
			typeof row.token === "string" &&
			typeof row.userId === "string",
	);
}

function projectSession(
	session: BetterAuthSessionRow,
	currentSessionId: string | undefined,
) {
	return {
		id: session.id,
		// Better Auth clients use this field as the revoke selector. QUESTPIE
		// deliberately projects the non-secret row ID, never the bearer token.
		token: session.id,
		sessionId: session.id,
		userId: session.userId,
		createdAt: session.createdAt,
		updatedAt: session.updatedAt,
		expiresAt: session.expiresAt,
		ipAddress: session.ipAddress ?? null,
		userAgent: session.userAgent ?? null,
		isCurrent: session.id === currentSessionId,
	};
}

function jsonResponseLike(response: Response, value: unknown): Response {
	const headers = new Headers(response.headers);
	headers.delete("content-length");
	headers.delete("content-encoding");
	headers.set("cache-control", "no-store");
	headers.set("content-type", "application/json; charset=utf-8");
	return new Response(JSON.stringify(value), {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

async function handleSessionList(
	request: Request,
	handler: (request: Request) => Promise<Response>,
): Promise<Response> {
	const response = await handler(request);
	if (!response.ok) return response;

	const sessions = await readSessionRows(response.clone());
	const currentResponse = await handler(
		authInternalRequest(request, "get-session"),
	);
	const currentValue = currentResponse.ok
		? ((await currentResponse.json()) as {
				session?: { id?: unknown } | null;
			})
		: undefined;
	const currentSessionId =
		typeof currentValue?.session?.id === "string"
			? currentValue.session.id
			: undefined;

	const projected = sessions
		.toSorted((left, right) => {
			if (left.id === currentSessionId) return -1;
			if (right.id === currentSessionId) return 1;
			return (
				new Date(String(right.createdAt)).getTime() -
				new Date(String(left.createdAt)).getTime()
			);
		})
		.slice(0, SESSION_LIST_LIMIT)
		.map((session) => projectSession(session, currentSessionId));

	return jsonResponseLike(response, projected);
}

async function handleSessionRevoke(
	request: Request,
	handler: (request: Request) => Promise<Response>,
): Promise<Response> {
	let body: unknown;
	try {
		body = await request.clone().json();
	} catch {
		return Response.json({ status: true });
	}
	const candidate =
		body && typeof body === "object"
			? ((body as { sessionId?: unknown; token?: unknown }).sessionId ??
				(body as { token?: unknown }).token)
			: undefined;
	if (
		typeof candidate !== "string" ||
		candidate.length === 0 ||
		candidate.length > 255
	) {
		return Response.json({ status: true });
	}

	const listResponse = await handler(
		authInternalRequest(request, "list-sessions"),
	);
	if (!listResponse.ok) return listResponse;
	const sessions = await readSessionRows(listResponse);
	const owned = sessions.find(({ id }) => id === candidate);
	if (!owned) return Response.json({ status: true });

	return handler(
		authInternalRequest(request, "revoke-session", {
			method: "POST",
			body: JSON.stringify({ token: owned.token }),
		}),
	);
}

export async function handleAuthRoute(ctx: RawRouteHandlerArgs) {
	const { request } = ctx;
	const app = routeApp(ctx);
	if (!app.auth) {
		return handleError(ApiError.notImplemented("Authentication"), {
			request,
			app,
		});
	}
	const pathname = new URL(request.url).pathname;
	if (request.method === "GET" && pathname.endsWith("/list-sessions")) {
		return handleSessionList(request, app.auth.handler);
	}
	if (request.method === "POST" && pathname.endsWith("/revoke-session")) {
		return handleSessionRevoke(request, app.auth.handler);
	}
	return app.auth.handler(request);
}
