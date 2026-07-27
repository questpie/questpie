import type { Principal } from "#questpie/server/config/context.js";

import {
	createAgentCrdtAuthentication,
	createHumanCrdtAuthentication,
	type CrdtAuthentication,
	type VerifiedAgentCredential,
} from "./authority.js";
import type {
	CrdtAuthorizationInputV1,
	CrdtAuthorizationSnapshot,
	CrdtTargetV1,
} from "./authorization.js";
import type { CrdtOpenedSession, CrdtOpenSessionInput } from "./open-store.js";
import { canonicalizeCrdtBrowserOrigin } from "./origin.js";

const MAX_OPEN_BODY_BYTES = 16 * 1024;

export type CrdtOpenApplicationConfigV1 = Readonly<{
	namespace: string;
	deploymentFingerprint: string;
	appUrl: string;
	allowedOrigins?: readonly string[];
	audience: string;
	authenticateBrowser(
		request: Request,
	): Promise<Extract<Principal, { kind: "user" | "oauth" }> | null>;
	authenticateAgent(input: {
		request: Request;
		bearerToken: string;
		audience: string;
		namespace: string;
	}): Promise<VerifiedAgentCredential | null>;
	authorize(
		input: Extract<CrdtAuthorizationInputV1, { purpose: "issue" }>,
	): Promise<CrdtAuthorizationSnapshot>;
	authorizeEdge(input: {
		sessionId: string;
		token: string;
		identity: string;
	}): Promise<{
		sessionKey: Uint8Array;
		ownerGeneration: bigint;
	} | null>;
	openSession(input: CrdtOpenSessionInput): Promise<CrdtOpenedSession>;
	maximumConcurrentRequests?: number;
}>;

type ParsedOpenRequest = Readonly<{
	openId: string;
	replacesBindingId?: string;
	owner:
		| Readonly<{ kind: "collection"; key: string; id: string | number }>
		| Readonly<{ kind: "global"; key: string }>;
	mode: "view" | "edit";
	fallback?: "view";
	edgeSessionId: string;
}>;

export function createCrdtOpenApplicationV1(
	config: CrdtOpenApplicationConfigV1,
) {
	assertConfig(config);
	const requests = createAdmissionGate(config.maximumConcurrentRequests ?? 64);
	return Object.freeze({
		async handle(request: Request): Promise<Response> {
			let releaseRequest: (() => void) | undefined;
			try {
				if (request.method !== "POST") throw new Error();
				releaseRequest = requests.acquire();
				if (
					request.headers.has("cookie") &&
					request.headers.has("authorization")
				) {
					throw new Error();
				}
				const input = await parseOpenRequest(request);
				const { authentication, actorKind, origin, identity } =
					await authenticate(config, request, input.mode);
				const controlToken = boundedToken(
					request.headers.get("x-questpie-realtime-token"),
				);
				const edge = await config.authorizeEdge({
					sessionId: input.edgeSessionId,
					token: controlToken,
					identity,
				});
				if (
					!edge ||
					edge.sessionKey.byteLength !== 32 ||
					edge.ownerGeneration < 0n
				) {
					throw new Error();
				}
				const target: CrdtTargetV1 = Object.freeze({
					namespace: config.namespace,
					owner: input.owner,
					mode: input.mode,
					...(input.fallback ? { fallback: input.fallback } : {}),
				});
				const authorization = await config.authorize({
					purpose: "issue",
					request,
					authentication,
					target,
					origin,
					audience: config.audience,
				});
				assertAuthorizationBinding(
					authorization,
					input,
					config.audience,
					origin,
				);
				const opened = await config.openSession({
					openId: input.openId,
					...(input.replacesBindingId
						? { replacesBindingId: input.replacesBindingId }
						: {}),
					authorization,
					actorKind,
					edge,
				});
				return openResponse(config, opened);
			} catch {
				return unavailableResponse();
			} finally {
				releaseRequest?.();
			}
		},
	});
}

