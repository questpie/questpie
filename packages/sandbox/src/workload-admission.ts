const ADMISSION_VERSION = "qpsw1";
const MINIMUM_SECRET_BYTES = 32;
const MAXIMUM_ADMISSION_TTL_MS = 5_000;

export interface SandboxWorkloadAdmissionClaims {
	readonly kind: "sandbox_workload_admission";
	readonly version: 1;
	readonly admissionId: string;
	readonly supervisorInstanceId: string;
	readonly expiresAt: string;
	readonly requestSha256: string;
}

export interface SandboxWorkloadAdmissionKey {
	readonly keyId: string;
	readonly secret: Uint8Array;
	/** Unique per supervisor process; rotate on every restart. */
	readonly instanceId: string;
}

export type SandboxWorkloadAdmissionDenialReason =
	| "invalid"
	| "wrong_instance"
	| "expired"
	| "body_mismatch";

export type SandboxWorkloadAdmissionVerification =
	| {
			readonly ok: true;
			readonly claims: SandboxWorkloadAdmissionClaims;
	  }
	| {
			readonly ok: false;
			readonly reason: SandboxWorkloadAdmissionDenialReason;
			readonly claims?: SandboxWorkloadAdmissionClaims;
	  };

interface ReplayExpiry {
	readonly admissionId: string;
	readonly expiresAt: number;
}

export class SandboxWorkloadReplayCache {
	private readonly consumed = new Map<string, number>();
	private readonly expiries: ReplayExpiry[] = [];

	constructor(private readonly maximumEntries: number) {
		if (!Number.isInteger(maximumEntries) || maximumEntries < 1) {
			throw new Error("Invalid sandbox workload replay cache size.");
		}
	}

	consume(
		admission: SandboxWorkloadAdmissionClaims,
		now = Date.now(),
	): boolean {
		this.deleteExpired(now);
		if (this.consumed.has(admission.admissionId)) return false;
		if (this.consumed.size >= this.maximumEntries) return false;
		const expiresAt = Date.parse(admission.expiresAt);
		if (!Number.isFinite(expiresAt) || expiresAt <= now) return false;
		this.consumed.set(admission.admissionId, expiresAt);
		this.push({ admissionId: admission.admissionId, expiresAt });
		return true;
	}

	private deleteExpired(now: number): void {
		while (this.expiries[0] && this.expiries[0].expiresAt <= now) {
			const expired = this.pop()!;
			if (this.consumed.get(expired.admissionId) === expired.expiresAt) {
				this.consumed.delete(expired.admissionId);
			}
		}
	}

	private push(value: ReplayExpiry): void {
		let index = this.expiries.push(value) - 1;
		while (index > 0) {
			const parent = Math.floor((index - 1) / 2);
			if (this.expiries[parent]!.expiresAt <= value.expiresAt) break;
			this.expiries[index] = this.expiries[parent]!;
			index = parent;
		}
		this.expiries[index] = value;
	}

	private pop(): ReplayExpiry | undefined {
		const root = this.expiries[0];
		const last = this.expiries.pop();
		if (!root || !last || this.expiries.length === 0) return root;
		let index = 0;
		while (true) {
			const left = index * 2 + 1;
			if (left >= this.expiries.length) break;
			const right = left + 1;
			const child =
				right < this.expiries.length &&
				this.expiries[right]!.expiresAt < this.expiries[left]!.expiresAt
					? right
					: left;
			if (this.expiries[child]!.expiresAt >= last.expiresAt) break;
			this.expiries[index] = this.expiries[child]!;
			index = child;
		}
		this.expiries[index] = last;
		return root;
	}
}

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

function isIdentity(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length <= 128 &&
		/^[A-Za-z0-9_-]+$/.test(value)
	);
}

export function assertSandboxWorkloadAdmissionKey(
	key: SandboxWorkloadAdmissionKey,
): void {
	if (
		!isIdentity(key.keyId) ||
		!isIdentity(key.instanceId) ||
		key.secret.byteLength < MINIMUM_SECRET_BYTES
	) {
		throw new Error("Invalid sandbox workload admission configuration.");
	}
}

async function importHmacKey(
	key: SandboxWorkloadAdmissionKey,
	usage: "sign" | "verify",
): Promise<CryptoKey> {
	assertSandboxWorkloadAdmissionKey(key);
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

function exactKeys(value: object, keys: readonly string[]): boolean {
	const actual = Object.keys(value).sort();
	const expected = [...keys].sort();
	return (
		actual.length === expected.length &&
		actual.every((key, index) => key === expected[index])
	);
}

function parseClaims(value: unknown): SandboxWorkloadAdmissionClaims | null {
	if (
		typeof value !== "object" ||
		value === null ||
		Array.isArray(value) ||
		!exactKeys(value, [
			"kind",
			"version",
			"admissionId",
			"supervisorInstanceId",
			"expiresAt",
			"requestSha256",
		])
	) {
		return null;
	}
	const claims = value as Record<string, unknown>;
	if (
		claims.kind !== "sandbox_workload_admission" ||
		claims.version !== 1 ||
		!isIdentity(claims.admissionId) ||
		!isIdentity(claims.supervisorInstanceId) ||
		typeof claims.expiresAt !== "string" ||
		!Number.isFinite(Date.parse(claims.expiresAt)) ||
		typeof claims.requestSha256 !== "string" ||
		!/^[a-f0-9]{64}$/.test(claims.requestSha256)
	) {
		return null;
	}
	return claims as unknown as SandboxWorkloadAdmissionClaims;
}

export async function sealSandboxWorkloadAdmission(
	key: SandboxWorkloadAdmissionKey,
	claims: Omit<SandboxWorkloadAdmissionClaims, "requestSha256">,
	requestBody: string,
): Promise<string> {
	const payload: SandboxWorkloadAdmissionClaims = {
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

export async function verifySandboxWorkloadAdmission(
	key: SandboxWorkloadAdmissionKey,
	envelope: string,
	requestBody: string,
	now = new Date(),
): Promise<SandboxWorkloadAdmissionVerification> {
	const parts = envelope.split(".");
	if (parts.length !== 4 || parts[0] !== ADMISSION_VERSION) {
		return { ok: false, reason: "invalid" };
	}
	const encodedKeyId = encodeBase64Url(encoder.encode(key.keyId));
	if (parts[1] !== encodedKeyId) return { ok: false, reason: "invalid" };
	const signature = decodeBase64Url(parts[3]!);
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
	const encodedPayload = decodeBase64Url(parts[2]!);
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
