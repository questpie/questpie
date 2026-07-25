import {
	CRDT_EXCHANGE_V1_CONTENT_TYPE,
	CRDT_EXCHANGE_V1_MAX_BODY_BYTES,
	type CrdtExchangeRequestFrameV1,
	type CrdtExchangeResponseFrameV1,
	decodeCrdtExchangeFrameV1,
	encodeCrdtExchangeFrameV1,
} from "#questpie/shared/crdt-exchange.js";

import {
	CrdtConnectError,
	type CrdtClientAuthorizedManifestOwner,
	type CrdtClientExchangePort,
	type CrdtClientHostConfig,
	type CrdtClientOpenedSession,
} from "./types.js";

const OPEN_RESPONSE_MAX_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;

export function createCrdtHttpExchangeClient(
	config: CrdtClientHostConfig,
	/** @internal Test-only deadline override; not exposed through client config. */
	internal: Readonly<{ requestTimeoutMs?: number }> = {},
): CrdtClientExchangePort {
	const root = `${config.baseURL.replace(/\/+$/, "")}${config.basePath}/realtime/crdt`;
	const requestTimeoutMs = internal.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
	if (
		!Number.isSafeInteger(requestTimeoutMs) ||
		requestTimeoutMs < 1 ||
		requestTimeoutMs > 60_000
	) {
		throw new TypeError("Invalid CRDT HTTP request timeout");
	}

	return Object.freeze({
		async open(
			input: Parameters<CrdtClientExchangePort["open"]>[0],
		): Promise<CrdtClientOpenedSession> {
			const body = JSON.stringify({
				openId: input.openId,
				...(input.replacesBindingId
					? { replacesBindingId: input.replacesBindingId }
					: {}),
				owner: input.owner,
				mode: input.mode,
				...(input.fallback ? { fallback: input.fallback } : {}),
				edgeSessionId: input.edgeSessionId,
			});
			let lastError: unknown;
			for (let attempt = 0; attempt < 2; attempt++) {
				try {
					return await withRequestDeadline(
						input.signal,
						requestTimeoutMs,
						async (signal) => {
							const headers = await config.getAuthHeaders?.();
							const response = await config.fetcher(`${root}/open`, {
								method: "POST",
								credentials: "include",
								headers: {
									...config.defaultHeaders,
									...headers,
									"content-type": "application/json",
									"x-questpie-realtime-token": input.edgeToken,
								},
								body,
								signal,
							});
							const bytes = await readBoundedResponse(
								response,
								OPEN_RESPONSE_MAX_BYTES,
								signal,
							);
							if (response.status === 404) {
								throw new CrdtConnectError("CRDT_UNAVAILABLE");
							}
							if (response.status !== 201) {
								throw new CrdtHttpProtocolError();
							}
							if (
								response.headers
									.get("content-type")
									?.split(";", 1)[0]
									?.trim() !== "application/json"
							) {
								throw new CrdtHttpProtocolError();
							}
							return parseOpenedSession(bytes);
						},
					);
				} catch (error) {
					lastError = error;
					if (
						attempt > 0 ||
						error instanceof CrdtConnectError ||
						error instanceof CrdtHttpProtocolError ||
						error instanceof CrdtHttpRecoveryError ||
						isAbort(error, input.signal)
					) {
						throw error;
					}
				}
			}
			throw lastError;
		},

		async exchange(
			frame: CrdtExchangeRequestFrameV1,
			signal?: AbortSignal,
		): Promise<CrdtExchangeResponseFrameV1> {
			const request = encodeCrdtExchangeFrameV1(frame);
			const body = new ArrayBuffer(request.byteLength);
			new Uint8Array(body).set(request);
			return withRequestDeadline(
				signal,
				requestTimeoutMs,
				async (requestSignal) => {
					const headers = await config.getAuthHeaders?.();
					const response = await config.fetcher(`${root}/exchange`, {
						method: "POST",
						credentials: "include",
						headers: {
							...config.defaultHeaders,
							...headers,
							"content-type": CRDT_EXCHANGE_V1_CONTENT_TYPE,
						},
						body,
						signal: requestSignal,
					});
					if (
						response.headers.get("content-type")?.split(";", 1)[0]?.trim() !==
						CRDT_EXCHANGE_V1_CONTENT_TYPE
					) {
						await response.body?.cancel().catch(() => {});
						throw new CrdtHttpProtocolError();
					}
					const bytes = await readBoundedResponse(
						response,
						CRDT_EXCHANGE_V1_MAX_BODY_BYTES,
						requestSignal,
					);
					const decoded = decodeCrdtExchangeFrameV1(bytes);
					if (
						decoded.opcode < 0x81 ||
						!equalBytes(decoded.requestId, frame.requestId)
					) {
						throw new CrdtHttpProtocolError();
					}
					const result = decoded as CrdtExchangeResponseFrameV1;
					if (
						(response.status === 200 &&
							result.opcode !== 0xfe &&
							result.opcode !== 0xff) ||
						(response.status === 409 && result.opcode === 0xfe) ||
						(response.status === 404 && result.opcode === 0xff)
					) {
						return result;
					}
					throw new CrdtHttpProtocolError();
				},
			);
		},
	});
}

