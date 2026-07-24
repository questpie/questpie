import { isIP } from "node:net";

import { Elysia } from "elysia";
import type {
	CrdtHostApplicationV1,
	CrdtHostSocketSessionV1,
} from "questpie/crdt";

const TICKET_BODY_LIMIT = 8 * 1024;
const SOCKET_PAYLOAD_LIMIT = 1024 * 1024;
const SOCKET_BACKPRESSURE_LIMIT = 4 * 1024 * 1024;
const AUTH_PAYLOAD_LIMIT = 512;
const UNAUTHENTICATED_TIMEOUT_MS = 5_000;
const UNAUTHENTICATED_GLOBAL_CAP = 256;
const UNAUTHENTICATED_IP_CAP = 5;

export type ElysiaCrdtTrustedProxyResolver = (
	input: Readonly<{
		request: Request;
		directClientIp: string;
	}>,
) => string | null;

export type ElysiaCrdtHostConfig = Readonly<{
	path?: `/${string}`;
	application: CrdtHostApplicationV1;
	resolveTrustedProxyClientIp?: ElysiaCrdtTrustedProxyResolver;
}>;

type SocketState = {
	ip: string;
	releaseAdmission: () => void;
	closePeer: (code: number, reason: string) => void;
	session?: CrdtHostSocketSessionV1;
	opening: Promise<CrdtHostSocketSessionV1>;
	authenticated: boolean;
	unauthenticatedFrames: number;
	timeout: ReturnType<typeof setTimeout>;
	closed: boolean;
};

export function createElysiaCrdtHost(config: ElysiaCrdtHostConfig) {
	if (config.application.protocol !== "QPCR/1.0") {
		throw new TypeError("Elysia CRDT host requires QPCR/1.0");
	}
	const path = normalizePath(config.path ?? "/crdt");
	const admission = createUnauthenticatedAdmission();
	const sockets = new Set<SocketState>();
	const states = new WeakMap<object, SocketState>();
	let stopping = false;

	const host = new Elysia({
		name: "questpie-crdt-host",
		websocket: {
			perMessageDeflate: false,
			maxPayloadLength: SOCKET_PAYLOAD_LIMIT,
			backpressureLimit: SOCKET_BACKPRESSURE_LIMIT,
			closeOnBackpressureLimit: true,
		},
	})
		.post(`${path}/ticket`, ({ request }) =>
			handleTicketRequest(request, config.application.handleTicket, stopping),
		)
		.post(`${path}/agent-ticket`, ({ request }) =>
			handleTicketRequest(
				request,
				config.application.handleAgentTicket,
				stopping,
			),
		)
		.ws(`${path}/socket`, {
			open(ws) {
				if (stopping) {
					ws.close(1012, "CRDT host stopping");
					return;
				}
				const request = ws.data.request;
				const directClientIp =
					ws.data.server?.requestIP(request)?.address ?? ws.remoteAddress;
				const ip = resolveClientIp(
					request,
					directClientIp,
					config.resolveTrustedProxyClientIp,
				);
				if (!ip) {
					ws.close(1008, "CRDT transport rejected");
					return;
				}
				const releaseAdmission = admission.tryAcquire(ip);
				if (!releaseAdmission) {
					ws.close(1013, "CRDT transport busy");
					return;
				}

				const state = {} as SocketState;
				state.ip = ip;
				state.releaseAdmission = releaseAdmission;
				state.closePeer = (code, reason) => ws.close(code, reason);
				state.authenticated = false;
				state.unauthenticatedFrames = 0;
				state.closed = false;
				state.timeout = setTimeout(() => {
					if (!state.authenticated && !state.closed) {
						ws.close(1008, "CRDT authentication timeout");
					}
				}, UNAUTHENTICATED_TIMEOUT_MS);
				state.opening = Promise.resolve(
					config.application.openSocket({
						request,
						clientIp: ip,
						peer: {
							send(data) {
								return ws.sendBinary(data, false) > 0;
							},
							close(code, reason) {
								ws.close(code, reason);
							},
						},
					}),
				).then(async (session) => {
					state.session = session;
					if (state.closed) {
						await session.close(1001, "CRDT socket closed during open");
					}
					return session;
				});
				state.opening.catch(() => {
					if (!state.closed) ws.close(1011, "CRDT transport unavailable");
				});
				states.set(ws.raw, state);
				sockets.add(state);
			},
			async message(ws, message) {
				const state = states.get(ws.raw);
				if (!state || state.closed) return;
				const data = binaryMessage(message);
				if (!data) {
					ws.close(1008, "CRDT binary frames required");
					return;
				}
				if (!state.authenticated) {
					if (
						state.unauthenticatedFrames !== 0 ||
						data.byteLength > AUTH_PAYLOAD_LIMIT
					) {
						ws.close(
							data.byteLength > AUTH_PAYLOAD_LIMIT ? 1009 : 1008,
							"CRDT authentication rejected",
						);
						return;
					}
					state.unauthenticatedFrames = 1;
				}
				try {
					const result = await (await state.opening).message(data);
					if (result.authenticated && !state.authenticated) {
						state.authenticated = true;
						clearTimeout(state.timeout);
						state.releaseAdmission();
					}
				} catch {
					ws.close(1008, "CRDT protocol rejected");
				}
			},
			async drain(ws) {
				const state = states.get(ws.raw);
				if (!state || state.closed) return;
				try {
					await (await state.opening).drain();
				} catch {
					ws.close(1011, "CRDT transport unavailable");
				}
			},
			async close(ws, code, reason) {
				const state = states.get(ws.raw);
				if (!state || state.closed) return;
				state.closed = true;
				clearTimeout(state.timeout);
				state.releaseAdmission();
				sockets.delete(state);
				try {
					await (await state.opening).close(code, reason);
				} catch {
					// The transport is already closed; application cleanup is best effort.
				}
			},
		})
		.onStop(async () => {
			if (stopping) return;
			stopping = true;
			await config.application.stop();
			for (const state of sockets) {
				state.closePeer(1012, "CRDT host stopping");
				state.closed = true;
				clearTimeout(state.timeout);
				state.releaseAdmission();
				try {
					await (await state.opening).close(1012, "CRDT host stopping");
				} catch {
					// Shutdown continues even when one application session fails cleanup.
				}
			}
			sockets.clear();
		});

	return host;
}

