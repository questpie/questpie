import type { Principal } from "#questpie/server/config/context.js";
import {
	CRDT_EXCHANGE_V1_CONTENT_TYPE,
	CRDT_EXCHANGE_V1_MAX_BODY_BYTES,
	type CrdtExchangeRequestFrameV1,
	type CrdtExchangeResponseFrameV1,
	decodeCrdtExchangeFrameV1,
	encodeCrdtExchangeFrameV1,
	encodeStoredCrdtExchangeResponseV1,
} from "#questpie/shared/crdt-exchange.js";

import {
	createAgentCrdtAuthentication,
	createHumanCrdtAuthentication,
	type CrdtAuthentication,
	type VerifiedAgentCredential,
} from "./authority.js";
import type {
	CrdtAuthorizationInputV1,
	CrdtAuthorizationSnapshot,
} from "./authorization.js";
import { canonicalizeCrdtBrowserOrigin } from "./origin.js";
import type { CrdtPresenceSourceV1 } from "./presence-store.js";
import {
	CrdtPullBusyError,
	type CrdtPullRequestV1,
	type CrdtStoredPullPageV1,
} from "./pull-store.js";
import type { CrdtExchangeSessionClaim } from "./session-authority.js";
import type { CrdtSyncAuthorityBasis, CrdtSyncSource } from "./sync.js";

export type CrdtExchangeApplicationConfigV1 = Readonly<{
	namespace: string;
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
	inspectSession(input: {
		bindingId: string;
		sessionGeneration: bigint;
		deliveryGeneration: bigint;
		allowClosed: boolean;
	}): Promise<CrdtExchangeSessionClaim>;
	authorize(
		input: Extract<CrdtAuthorizationInputV1, { purpose: "exchange" }>,
	): Promise<CrdtAuthorizationSnapshot>;
	validateAuthority(
		claim: CrdtExchangeSessionClaim,
		authorization: CrdtAuthorizationSnapshot,
		options: { allowClosed: boolean },
	): Promise<void>;
	pull(input: CrdtPullRequestV1): Promise<CrdtStoredPullPageV1>;
	sync: CrdtSyncSource;
	presence: CrdtPresenceSourceV1;
	maximumConcurrentRequests?: number;
	maximumConcurrentPulls?: number;
}>;

export function createCrdtExchangeApplicationV1(
	config: CrdtExchangeApplicationConfigV1,
) {
	const requests = createAdmissionGate(config.maximumConcurrentRequests ?? 64);
	const bodies = createAdmissionGate(config.maximumConcurrentRequests ?? 64);
	const pulls = createAdmissionGate(config.maximumConcurrentPulls ?? 2);
	return Object.freeze({
		async handle(request: Request): Promise<Response> {
			let frame: CrdtExchangeRequestFrameV1 | undefined;
			let releaseBody: (() => void) | undefined;
			let releaseRequest: (() => void) | undefined;
			let releasePull: (() => void) | undefined;
			try {
				if (request.method !== "POST") throw new Error();
				releaseBody = bodies.acquire();
				const bytes = await readCrdtExchangeBodyV1(request);
				const decoded = decodeCrdtExchangeFrameV1(bytes);
				if (decoded.opcode < 1 || decoded.opcode > 6) throw new Error();
				frame = decoded as CrdtExchangeRequestFrameV1;

				const allowClosed = frame.opcode === 0x06;
				const { authentication, origin } = await authenticate(config, request);
				releaseRequest = requests.acquire();
				releaseBody();
				releaseBody = undefined;
				const claim = await config.inspectSession({
					bindingId: bytesToUuid(frame.payload.bindingId),
					sessionGeneration: frame.payload.sessionGeneration,
					deliveryGeneration: frame.payload.deliveryGeneration,
					allowClosed,
				});
				assertOperationMode(frame, claim, authentication);
				const authorization = await config.authorize({
					purpose: "exchange",
					request,
					authentication,
					resourceId: claim.resourceId,
					requestedMode: claim.requestedMode,
					effectiveMode: claim.effectiveMode,
					origin,
					audience: config.audience,
				});
				assertAuthorizationBinding(config, claim, authorization, origin);
				await config.validateAuthority(claim, authorization, {
					allowClosed,
				});
				if (frame.opcode === 0x01) releasePull = pulls.acquire();
				const response = await execute(
					config,
					frame,
					claim,
					authorization,
					request.signal,
				);
				if ("payloadBytes" in response) {
					return binaryResponse(
						encodeStoredCrdtExchangeResponseV1(
							response.opcode,
							frame.requestId,
							response.payloadBytes,
						),
						200,
					);
				}
				return binaryResponse(
					encodeCrdtExchangeFrameV1({
						major: 1,
						minor: 0,
						requestId: frame.requestId,
						opcode: response.opcode,
						payload: response.payload,
					} as CrdtExchangeResponseFrameV1),
					200,
				);
			} catch (error) {
				if (frame) {
					const response: CrdtExchangeResponseFrameV1 =
						error instanceof CrdtPullBusyError ||
						error instanceof CrdtExchangeBusyError
							? {
									major: 1,
									minor: 0,
									opcode: 0xfe,
									requestId: frame.requestId,
									payload: {
										retryAfterMs:
											error instanceof CrdtPullBusyError
												? error.retryAfterMs
												: 250,
									},
								}
							: {
									major: 1,
									minor: 0,
									opcode: 0xff,
									requestId: frame.requestId,
									payload: { action: 1 },
								};
					return binaryResponse(
						encodeCrdtExchangeFrameV1(response),
						response.opcode === 0xfe ? 409 : 404,
					);
				}
				return unavailableResponse();
			} finally {
				releasePull?.();
				releaseRequest?.();
				releaseBody?.();
			}
		},
	});
}

