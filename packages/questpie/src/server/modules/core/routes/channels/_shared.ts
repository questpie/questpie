import { z } from "zod";

import {
	channelCorsHeaders,
	ChannelSecurityError,
	ChannelTokenBucketLimiter,
	resolveChannelRequestOrigin,
} from "#questpie/server/channels/security.js";
import {
	ChannelsService,
	type ChannelServiceContext,
} from "#questpie/server/channels/service.js";
import type { Principal } from "#questpie/server/config/context.js";
import type { ChannelSecurityObservationReason } from "#questpie/server/modules/core/integrated/realtime/observer.js";
import { routeApp } from "#questpie/server/routes/route-app.js";

type ChannelRouteContext = object & {
	db?: unknown;
	session?: {
		user?: { id?: string };
		session?: { id?: string };
	} | null;
	principal?: Principal;
};

export type ChannelRouteInput = {
	channel: string;
	params: Record<string, string>;
};

export type ChannelAuthRouteInput = ChannelRouteInput & {
	socketId: string;
	channelName: string;
};

function securityOptions(ctx: ChannelRouteContext) {
	const app = routeApp(ctx);
	return {
		appUrl: app.config.app.url,
		trustedOrigins: app.config.realtime?.channelSecurity?.trustedOrigins,
	};
}

export function validateChannelRouteOrigin(
	ctx: ChannelRouteContext,
	requireOriginForCookies = true,
): string | null {
	const request = (ctx as { request: Request }).request;
	return resolveChannelRequestOrigin(request, {
		...securityOptions(ctx),
		requireOriginForCookies,
	});
}

export function validateChannelPreflight(request: Request): void {
	const method = request.headers.get("access-control-request-method");
	if (method && method.toUpperCase() !== "POST") {
		throw new Error("Unsupported channel preflight method");
	}
	const requestedHeaders = request.headers
		.get("access-control-request-headers")
		?.split(",")
		.map((header) => header.trim().toLowerCase())
		.filter(Boolean);
	const allowedHeaders = new Set([
		"authorization",
		"content-type",
		"x-api-key",
	]);
	if (requestedHeaders?.some((header) => !allowedHeaders.has(header))) {
		throw new Error("Unsupported channel preflight header");
	}
}

export function channelRouteHeaders(origin: string | null): Headers {
	return channelCorsHeaders(origin);
}

export function channelRouteResponse(
	body: unknown,
	status: number,
	origin: string | null,
): Response {
	return Response.json(body, {
		status,
		headers: channelRouteHeaders(origin),
	});
}

export function channelRouteError(
	error: unknown,
	origin: string | null,
): Response {
	if (error instanceof ChannelSecurityError) {
		const status =
			error.code === "channel_payload_too_large"
				? 413
				: error.code === "channel_name_collision"
					? 409
					: 403;
		return channelRouteResponse({ error: error.code }, status, origin);
	}
	if (error instanceof Error && "code" in error) {
		const code = String((error as { code: unknown }).code);
		const status =
			code === "channel_not_found"
				? 404
				: code === "channel_event_not_found"
					? 404
					: code === "channel_event_invalid"
						? 422
						: 403;
		return channelRouteResponse({ error: code }, status, origin);
	}
	return channelRouteResponse({ error: "channel_request_denied" }, 403, origin);
}

export function channelSecurityReason(
	error: unknown,
): ChannelSecurityObservationReason {
	const code =
		error instanceof ChannelSecurityError
			? error.code
			: error instanceof Error && "code" in error
				? String((error as { code: unknown }).code)
				: "";
	if (code.includes("origin")) return "origin_denied";
	if (code.includes("name") || code.includes("collision"))
		return "name_invalid";
	if (code.includes("payload") || code.includes("event")) {
		return "payload_invalid";
	}
	if (code.includes("presence")) return "presence_invalid";
	if (code.includes("revok")) return "revoked";
	if (code.includes("denied") || code.includes("forbidden")) {
		return "access_denied";
	}
	if (error instanceof Error && "status" in error) return "request_invalid";
	return "unknown";
}

export function observeChannelSecurity(
	ctx: ChannelRouteContext,
	input: {
		verb: "subscribe" | "publish" | "presence" | "origin" | "grant" | "revoke";
		outcome: "allowed" | "denied";
		reason: ChannelSecurityObservationReason;
	},
): void {
	routeApp(ctx).realtime?.record({ type: "channel.security", ...input });
}

function parseParams(value: unknown): Record<string, string> {
	if (typeof value === "string") {
		try {
			value = JSON.parse(value);
		} catch {
			throw new Error("Invalid channel params");
		}
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Invalid channel params");
	}
	const params: Record<string, string> = {};
	for (const [key, param] of Object.entries(value)) {
		if (typeof param !== "string") throw new Error("Invalid channel params");
		params[key] = param;
	}
	return params;
}

function requireString(value: unknown): string {
	if (typeof value !== "string" || value.length === 0) {
		throw new Error("Missing channel request field");
	}
	return value;
}