export class CrdtHttpProtocolError extends Error {
	constructor() {
		super("Invalid CRDT HTTP response");
		this.name = "CrdtHttpProtocolError";
	}
}

export class CrdtHttpRecoveryError extends Error {
	constructor() {
		super("CRDT recovery required");
		this.name = "CrdtHttpRecoveryError";
	}
}

function parseOpenedSession(bytes: Uint8Array): CrdtClientOpenedSession {
	let value: unknown;
	try {
		value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
	} catch {
		throw new CrdtHttpProtocolError();
	}
	if (!plainRecord(value)) throw new CrdtHttpProtocolError();
	const keys = Object.keys(value).sort();
	const expected = [
		"bindingId",
		"deliveryGeneration",
		"deploymentFingerprint",
		"effectiveMode",
		"incarnationKey",
		"initialPull",
		"leaseExpiresAt",
		"manifest",
		"namespace",
		"offlineSubjectKey",
		"protocol",
		"sessionGeneration",
		"version",
	].sort();
	if (
		keys.length !== expected.length ||
		keys.some((key, index) => key !== expected[index]) ||
		value.protocol !== "questpie-crdt-http" ||
		value.version !== 1 ||
		!boundedAscii(value.namespace, 64) ||
		!boundedAscii(value.deploymentFingerprint, 128) ||
		typeof value.bindingId !== "string" ||
		!isUuid(value.bindingId) ||
		!nonnegativeU64(value.sessionGeneration) ||
		!nonnegativeU64(value.deliveryGeneration) ||
		typeof value.leaseExpiresAt !== "string" ||
		!canonicalDate(value.leaseExpiresAt) ||
		typeof value.incarnationKey !== "string" ||
		!isUuid(value.incarnationKey) ||
		(value.effectiveMode !== "view" && value.effectiveMode !== "edit") ||
		typeof value.offlineSubjectKey !== "string" ||
		!/^[A-Za-z0-9_-]{43}$/.test(value.offlineSubjectKey) ||
		!isClientManifest(value.manifest) ||
		!plainRecord(value.initialPull) ||
		Object.keys(value.initialPull).length !== 2 ||
		value.initialPull.operation !== "pull" ||
		value.initialPull.continuation !== null
	) {
		throw new CrdtHttpProtocolError();
	}
	return Object.freeze({
		protocol: value.protocol,
		version: value.version,
		namespace: value.namespace,
		deploymentFingerprint: value.deploymentFingerprint,
		bindingId: value.bindingId,
		bindingIdBytes: uuidToBytes(value.bindingId),
		sessionGeneration: BigInt(value.sessionGeneration),
		deliveryGeneration: BigInt(value.deliveryGeneration),
		leaseExpiresAt: value.leaseExpiresAt,
		incarnationKey: value.incarnationKey,
		effectiveMode: value.effectiveMode,
		offlineSubjectKey: value.offlineSubjectKey,
		manifest: freezeManifest(value.manifest),
	});
}

function isClientManifest(
	value: unknown,
): value is CrdtClientAuthorizedManifestOwner {
	if (
		!plainRecord(value) ||
		Object.keys(value).length !== 4 ||
		!Number.isSafeInteger(value.schemaVersion) ||
		(value.schemaVersion as number) < 0 ||
		(value.schemaVersion as number) > 0xffff_ffff ||
		typeof value.schemaFingerprint !== "string" ||
		!/^[A-Za-z0-9_-]{43}$/.test(value.schemaFingerprint) ||
		typeof value.awarenessEnabled !== "boolean" ||
		!plainRecord(value.fields)
	) {
		return false;
	}
	const slots = new Set<number>();
	const entries = Object.entries(value.fields);
	if (entries.length === 0 || entries.length > 32) return false;
	return entries.every(([key, field]) => {
		if (
			key.length === 0 ||
			key.length > 128 ||
			!plainRecord(field) ||
			Object.keys(field).length !== 5 ||
			!Number.isSafeInteger(field.fieldSlot) ||
			(field.fieldSlot as number) < 1 ||
			(field.fieldSlot as number) > 0xffff ||
			slots.has(field.fieldSlot as number) ||
			(field.format !== "text" && field.format !== "set") ||
			!Number.isSafeInteger(field.formatVersion) ||
			(field.formatVersion as number) < 0 ||
			(field.formatVersion as number) > 0xffff ||
			typeof field.engineId !== "string" ||
			field.engineId.length === 0 ||
			field.engineId.length > 128 ||
			(field.grant !== "view" && field.grant !== "edit")
		) {
			return false;
		}
		slots.add(field.fieldSlot as number);
		return true;
	});
}