async function authenticate(
	config: CrdtOpenApplicationConfigV1,
	request: Request,
	mode: "view" | "edit",
): Promise<{
	authentication: CrdtAuthentication;
	actorKind: 1 | 2 | 3;
	origin: string | null;
	identity: string;
}> {
	const cookieAuthenticated = request.headers.has("cookie");
	const origin = cookieAuthenticated
		? canonicalizeCrdtBrowserOrigin({
				origin: request.headers.get("origin"),
				appUrl: config.appUrl,
				allowedOrigins: config.allowedOrigins,
			})
		: null;
	const principal = await config.authenticateBrowser(request);
	if (principal) {
		return {
			authentication: createHumanCrdtAuthentication(principal),
			actorKind: principal.kind === "user" ? 1 : 2,
			origin,
			identity:
				principal.kind === "user"
					? `user-session:${principal.session.id}`
					: `oauth:${principal.tokenId}`,
		};
	}
	if (cookieAuthenticated) throw new Error();
	const bearerToken = parseBearer(request.headers.get("authorization"));
	const credential = await config.authenticateAgent({
		request,
		bearerToken,
		audience: config.audience,
		namespace: config.namespace,
	});
	if (!credential) throw new Error();
	const authentication = createAgentCrdtAuthentication(credential);
	if (mode === "edit" && !authentication.actor.scopes.includes("crdt:edit")) {
		throw new Error();
	}
	return {
		authentication,
		actorKind: 3,
		origin: null,
		// Agent credentials authorize the document operation. The edge capability
		// is independently secret-bound and is anonymous in the shared transport.
		identity: "anonymous",
	};
}

async function parseOpenRequest(request: Request): Promise<ParsedOpenRequest> {
	if (request.headers.has("content-encoding")) throw new Error();
	if (
		request.headers.get("content-type")?.split(";", 1)[0]?.trim() !==
		"application/json"
	) {
		throw new Error();
	}
	const declared = request.headers.get("content-length");
	if (
		declared !== null &&
		(!/^(0|[1-9][0-9]*)$/.test(declared) ||
			Number(declared) > MAX_OPEN_BODY_BYTES)
	) {
		throw new Error();
	}
	const bytes = await boundedBody(request, MAX_OPEN_BODY_BYTES);
	let value: unknown;
	try {
		value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
	} catch {
		throw new Error();
	}
	const input = strictRecord(value, [
		"openId",
		"replacesBindingId",
		"owner",
		"mode",
		"fallback",
		"edgeSessionId",
	]);
	if (
		!validUuid(input.openId) ||
		(input.replacesBindingId !== undefined &&
			!validUuid(input.replacesBindingId)) ||
		(input.mode !== "view" && input.mode !== "edit") ||
		(input.fallback !== undefined && input.fallback !== "view") ||
		(input.mode === "view" && input.fallback !== undefined) ||
		!isBoundedAscii(input.edgeSessionId, 512)
	) {
		throw new Error();
	}
	const owner = strictRecord(input.owner, ["kind", "key", "id"]);
	if (
		(owner.kind !== "collection" && owner.kind !== "global") ||
		!isBoundedAscii(owner.key, 128)
	) {
		throw new Error();
	}
	if (owner.kind === "global") {
		if (owner.id !== undefined) throw new Error();
		return Object.freeze({
			openId: input.openId,
			...(input.replacesBindingId
				? { replacesBindingId: input.replacesBindingId }
				: {}),
			owner: Object.freeze({ kind: "global", key: owner.key }),
			mode: input.mode,
			...(input.fallback ? { fallback: input.fallback } : {}),
			edgeSessionId: input.edgeSessionId,
		});
	}
	if (
		(typeof owner.id !== "string" && typeof owner.id !== "number") ||
		(typeof owner.id === "number" && !Number.isSafeInteger(owner.id))
	) {
		throw new Error();
	}
	return Object.freeze({
		openId: input.openId,
		...(input.replacesBindingId
			? { replacesBindingId: input.replacesBindingId }
			: {}),
		owner: Object.freeze({
			kind: "collection",
			key: owner.key,
			id: owner.id,
		}),
		mode: input.mode,
		...(input.fallback ? { fallback: input.fallback } : {}),
		edgeSessionId: input.edgeSessionId,
	});
}

async function boundedBody(
	request: Request,
	maximumBytes: number,
): Promise<Uint8Array> {
	if (!request.body) throw new Error();
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		while (true) {
			const { done, value } = await readWithAbort(reader, request.signal);
			if (done) break;
			size += value.byteLength;
			if (size > maximumBytes) throw new Error();
			chunks.push(value);
		}
	} catch (error) {
		void reader.cancel(error).catch(() => {});
		throw error;
	}
	const output = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		output.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return output;
}