export async function parseChannelAuthRequest(
	request: Request,
): Promise<ChannelAuthRouteInput> {
	const mediaType = (request.headers.get("content-type") ?? "")
		.split(";", 1)[0]
		?.trim()
		.toLowerCase();
	let body: Record<string, unknown>;
	if (mediaType === "application/json") {
		try {
			body = (await request.json()) as Record<string, unknown>;
		} catch {
			throw Object.assign(new Error("Invalid channel auth body"), {
				status: 400,
			});
		}
	} else if (mediaType === "application/x-www-form-urlencoded") {
		const form = new URLSearchParams(await request.text());
		body = Object.fromEntries(form.entries());
	} else {
		throw Object.assign(new Error("Unsupported channel auth content type"), {
			status: 415,
		});
	}
	return {
		socketId: requireString(body.socket_id ?? body.socketId),
		channelName: requireString(body.channel_name ?? body.channelName),
		channel: requireString(body.channel),
		params: parseParams(body.params ?? {}),
	};
}

export async function parseChannelPublishRequest(request: Request): Promise<
	ChannelRouteInput & {
		event: string;
		data: unknown;
	}
> {
	const mediaType = (request.headers.get("content-type") ?? "")
		.split(";", 1)[0]
		?.trim()
		.toLowerCase();
	if (mediaType !== "application/json") {
		throw Object.assign(new Error("Unsupported channel publish content type"), {
			status: 415,
		});
	}
	let json: unknown;
	try {
		json = await request.json();
	} catch {
		throw Object.assign(new Error("Invalid channel publish body"), {
			status: 400,
		});
	}
	const parsed = await z
		.object({
			channel: z.string().min(1),
			params: z.record(z.string(), z.string()).default({}),
			event: z.string().min(1),
			data: z.unknown(),
		})
		.strict()
		.safeParseAsync(json);
	if (!parsed.success) {
		throw Object.assign(new Error("Invalid channel publish body"), {
			status: 400,
		});
	}
	return parsed.data;
}

export async function parseChannelReplayRequest(
	request: Request,
): Promise<ChannelRouteInput & { afterEventId: string }> {
	const mediaType = (request.headers.get("content-type") ?? "")
		.split(";", 1)[0]
		?.trim()
		.toLowerCase();
	if (mediaType !== "application/json") {
		throw Object.assign(new Error("Unsupported channel replay content type"), {
			status: 415,
		});
	}
	let json: unknown;
	try {
		json = await request.json();
	} catch {
		throw Object.assign(new Error("Invalid channel replay body"), {
			status: 400,
		});
	}
	const parsed = await z
		.object({
			channel: z.string().min(1),
			params: z.record(z.string(), z.string()).default({}),
			afterEventId: z.string().min(1).max(256),
		})
		.strict()
		.safeParseAsync(json);
	if (!parsed.success) {
		throw Object.assign(new Error("Invalid channel replay body"), {
			status: 400,
		});
	}
	return parsed.data;
}

export function requestChannels(ctx: ChannelRouteContext): ChannelsService {
	const app = routeApp(ctx);
	return new ChannelsService(
		app.config.channels ?? {},
		app.realtime,
		{ ...ctx, accessMode: "user" } as ChannelServiceContext,
		app.config.realtime?.channelSecurity,
	);
}

const publishLimiters = new WeakMap<object, ChannelTokenBucketLimiter>();

/** @internal Deterministic route-test seam; not exported from the package API. */
export function setChannelPublishLimiterForTests(
	app: object,
	limiter: ChannelTokenBucketLimiter,
): void {
	publishLimiters.set(app, limiter);
}

function publishLimiter(ctx: ChannelRouteContext): ChannelTokenBucketLimiter {
	const app = routeApp(ctx);
	let limiter = publishLimiters.get(app);
	if (!limiter) {
		const config = app.config.realtime?.channelSecurity;
		limiter = new ChannelTokenBucketLimiter({
			ratePerSecond: config?.publishRatePerSecond ?? 10,
			burst: config?.publishBurst ?? 20,
		});
		publishLimiters.set(app, limiter);
	}
	return limiter;
}

function anonymousEdgeKey(request: Request): string {
	const forwarded = request.headers
		.get("x-forwarded-for")
		?.split(",", 1)[0]
		?.trim();
	return forwarded || request.headers.get("x-real-ip") || "anonymous";
}

export function consumeChannelPublishQuota(
	ctx: ChannelRouteContext,
	request: Request,
): { allowed: boolean; retryAfterMs: number } {
	const sessionId =
		ctx.session?.session?.id ??
		(ctx.principal?.kind === "user" ? ctx.principal.session.id : undefined);
	const edge = anonymousEdgeKey(request);
	const sessionKey = `session:${sessionId ?? edge}`;
	let principalKey: string;
	if (ctx.principal?.kind === "oauth") {
		principalKey = `principal:oauth:${ctx.principal.tokenId}`;
	} else if (ctx.principal?.kind === "user") {
		principalKey = `principal:user:${ctx.principal.user.id}`;
	} else if (ctx.principal?.kind === "system") {
		principalKey = "principal:system";
	} else if (ctx.session?.user?.id) {
		principalKey = `principal:user:${ctx.session.user.id}`;
	} else {
		principalKey = `principal:anonymous:${edge}`;
	}
	const limiter = publishLimiter(ctx);
	const keys = [sessionKey, principalKey];
	const allowed = limiter.consumeAll(keys);
	return {
		allowed,
		retryAfterMs: allowed ? 0 : limiter.retryAfterMs(keys),
	};
}

export function principalOf(ctx: ChannelRouteContext): Principal | null {
	return ctx.principal ?? null;
}
