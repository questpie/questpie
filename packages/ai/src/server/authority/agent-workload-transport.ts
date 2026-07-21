import { createHmac, timingSafeEqual } from "node:crypto";

import { isTrustedAgentWorkloadPrincipal } from "./agent-workload-brand.js";
import { AgentWorkloadAuthorityError } from "./agent-workload-error.js";
import { parseAgentWorkloadPrincipalClaims } from "./agent-workload-schema.js";
import type {
	AgentWorkloadPrincipal,
	AgentWorkloadPrincipalClaims,
	AuthenticatedAgentWorkloadEnvelope,
} from "./agent-workload-types.js";

const ENVELOPE_VERSION = "qpaw1";
const MINIMUM_SECRET_BYTES = 32;
const authenticatedClaims = new WeakMap<object, AgentWorkloadPrincipalClaims>();

export interface AuthenticatedAgentWorkloadTransportOptions {
	readonly keyId: string;
	readonly secret: Uint8Array;
}

export interface AuthenticatedAgentWorkloadTransport {
	seal(principal: AgentWorkloadPrincipal): string;
	open(envelope: string): AuthenticatedAgentWorkloadEnvelope;
}

function encode(value: string | Uint8Array): string {
	return Buffer.from(value).toString("base64url");
}

function invalidPrincipal(): never {
	throw new AgentWorkloadAuthorityError("invalid_principal");
}

function deepFreeze<T>(value: T): T {
	if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
		return value;
	}
	for (const child of Object.values(value)) {
		deepFreeze(child);
	}
	return Object.freeze(value);
}

function principalPayload(principal: AgentWorkloadPrincipal): unknown {
	return {
		kind: principal.kind,
		schemaVersion: principal.schemaVersion,
		principalId: principal.principalId,
		audience: principal.audience,
		run: principal.run,
		attribution: principal.attribution,
		scope: principal.scope,
		policies: principal.policies,
		grants: principal.grants,
		capabilities: principal.capabilities,
		execution: principal.execution,
		disclosure: principal.disclosure,
		epochs: principal.epochs,
		issuedAt: principal.issuedAt,
		expiresAt: principal.expiresAt,
	};
}

function opaqueEnvelope(
	claims: AgentWorkloadPrincipalClaims,
): AuthenticatedAgentWorkloadEnvelope {
	const authenticatedEnvelope = Object.freeze({
		kind: "authenticated_agent_workload_envelope" as const,
		version: 1 as const,
	}) as AuthenticatedAgentWorkloadEnvelope;
	authenticatedClaims.set(authenticatedEnvelope, deepFreeze(claims));
	return authenticatedEnvelope;
}

export function claimsFromAuthenticatedAgentWorkloadEnvelope(
	envelope: AuthenticatedAgentWorkloadEnvelope,
): AgentWorkloadPrincipalClaims | null {
	return authenticatedClaims.get(envelope) ?? null;
}

/**
 * Authenticates internal envelope integrity only. `open` deliberately returns
 * an opaque intermediate; an audience-bound resolver must validate current
 * persisted authority before consumers receive an AgentWorkloadPrincipal.
 *
 * This symmetric HMAC seam is suitable only for mutually trusted internal
 * control-plane peers. Remote untrusted Workers require asymmetric identity.
 */
export function createAuthenticatedAgentWorkloadTransport(
	options: AuthenticatedAgentWorkloadTransportOptions,
): AuthenticatedAgentWorkloadTransport {
	if (
		options.keyId.length === 0 ||
		options.secret.byteLength < MINIMUM_SECRET_BYTES
	) {
		throw new AgentWorkloadAuthorityError("invalid_transport_configuration");
	}
	const encodedKeyId = encode(options.keyId);
	const secret = Buffer.from(options.secret);
	const sign = (input: string): Uint8Array =>
		createHmac("sha256", secret).update(input).digest();

	return {
		seal(principal) {
			if (!isTrustedAgentWorkloadPrincipal(principal)) {
				return invalidPrincipal();
			}
			const encodedPayload = encode(
				JSON.stringify(principalPayload(principal)),
			);
			const signed = `${ENVELOPE_VERSION}.${encodedKeyId}.${encodedPayload}`;
			return `${signed}.${encode(sign(signed))}`;
		},
		open(envelope) {
			const parts = envelope.split(".");
			if (
				parts.length !== 4 ||
				parts[0] !== ENVELOPE_VERSION ||
				parts[1] !== encodedKeyId
			) {
				return invalidPrincipal();
			}
			const signed = `${parts[0]}.${parts[1]}.${parts[2]}`;
			const expected = sign(signed);
			let actual: Uint8Array;
			try {
				actual = Buffer.from(parts[3], "base64url");
			} catch {
				return invalidPrincipal();
			}
			if (
				actual.byteLength !== expected.byteLength ||
				!timingSafeEqual(actual, expected)
			) {
				return invalidPrincipal();
			}

			let decoded: unknown;
			try {
				decoded = JSON.parse(
					Buffer.from(parts[2], "base64url").toString("utf8"),
				);
			} catch {
				return invalidPrincipal();
			}
			const claims = parseAgentWorkloadPrincipalClaims(decoded);
			return claims ? opaqueEnvelope(claims) : invalidPrincipal();
		},
	};
}
