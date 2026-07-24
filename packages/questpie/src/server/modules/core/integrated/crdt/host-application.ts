import type { Principal } from "#questpie/server/config/context.js";
import {
	createAgentCrdtAuthentication,
	createHumanCrdtAuthentication,
	type CrdtAuthentication,
	type VerifiedAgentCredential,
} from "#questpie/server/modules/core/integrated/crdt/authority.js";
import {
	CrdtProtocolMachineV1,
	decodeCrdtFrameV1,
} from "#questpie/shared/crdt-protocol.js";

import type {
	CrdtHostApplicationV1,
	CrdtHostSocketOpenInputV1,
	CrdtHostSocketSessionV1,
} from "./host.js";
import { canonicalCrdtCollectionLocator } from "./owner-lifecycle.js";
import type {
	CrdtAuthorizedTicketSnapshot,
	CrdtIssuedTicket,
	CrdtRedeemedTicket,
	CrdtTicketRedemptionClaim,
} from "./ticket-store.js";
import {
	canonicalizeCrdtBrowserOrigin,
	CrdtTicketRejectedError,
} from "./ticket.js";

type CrdtMode = "view" | "edit";

export type CrdtTicketTargetV1 = Readonly<{
	namespace: string;
	owner:
		| Readonly<{
				kind: "collection";
				key: string;
				id: string | number;
		  }>
		| Readonly<{ kind: "global"; key: string }>;
	mode: CrdtMode;
	fallback?: "view";
}>;

export type CrdtHostAuthorizationInputV1 =
	| Readonly<{
			purpose: "issue";
			request: Request;
			authentication: CrdtAuthentication;
			target: CrdtTicketTargetV1;
			origin: string | null;
			audience: string;
	  }>
	| Readonly<{
			purpose: "redeem";
			request: Request;
			authentication: CrdtAuthentication;
			resourceId: string;
			requestedMode: CrdtMode;
			effectiveMode: CrdtMode;
			origin: string | null;
			audience: string;
	  }>;

export type CrdtHostAdmissionV1 = Readonly<{
	issue(snapshot: CrdtAuthorizedTicketSnapshot): Promise<CrdtIssuedTicket>;
	inspect(ticket: string): Promise<CrdtTicketRedemptionClaim>;
	redeem(input: {
		ticket: string;
		authorization: CrdtAuthorizedTicketSnapshot;
	}): Promise<CrdtRedeemedTicket>;
	release(sessionId: string): Promise<void>;
}>;

export type CrdtAuthenticatedSocketV1 = Readonly<{
	message(data: Uint8Array): void | Promise<void>;
	drain(): void | Promise<void>;
	close(code: number, reason: string): void | Promise<void>;
}>;

export type CrdtHostApplicationConfigV1 = Readonly<{
	namespace: string;
	appUrl: string;
	audience: string;
	allowedOrigins?: readonly string[];
	admission: CrdtHostAdmissionV1;
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
		input: CrdtHostAuthorizationInputV1,
	): Promise<CrdtAuthorizedTicketSnapshot>;
	openAuthenticatedSession(
		input: Readonly<{
			request: Request;
			clientIp: string;
			authentication: CrdtAuthentication;
			redemption: CrdtRedeemedTicket;
			authorization: CrdtAuthorizedTicketSnapshot;
			authRequestId: bigint;
			peer: CrdtHostSocketOpenInputV1["peer"];
			protocol: CrdtProtocolMachineV1;
		}>,
	): Promise<CrdtAuthenticatedSocketV1>;
}>;