async function handleTicketRequest(
	request: Request,
	handle: (request: Request) => Promise<Response>,
	stopping: boolean,
): Promise<Response> {
	if (stopping) {
		return new Response(null, { status: 503 });
	}
	const bounded = await boundedRequest(request, TICKET_BODY_LIMIT);
	if (!bounded) {
		return new Response(null, { status: 413 });
	}
	return handle(bounded);
}

async function boundedRequest(
	request: Request,
	limit: number,
): Promise<Request | null> {
	const declared = request.headers.get("content-length");
	if (declared !== null) {
		const bytes = Number(declared);
		if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > limit) return null;
	}
	if (!request.body) return request;

	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let length = 0;
	try {
		for (;;) {
			const part = await reader.read();
			if (part.done) break;
			length += part.value.byteLength;
			if (length > limit) {
				await reader.cancel();
				return null;
			}
			chunks.push(part.value);
		}
	} finally {
		reader.releaseLock();
	}
	const body = new Uint8Array(length);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new Request(request.url, {
		method: "POST",
		headers: request.headers,
		body,
		signal: request.signal,
	});
}

function resolveClientIp(
	request: Request,
	directClientIp: string | undefined,
	resolver: ElysiaCrdtTrustedProxyResolver | undefined,
): string | null {
	if (!directClientIp || isIP(directClientIp) === 0) return null;
	if (!resolver) return directClientIp;
	const resolved = resolver({ request, directClientIp });
	return resolved && isIP(resolved) !== 0 ? resolved : null;
}

function createUnauthenticatedAdmission() {
	let total = 0;
	const byIp = new Map<string, number>();
	return {
		tryAcquire(ip: string): (() => void) | null {
			const ipCount = byIp.get(ip) ?? 0;
			if (
				total >= UNAUTHENTICATED_GLOBAL_CAP ||
				ipCount >= UNAUTHENTICATED_IP_CAP
			) {
				return null;
			}
			total += 1;
			byIp.set(ip, ipCount + 1);
			let released = false;
			return () => {
				if (released) return;
				released = true;
				total -= 1;
				const next = (byIp.get(ip) ?? 1) - 1;
				if (next === 0) byIp.delete(ip);
				else byIp.set(ip, next);
			};
		},
	};
}

function normalizePath(path: `/${string}`): `/${string}` {
	if (
		path === "/" ||
		path.length > 256 ||
		path.endsWith("/") ||
		path.includes("//") ||
		path.includes("?") ||
		path.includes("#") ||
		path.split("/").some((segment) => segment === "." || segment === "..")
	) {
		throw new TypeError("Invalid Elysia CRDT host path");
	}
	return path;
}

function binaryMessage(value: unknown): Uint8Array | null {
	if (value instanceof ArrayBuffer) return new Uint8Array(value);
	if (!ArrayBuffer.isView(value)) return null;
	return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}