function freezeManifest(
	value: CrdtClientAuthorizedManifestOwner,
): CrdtClientAuthorizedManifestOwner {
	return Object.freeze({
		schemaVersion: value.schemaVersion,
		schemaFingerprint: value.schemaFingerprint,
		awarenessEnabled: value.awarenessEnabled,
		fields: Object.freeze(
			Object.fromEntries(
				Object.entries(value.fields).map(([key, field]) => [
					key,
					Object.freeze({ ...field }),
				]),
			),
		),
	});
}

async function withRequestDeadline<T>(
	parent: AbortSignal | undefined,
	timeoutMs: number,
	run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
	const controller = new AbortController();
	const abort = () => controller.abort(parent?.reason);
	if (parent?.aborted) abort();
	else parent?.addEventListener("abort", abort, { once: true });
	const timeout = globalThis.setTimeout(
		() =>
			controller.abort(
				new DOMException("CRDT request timed out", "TimeoutError"),
			),
		timeoutMs,
	);
	let rejectAbort!: (reason?: unknown) => void;
	const aborted = new Promise<never>((_resolve, reject) => {
		rejectAbort = reject;
	});
	const rejectOnAbort = () =>
		rejectAbort(
			controller.signal.reason ??
				new DOMException("CRDT request aborted", "AbortError"),
		);
	if (controller.signal.aborted) rejectOnAbort();
	else
		controller.signal.addEventListener("abort", rejectOnAbort, { once: true });
	try {
		return await Promise.race([run(controller.signal), aborted]);
	} finally {
		globalThis.clearTimeout(timeout);
		parent?.removeEventListener("abort", abort);
		controller.signal.removeEventListener("abort", rejectOnAbort);
	}
}

async function readBoundedResponse(
	response: Response,
	maximumBytes: number,
	signal?: AbortSignal,
): Promise<Uint8Array> {
	const declared = response.headers.get("content-length");
	if (
		declared !== null &&
		(!/^(0|[1-9][0-9]*)$/.test(declared) || Number(declared) > maximumBytes)
	) {
		throw new CrdtHttpProtocolError();
	}
	if (!response.body) return new Uint8Array();
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let length = 0;
	const abort = () => void reader.cancel(signal?.reason).catch(() => {});
	signal?.addEventListener("abort", abort, { once: true });
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			length += value.byteLength;
			if (length > maximumBytes) {
				await reader.cancel().catch(() => {});
				throw new CrdtHttpProtocolError();
			}
			chunks.push(value);
		}
	} finally {
		signal?.removeEventListener("abort", abort);
		reader.releaseLock();
	}
	const output = new Uint8Array(length);
	let offset = 0;
	for (const chunk of chunks) {
		output.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return output;
}

function plainRecord(value: unknown): value is Record<string, unknown> {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		Object.getPrototypeOf(value) === Object.prototype
	);
}

function boundedAscii(value: unknown, maximum: number): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= maximum &&
		/^[!-~]+$/.test(value)
	);
}

function nonnegativeU64(value: unknown): value is string {
	if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value))
		return false;
	const parsed = BigInt(value);
	return parsed <= 0xffff_ffff_ffff_ffffn;
}

function canonicalDate(value: string): boolean {
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function isUuid(value: string): boolean {
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
		value,
	);
}

function uuidToBytes(value: string): Uint8Array {
	const hex = value.replaceAll("-", "");
	const bytes = new Uint8Array(16);
	for (let index = 0; index < bytes.length; index++) {
		bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
	}
	return bytes;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
	if (left.byteLength !== right.byteLength) return false;
	let difference = 0;
	for (let index = 0; index < left.byteLength; index++) {
		difference |= left[index]! ^ right[index]!;
	}
	return difference === 0;
}

function isAbort(error: unknown, signal?: AbortSignal): boolean {
	return (
		signal?.aborted === true ||
		(error instanceof DOMException && error.name === "AbortError")
	);
}