export function createCrdtHostApplicationV1(
	config: CrdtHostApplicationConfigV1,
): CrdtHostApplicationV1 {
	assertHostConfig(config);
	const sockets = new Set<ManagedSocket>();
	let stopping = false;

	const application: CrdtHostApplicationV1 = {
		protocol: "QPCR/1.0",
		async handleTicket(request) {
			if (stopping) return new Response(null, { status: 503 });
			try {
				const target = await parseTicketTarget(request, config.namespace);
				const origin = canonicalizeCrdtBrowserOrigin({
					origin: request.headers.get("origin"),
					appUrl: config.appUrl,
					allowedOrigins: config.allowedOrigins,
				});
				const authentication = await browserAuthentication(config, request);
				const authorization = await config.authorize({
					purpose: "issue",
					request,
					authentication,
					target,
					origin,
					audience: config.audience,
				});
				assertAuthorizationBinding(authorization, {
					origin,
					audience: config.audience,
					requestedMode: target.mode,
					fallback: target.fallback,
				});
				return ticketResponse(await config.admission.issue(authorization));
			} catch (error) {
				return handleTicketFailure(error);
			}
		},
		async handleAgentTicket(request) {
			if (stopping) return new Response(null, { status: 503 });
			try {
				const target = await parseTicketTarget(request, config.namespace);
				const authentication = await agentAuthentication(config, request);
				assertAgentMode(authentication, target.mode);
				const authorization = await config.authorize({
					purpose: "issue",
					request,
					authentication,
					target,
					origin: null,
					audience: config.audience,
				});
				assertAuthorizationBinding(authorization, {
					origin: null,
					audience: config.audience,
					requestedMode: target.mode,
					fallback: target.fallback,
				});
				return ticketResponse(await config.admission.issue(authorization));
			} catch (error) {
				return handleTicketFailure(error);
			}
		},
		openSocket(input) {
			if (stopping) throw rejected();
			const socket = new ManagedSocket(config, input, () => {
				sockets.delete(socket);
			});
			sockets.add(socket);
			return socket;
		},
		async stop() {
			if (stopping) return;
			stopping = true;
			await Promise.all(
				[...sockets].map(async (socket) => {
					socket.peer.close(1012, "CRDT host stopping");
					await socket.close(1012, "CRDT host stopping");
				}),
			);
			sockets.clear();
		},
	};
	return Object.freeze(application);
}

class ManagedSocket implements CrdtHostSocketSessionV1 {
	readonly peer: CrdtHostSocketOpenInputV1["peer"];
	private readonly protocol = new CrdtProtocolMachineV1();
	private downstream?: CrdtAuthenticatedSocketV1;
	private redemption?: CrdtRedeemedTicket;
	private authenticating = false;
	private closed = false;
	private released = false;

	constructor(
		private readonly config: CrdtHostApplicationConfigV1,
		private readonly input: CrdtHostSocketOpenInputV1,
		private readonly remove: () => void,
	) {
		this.peer = input.peer;
	}

	async message(
		data: Uint8Array,
	): Promise<Readonly<{ authenticated: boolean }>> {
		if (this.closed) throw rejected();
		if (this.downstream) {
			await this.downstream.message(data);
			return { authenticated: true };
		}
		if (this.authenticating) throw rejected();
		this.authenticating = true;

		try {
			const frame = decodeCrdtFrameV1(data);
			this.protocol.accept("client-to-server", frame);
			if (frame.opcode !== 0x01) throw rejected();
			const claim = await this.config.admission.inspect(frame.payload.ticket);
			assertClaimBinding(claim, this.config.audience);
			const authentication =
				claim.origin === null
					? await agentAuthentication(this.config, this.input.request)
					: await browserRedemptionAuthentication(
							this.config,
							this.input.request,
							claim.origin,
						);
			assertAgentMode(authentication, claim.requestedMode);
			const authorization = await this.config.authorize({
				purpose: "redeem",
				request: this.input.request,
				authentication,
				resourceId: claim.resourceId,
				requestedMode: claim.requestedMode,
				effectiveMode: claim.effectiveMode,
				origin: claim.origin,
				audience: claim.audience,
			});
			assertAuthorizationBinding(authorization, {
				origin: claim.origin,
				audience: claim.audience,
				requestedMode: claim.requestedMode,
				effectiveMode: claim.effectiveMode,
			});
			this.redemption = await this.config.admission.redeem({
				ticket: frame.payload.ticket,
				authorization,
			});
			this.downstream = await this.config.openAuthenticatedSession({
				request: this.input.request,
				clientIp: this.input.clientIp,
				authentication,
				redemption: this.redemption,
				authorization,
				authRequestId: frame.requestId,
				peer: this.input.peer,
				protocol: this.protocol,
			});
			if (this.closed) {
				await this.downstream.close(
					1001,
					"CRDT socket closed during authentication",
				);
				await this.release();
				throw rejected();
			}
			return { authenticated: true };
		} catch (error) {
			try {
				await this.release();
			} catch {
				// Authentication still fails closed when best-effort cleanup fails.
			}
			if (error instanceof TypeError) throw error;
			throw rejected();
		}
	}

