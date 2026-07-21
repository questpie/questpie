const ADMISSION_VERSION = "qpsa1";
const MINIMUM_SECRET_BYTES = 32;
const MAXIMUM_ADMISSION_TTL_MS = 5_000;

export interface AgentWorkloadSandboxAdmissionClaims {
	readonly kind: "agent_workload_sandbox_admission";
	readonly version: 1;
	readonly admissionId: string;
	readonly principalId: string;
	readonly runId: string;
	readonly attemptId: string;
	readonly workRequestId: string;
	readonly companyId: string;
	readonly anchorSpaceId: string;
	readonly agentActorId: string;
	readonly skillRevisionId: string;
	readonly executionPolicyRevisionId: string;
	readonly sourceSha256: string;
	readonly inputProjectionId: string;
	readonly grantEpoch: number;
	readonly revocationEpoch: number;
	readonly workerId: string;
	readonly workerLeaseId: string;
	readonly workerLeaseEpoch: number;
	readonly supervisorInstanceId: string;
	readonly expiresAt: string;
	readonly requestSha256: string;
}

export interface AgentWorkloadSandboxAdmissionKey {
	readonly keyId: string;
	readonly secret: Uint8Array;
	/** Unique per supervisor process; rotate on every restart. */
	readonly instanceId: string;
}

export type AgentWorkloadSandboxAdmissionDenialReason =
	| "invalid"
	| "wrong_instance"
	| "expired"
	| "body_mismatch";

export type AgentWorkloadSandboxAdmissionVerification =
	| {
			readonly ok: true;
			readonly claims: AgentWorkloadSandboxAdmissionClaims;
	  }
	| {
			readonly ok: false;
			readonly reason: AgentWorkloadSandboxAdmissionDenialReason;
			readonly claims?: AgentWorkloadSandboxAdmissionClaims;
	  };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function encodeBase64Url(value: Uint8Array): string {
	let binary = "";
	for (const byte of value) binary += String.fromCharCode(byte);
	return btoa(binary)
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replace(/=+$/, "");
}

function decodeBase64Url(value: string): Uint8Array | null {
	try {
		const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
		const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
		const binary = atob(padded);
		return Uint8Array.from(binary, (character) => character.charCodeAt(0));
	} catch {
		return null;
	}
}