async function execute(
	config: CrdtExchangeApplicationConfigV1,
	frame: CrdtExchangeRequestFrameV1,
	claim: CrdtExchangeSessionClaim,
	authorization: CrdtAuthorizationSnapshot,
	signal: AbortSignal,
): Promise<
	| { opcode: 0x81; payloadBytes: Uint8Array }
	| {
			opcode: Exclude<CrdtExchangeResponseFrameV1["opcode"], 0x81>;
			payload: CrdtExchangeResponseFrameV1["payload"];
	  }
> {
	switch (frame.opcode) {
		case 0x01: {
			const page = await config.pull({
				claim,
				authorization,
				pullId: bytesToUuid(frame.payload.pullId),
				schemaVersion: frame.payload.schemaVersion,
				continuation: frame.payload.continuation,
				proofs: frame.payload.proofs,
				signal,
			});
			return { opcode: page.opcode, payloadBytes: page.payload };
		}
		case 0x02: {
			const basis = await captureExactAuthorityBasis(config.sync, claim);
			const receipt = await config.sync.submitUpdate?.(basis, {
				updateId: frame.payload.updateId,
				aggregateEpoch: frame.payload.aggregateEpoch,
				schemaVersion: frame.payload.schemaVersion,
				parts: frame.payload.parts,
			});
			if (!receipt) throw new Error();
			return {
				opcode: 0x82,
				payload: {
					updateId: receipt.updateId,
					aggregateEpoch: basis.aggregateEpoch,
					cursors: receipt.cursors,
				},
			};
		}
		case 0x03: {
			const basis = await captureExactAuthorityBasis(config.sync, claim);
			const receipts = await config.sync.reconcileReceipts?.(
				basis,
				frame.payload.receipts,
			);
			if (!receipts) throw new Error();
			return {
				opcode: 0x83,
				payload: {
					receipts: receipts.map((receipt) => ({
						updateId: receipt.updateId,
						aggregateEpoch: basis.aggregateEpoch,
						cursors: receipt.cursors,
					})),
				},
			};
		}
		case 0x04: {
			const value =
				frame.payload.action === "write"
					? await config.presence.writeAwareness(
							claim.sessionId,
							frame.payload.value,
							{ claim, authorization },
						)
					: frame.payload.action === "clear"
						? await config.presence.writeAwareness(
								claim.sessionId,
								{
									v: 1,
									kind: "awareness-clear",
								},
								{ claim, authorization },
							)
						: await config.presence.projectRoster(claim.sessionId, {
								claim,
								authorization,
							});
			return { opcode: 0x84, payload: { value } };
		}
		case 0x05:
			return {
				opcode: 0x85,
				payload: {
					serverTimeMs: await config.presence.heartbeat(claim.sessionId, {
						claim,
						authorization,
					}),
				},
			};
		case 0x06:
			await config.presence.close(claim.sessionId, {
				claim,
				authorization,
			});
			return { opcode: 0x86, payload: {} };
	}
}

async function captureExactAuthorityBasis(
	source: CrdtSyncSource,
	claim: CrdtExchangeSessionClaim,
): Promise<CrdtSyncAuthorityBasis> {
	const basis = await source.captureAuthorityBasis(claim.sessionId);
	if (
		basis.bindingId !== claim.bindingId ||
		basis.sessionGeneration !== claim.sessionGeneration ||
		basis.deliveryGeneration !== claim.deliveryGeneration
	) {
		throw new Error();
	}
	return basis;
}