	async drain(): Promise<void> {
		await this.downstream?.drain();
	}

	async close(code: number, reason: string): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		this.remove();
		try {
			await this.downstream?.close(code, reason);
		} finally {
			await this.release();
		}
	}

	private async release(): Promise<void> {
		if (this.released || !this.redemption) return;
		this.released = true;
		await this.config.admission.release(this.redemption.sessionId);
	}
}

async function browserAuthentication(
	config: CrdtHostApplicationConfigV1,
	request: Request,
): Promise<CrdtAuthentication> {
	try {
		const principal = await config.authenticateBrowser(request);
		if (!principal) throw rejected();
		return createHumanCrdtAuthentication(principal);
	} catch {
		throw rejected();
	}
}

async function browserRedemptionAuthentication(
	config: CrdtHostApplicationConfigV1,
	request: Request,
	expectedOrigin: string,
): Promise<CrdtAuthentication> {
	const origin = canonicalizeCrdtBrowserOrigin({
		origin: request.headers.get("origin"),
		appUrl: config.appUrl,
		allowedOrigins: config.allowedOrigins,
	});
	if (origin !== expectedOrigin) throw rejected();
	return browserAuthentication(config, request);
}

async function agentAuthentication(
	config: CrdtHostApplicationConfigV1,
	request: Request,
): Promise<CrdtAuthentication> {
	try {
		if (request.headers.has("cookie")) throw rejected();
		const bearerToken = parseBearer(request.headers.get("authorization"));
		const credential = await config.authenticateAgent({
			request,
			bearerToken,
			audience: config.audience,
			namespace: config.namespace,
		});
		if (!credential) throw rejected();
		return createAgentCrdtAuthentication(credential);
	} catch {
		throw rejected();
	}
}

function assertAgentMode(
	authentication: CrdtAuthentication,
	mode: CrdtMode,
): void {
	if (
		authentication.actor.kind === "agent" &&
		mode === "edit" &&
		!authentication.actor.scopes.includes("crdt:edit")
	) {
		throw rejected();
	}
}

async function parseTicketTarget(
	request: Request,
	namespace: string,
): Promise<CrdtTicketTargetV1> {
	if (
		request.headers.get("content-type")?.split(";", 1)[0]?.trim() !==
		"application/json"
	) {
		throw rejected();
	}
	let value: unknown;
	try {
		value = await request.json();
	} catch {
		throw rejected();
	}
	const input = strictRecord(value, ["namespace", "owner", "mode", "fallback"]);
	if (
		typeof input.namespace !== "string" ||
		input.namespace !== namespace ||
		!isBoundedAscii(input.namespace, 64) ||
		(input.mode !== "view" && input.mode !== "edit") ||
		(input.fallback !== undefined && input.fallback !== "view") ||
		(input.mode === "view" && input.fallback !== undefined)
	) {
		throw rejected();
	}
	const owner = strictRecord(input.owner, ["kind", "key", "id"]);
	if (
		(owner.kind !== "collection" && owner.kind !== "global") ||
		typeof owner.key !== "string" ||
		!isBoundedAscii(owner.key, 128)
	) {
		throw rejected();
	}
	if (owner.kind === "global") {
		if (owner.id !== undefined) throw rejected();
		return Object.freeze({
			namespace: input.namespace,
			owner: Object.freeze({ kind: "global", key: owner.key }),
			mode: input.mode,
			...(input.fallback ? { fallback: input.fallback } : {}),
		});
	}
	if (
		(typeof owner.id !== "string" && typeof owner.id !== "number") ||
		(typeof owner.id === "number" && !Number.isSafeInteger(owner.id))
	) {
		throw rejected();
	}
	try {
		const locator = canonicalCrdtCollectionLocator(owner.id);
		if (new TextEncoder().encode(locator).byteLength > 4096) throw rejected();
	} catch {
		throw rejected();
	}
	return Object.freeze({
		namespace: input.namespace,
		owner: Object.freeze({
			kind: "collection",
			key: owner.key,
			id: owner.id,
		}),
		mode: input.mode,
		...(input.fallback ? { fallback: input.fallback } : {}),
	});
}