async function readWithAbort(
	reader: ReadableStreamDefaultReader<Uint8Array>,
	signal: AbortSignal,
) {
	if (signal.aborted) throw abortReason(signal);
	let rejectAbort!: (reason?: unknown) => void;
	const aborted = new Promise<never>((_resolve, reject) => {
		rejectAbort = reject;
	});
	const abort = () => rejectAbort(abortReason(signal));
	signal.addEventListener("abort", abort, { once: true });
	try {
		return await Promise.race([reader.read(), aborted]);
	} finally {
		signal.removeEventListener("abort", abort);
	}
}

function abortReason(signal: AbortSignal): unknown {
	return (
		signal.reason ?? new DOMException("CRDT request aborted", "AbortError")
	);
}

function createAdmissionGate(maximum: number) {
	if (!Number.isSafeInteger(maximum) || maximum < 1) {
		throw new TypeError("CRDT open concurrency must be positive");
	}
	let active = 0;
	return Object.freeze({
		acquire(): () => void {
			if (active >= maximum) throw new Error();
			active++;
			let released = false;
			return () => {
				if (released) return;
				released = true;
				active--;
			};
		},
	});
}

function assertAuthorizationBinding(
	authorization: CrdtAuthorizationSnapshot,
	input: ParsedOpenRequest,
	audience: string,
	origin: string | null,
): void {
	if (
		authorization.origin !== origin ||
		authorization.audience !== audience ||
		authorization.requestedMode !== input.mode ||
		(input.mode === "view" && authorization.effectiveMode !== "view") ||
		(input.mode === "edit" &&
			authorization.effectiveMode === "view" &&
			input.fallback !== "view")
	) {
		throw new Error();
	}
}

function openResponse(
	config: CrdtOpenApplicationConfigV1,
	opened: CrdtOpenedSession,
): Response {
	return Response.json(
		{
			protocol: "questpie-crdt-http",
			version: 1,
			namespace: config.namespace,
			deploymentFingerprint: config.deploymentFingerprint,
			bindingId: opened.bindingId,
			sessionGeneration: opened.sessionGeneration.toString(),
			deliveryGeneration: opened.deliveryGeneration.toString(),
			leaseExpiresAt: opened.leaseExpiresAt.toISOString(),
			incarnationKey: opened.incarnationKey,
			effectiveMode: opened.effectiveMode,
			offlineSubjectKey: opened.offlineSubjectKey,
			manifest: opened.manifest,
			initialPull: {
				operation: "pull",
				continuation: null,
			},
		},
		{
			status: 201,
			headers: {
				"cache-control": "no-store",
				pragma: "no-cache",
			},
		},
	);
}

function unavailableResponse(): Response {
	return Response.json(
		{
			error: {
				code: "CRDT_UNAVAILABLE",
				message: "CRDT unavailable",
			},
		},
		{
			status: 404,
			headers: { "cache-control": "no-store" },
		},
	);
}

function strictRecord(
	value: unknown,
	keys: readonly string[],
): Record<string, any> {
	if (
		!value ||
		typeof value !== "object" ||
		Array.isArray(value) ||
		Object.getPrototypeOf(value) !== Object.prototype
	) {
		throw new Error();
	}
	const record = value as Record<string, unknown>;
	if (Object.keys(record).some((key) => !keys.includes(key))) throw new Error();
	return record;
}

function boundedToken(value: string | null): string {
	if (!value || !/^[!-~]{1,512}$/.test(value) || value.includes(",")) {
		throw new Error();
	}
	return value;
}

function parseBearer(value: string | null): string {
	if (!value || !/^Bearer [!-~]{1,4096}$/.test(value)) throw new Error();
	const token = value.slice(7);
	if (token.includes(" ") || token.includes(",")) throw new Error();
	return token;
}

function isBoundedAscii(value: unknown, maximum: number): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= maximum &&
		/^[\x20-\x7e]+$/.test(value)
	);
}

function validUuid(value: unknown): value is string {
	return (
		typeof value === "string" &&
		/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
			value,
		)
	);
}

function assertConfig(config: CrdtOpenApplicationConfigV1): void {
	if (
		!isBoundedAscii(config.namespace, 64) ||
		!isBoundedAscii(config.deploymentFingerprint, 128)
	) {
		throw new TypeError("CRDT open deployment identity is invalid");
	}
	const appUrl = new URL(config.appUrl);
	const audience = new URL(config.audience);
	if (
		(appUrl.protocol !== "http:" && appUrl.protocol !== "https:") ||
		(audience.protocol !== "http:" && audience.protocol !== "https:") ||
		(audience.href !== config.audience && audience.origin !== config.audience)
	) {
		throw new TypeError("CRDT open URL configuration is invalid");
	}
}