async function authenticate(
	config: CrdtExchangeApplicationConfigV1,
	request: Request,
): Promise<{ authentication: CrdtAuthentication; origin: string | null }> {
	if (request.headers.has("cookie") && request.headers.has("authorization")) {
		throw new Error();
	}
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
			origin,
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
	return {
		authentication: createAgentCrdtAuthentication(credential),
		origin: null,
	};
}

function assertOperationMode(
	frame: CrdtExchangeRequestFrameV1,
	claim: CrdtExchangeSessionClaim,
	authentication: CrdtAuthentication,
): void {
	if (
		frame.opcode === 0x02 &&
		(claim.effectiveMode !== "edit" ||
			(authentication.actor.kind === "agent" &&
				!authentication.actor.scopes.includes("crdt:edit")))
	) {
		throw new Error();
	}
}

function assertAuthorizationBinding(
	config: CrdtExchangeApplicationConfigV1,
	claim: CrdtExchangeSessionClaim,
	authorization: CrdtAuthorizationSnapshot,
	origin: string | null,
): void {
	if (
		authorization.resourceId !== claim.resourceId ||
		authorization.origin !== origin ||
		authorization.audience !== config.audience ||
		authorization.requestedMode !== claim.requestedMode ||
		authorization.effectiveMode !== claim.effectiveMode ||
		authorization.sessionGeneration !== claim.sessionGeneration
	) {
		throw new Error();
	}
}

export async function readCrdtExchangeBodyV1(
	request: Request,
): Promise<Uint8Array> {
	if (request.headers.has("content-encoding")) throw new Error();
	if (
		request.headers.get("content-type")?.split(";", 1)[0]?.trim() !==
		CRDT_EXCHANGE_V1_CONTENT_TYPE
	) {
		throw new Error();
	}
	const declaredValue = request.headers.get("content-length");
	let declared: number | null = null;
	if (declaredValue !== null) {
		if (!/^(0|[1-9][0-9]*)$/.test(declaredValue)) throw new Error();
		declared = Number(declaredValue);
		if (
			!Number.isSafeInteger(declared) ||
			declared < 1 ||
			declared > CRDT_EXCHANGE_V1_MAX_BODY_BYTES
		) {
			throw new Error();
		}
	}
	if (!request.body) throw new Error();
	const reader = request.body.getReader();
	let output = new Uint8Array(
		declared ?? Math.min(4096, CRDT_EXCHANGE_V1_MAX_BODY_BYTES),
	);
	let size = 0;
	try {
		while (true) {
			const { done, value } = await readWithAbort(reader, request.signal);
			if (done) break;
			if (value.byteLength === 0) continue;
			const nextSize = size + value.byteLength;
			if (
				nextSize > CRDT_EXCHANGE_V1_MAX_BODY_BYTES ||
				(declared !== null && nextSize > declared)
			) {
				throw new Error();
			}
			if (nextSize > output.byteLength) {
				let capacity = output.byteLength;
				while (capacity < nextSize) {
					capacity = Math.min(
						CRDT_EXCHANGE_V1_MAX_BODY_BYTES,
						Math.max(capacity * 2, nextSize),
					);
				}
				const grown = new Uint8Array(capacity);
				grown.set(output.subarray(0, size));
				output = grown;
			}
			output.set(value, size);
			size = nextSize;
		}
	} catch (error) {
		void reader.cancel(error).catch(() => {});
		throw error;
	}
	if (declared !== null && size !== declared) throw new Error();
	return output.slice(0, size);
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

function binaryResponse(body: Uint8Array, status: number): Response {
	const bytes = body.slice();
	return new Response(bytes.buffer as ArrayBuffer, {
		status,
		headers: {
			"cache-control": "no-store",
			pragma: "no-cache",
			"content-type": CRDT_EXCHANGE_V1_CONTENT_TYPE,
			"x-content-type-options": "nosniff",
		},
	});
}

function unavailableResponse(): Response {
	return Response.json(
		{ error: { code: "CRDT_UNAVAILABLE", message: "CRDT unavailable" } },
		{ status: 404, headers: { "cache-control": "no-store" } },
	);
}

function createAdmissionGate(maximum: number) {
	if (!Number.isSafeInteger(maximum) || maximum < 1) {
		throw new TypeError("CRDT exchange concurrency must be positive");
	}
	let active = 0;
	return Object.freeze({
		acquire(): () => void {
			if (active >= maximum) throw new CrdtExchangeBusyError();
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

class CrdtExchangeBusyError extends Error {}

function parseBearer(value: string | null): string {
	if (!value || !/^Bearer [!-~]{1,4096}$/.test(value)) throw new Error();
	const token = value.slice(7);
	if (token.includes(" ") || token.includes(",")) throw new Error();
	return token;
}

function bytesToUuid(bytes: Uint8Array): string {
	if (bytes.byteLength !== 16) throw new Error();
	const hex = [...bytes]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