function strictRecord(
	value: unknown,
	keys: readonly string[],
): Record<string, unknown> {
	if (
		!value ||
		typeof value !== "object" ||
		Array.isArray(value) ||
		Object.getPrototypeOf(value) !== Object.prototype
	) {
		throw rejected();
	}
	const record = value as Record<string, unknown>;
	if (Object.keys(record).some((key) => !keys.includes(key))) throw rejected();
	return record;
}

function parseBearer(value: string | null): string {
	if (!value || !/^Bearer [!-~]{1,4096}$/.test(value)) throw rejected();
	const token = value.slice(7);
	if (token.includes(" ") || token.includes(",")) throw rejected();
	return token;
}

function isBoundedAscii(value: string, maximum: number): boolean {
	return (
		value.length > 0 && value.length <= maximum && /^[\x20-\x7e]+$/.test(value)
	);
}

function assertHostConfig(config: CrdtHostApplicationConfigV1): void {
	if (!isBoundedAscii(config.namespace, 64)) {
		throw new TypeError("CRDT namespace must be 1-64 ASCII bytes");
	}
	let audience: URL;
	try {
		audience = new URL(config.audience);
	} catch {
		throw new TypeError("CRDT audience must be an absolute HTTP(S) URL");
	}
	if (
		(audience.protocol !== "http:" && audience.protocol !== "https:") ||
		audience.href !== config.audience ||
		config.audience.length > 255
	) {
		throw new TypeError("CRDT audience must be a canonical HTTP(S) URL");
	}
	canonicalizeCrdtBrowserOrigin({
		origin: new URL(config.appUrl).origin,
		appUrl: config.appUrl,
		allowedOrigins: config.allowedOrigins,
	});
}

function assertClaimBinding(
	claim: CrdtTicketRedemptionClaim,
	audience: string,
): void {
	if (claim.audience !== audience) throw rejected();
}

function assertAuthorizationBinding(
	authorization: CrdtAuthorizedTicketSnapshot,
	expected: Readonly<{
		origin: string | null;
		audience: string;
		requestedMode: CrdtMode;
		effectiveMode?: CrdtMode;
		fallback?: "view";
	}>,
): void {
	if (
		authorization.origin !== expected.origin ||
		authorization.audience !== expected.audience ||
		authorization.requestedMode !== expected.requestedMode ||
		(expected.effectiveMode !== undefined &&
			authorization.effectiveMode !== expected.effectiveMode) ||
		(expected.requestedMode === "view" &&
			authorization.effectiveMode !== "view") ||
		(expected.requestedMode === "edit" &&
			authorization.effectiveMode === "view" &&
			expected.fallback !== "view")
	) {
		throw rejected();
	}
}

function ticketResponse(ticket: CrdtIssuedTicket): Response {
	return Response.json(
		{
			ticket: ticket.ticket,
			expiresAt: ticket.expiresAt.toISOString(),
			incarnationKey: ticket.incarnationKey,
			effectiveMode: ticket.effectiveMode,
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

function handleTicketFailure(error: unknown): Response {
	if (error instanceof TypeError) throw error;
	return new Response(null, {
		status: 404,
		headers: { "cache-control": "no-store" },
	});
}

function rejected(): CrdtTicketRejectedError {
	return new CrdtTicketRejectedError();
}