async function importHmacKey(
	key: AgentWorkloadSandboxAdmissionKey,
	usage: "sign" | "verify",
): Promise<CryptoKey> {
	if (
		key.keyId.length === 0 ||
		!isIdentity(key.instanceId) ||
		key.secret.byteLength < MINIMUM_SECRET_BYTES
	) {
		throw new Error("Invalid Agent workload sandbox admission configuration.");
	}
	return crypto.subtle.importKey(
		"raw",
		Uint8Array.from(key.secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		[usage],
	);
}

async function sha256(value: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
	return [...new Uint8Array(digest)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

export function hashAgentWorkloadSandboxSource(
	source: string,
): Promise<string> {
	return sha256(source);
}

function exactKeys(value: object, keys: readonly string[]): boolean {
	const actual = Object.keys(value).sort();
	const expected = [...keys].sort();
	return (
		actual.length === expected.length &&
		actual.every((key, index) => key === expected[index])
	);
}

function isIdentity(value: unknown): value is string {
	return typeof value === "string" && /^[A-Za-z0-9_-]+$/.test(value);
}

function parseClaims(
	value: unknown,
): AgentWorkloadSandboxAdmissionClaims | null {
	if (
		typeof value !== "object" ||
		value === null ||
		Array.isArray(value) ||
		!exactKeys(value, [
			"kind",
			"version",
			"admissionId",
			"principalId",
			"runId",
			"attemptId",
			"workRequestId",
			"companyId",
			"anchorSpaceId",
			"agentActorId",
			"skillRevisionId",
			"executionPolicyRevisionId",
			"sourceSha256",
			"inputProjectionId",
			"grantEpoch",
			"revocationEpoch",
			"workerId",
			"workerLeaseId",
			"workerLeaseEpoch",
			"supervisorInstanceId",
			"expiresAt",
			"requestSha256",
		])
	) {
		return null;
	}
	const claims = value as Record<string, unknown>;
	if (
		claims.kind !== "agent_workload_sandbox_admission" ||
		claims.version !== 1 ||
		!isIdentity(claims.admissionId) ||
		!isIdentity(claims.principalId) ||
		!isIdentity(claims.runId) ||
		!isIdentity(claims.attemptId) ||
		!isIdentity(claims.workRequestId) ||
		!isIdentity(claims.companyId) ||
		!isIdentity(claims.anchorSpaceId) ||
		!isIdentity(claims.agentActorId) ||
		!isIdentity(claims.skillRevisionId) ||
		!isIdentity(claims.executionPolicyRevisionId) ||
		typeof claims.sourceSha256 !== "string" ||
		!/^[a-f0-9]{64}$/.test(claims.sourceSha256) ||
		!isIdentity(claims.inputProjectionId) ||
		typeof claims.grantEpoch !== "number" ||
		!Number.isSafeInteger(claims.grantEpoch) ||
		claims.grantEpoch < 0 ||
		typeof claims.revocationEpoch !== "number" ||
		!Number.isSafeInteger(claims.revocationEpoch) ||
		claims.revocationEpoch < 0 ||
		!isIdentity(claims.workerId) ||
		!isIdentity(claims.workerLeaseId) ||
		!isIdentity(claims.supervisorInstanceId) ||
		typeof claims.workerLeaseEpoch !== "number" ||
		!Number.isSafeInteger(claims.workerLeaseEpoch) ||
		claims.workerLeaseEpoch < 0 ||
		typeof claims.expiresAt !== "string" ||
		!Number.isFinite(Date.parse(claims.expiresAt)) ||
		typeof claims.requestSha256 !== "string" ||
		!/^[a-f0-9]{64}$/.test(claims.requestSha256)
	) {
		return null;
	}
	return claims as unknown as AgentWorkloadSandboxAdmissionClaims;
}

export async function sealAgentWorkloadSandboxAdmission(
	key: AgentWorkloadSandboxAdmissionKey,
	claims: Omit<AgentWorkloadSandboxAdmissionClaims, "requestSha256">,
	requestBody: string,
): Promise<string> {
	const payload: AgentWorkloadSandboxAdmissionClaims = {
		...claims,
		requestSha256: await sha256(requestBody),
	};
	const encodedKeyId = encodeBase64Url(encoder.encode(key.keyId));
	const encodedPayload = encodeBase64Url(
		encoder.encode(JSON.stringify(payload)),
	);
	const signed = `${ADMISSION_VERSION}.${encodedKeyId}.${encodedPayload}`;
	const cryptoKey = await importHmacKey(key, "sign");
	const signature = await crypto.subtle.sign(
		"HMAC",
		cryptoKey,
		encoder.encode(signed),
	);
	return `${signed}.${encodeBase64Url(new Uint8Array(signature))}`;
}

export async function verifyAgentWorkloadSandboxAdmission(
	key: AgentWorkloadSandboxAdmissionKey,
	envelope: string,
	requestBody: string,
	now = new Date(),
): Promise<AgentWorkloadSandboxAdmissionVerification> {
	const parts = envelope.split(".");
	if (parts.length !== 4 || parts[0] !== ADMISSION_VERSION)
		return { ok: false, reason: "invalid" };
	const encodedKeyId = encodeBase64Url(encoder.encode(key.keyId));
	if (parts[1] !== encodedKeyId) return { ok: false, reason: "invalid" };
	const signature = decodeBase64Url(parts[3]);
	if (!signature) return { ok: false, reason: "invalid" };
	const signed = `${parts[0]}.${parts[1]}.${parts[2]}`;
	const cryptoKey = await importHmacKey(key, "verify");
	if (
		!(await crypto.subtle.verify(
			"HMAC",
			cryptoKey,
			Uint8Array.from(signature),
			encoder.encode(signed),
		))
	) {
		return { ok: false, reason: "invalid" };
	}
	const encodedPayload = decodeBase64Url(parts[2]);
	if (!encodedPayload) return { ok: false, reason: "invalid" };
	let decoded: unknown;
	try {
		decoded = JSON.parse(decoder.decode(encodedPayload));
	} catch {
		return { ok: false, reason: "invalid" };
	}
	const claims = parseClaims(decoded);
	if (!claims) return { ok: false, reason: "invalid" };
	const frozenClaims = Object.freeze(claims);
	if (claims.supervisorInstanceId !== key.instanceId) {
		return { ok: false, reason: "wrong_instance", claims: frozenClaims };
	}
	const expiresAt = Date.parse(claims.expiresAt);
	if (
		expiresAt <= now.getTime() ||
		expiresAt > now.getTime() + MAXIMUM_ADMISSION_TTL_MS
	) {
		return { ok: false, reason: "expired", claims: frozenClaims };
	}
	if (claims.requestSha256 !== (await sha256(requestBody))) {
		return { ok: false, reason: "body_mismatch", claims: frozenClaims };
	}
	return { ok: true, claims: frozenClaims };
}

export async function openAgentWorkloadSandboxAdmission(
	key: AgentWorkloadSandboxAdmissionKey,
	envelope: string,
	requestBody: string,
	now = new Date(),
): Promise<AgentWorkloadSandboxAdmissionClaims | null> {
	const verification = await verifyAgentWorkloadSandboxAdmission(
		key,
		envelope,
		requestBody,
		now,
	);
	return verification.ok ? verification.claims : null;
}
