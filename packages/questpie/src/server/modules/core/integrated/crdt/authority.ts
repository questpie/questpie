import type { Principal } from "#questpie/server/config/context.js";

export type AuthorityActor =
	| { kind: "human"; subjectId: string }
	| {
			kind: "agent";
			subjectId: string;
			credentialId: string;
			issuer: string;
			scopes: readonly string[];
			expiresAt: Date;
	  };

export type CrdtAuthoritySubject =
	| { kind: "human"; subjectId: string }
	| { kind: "agent"; issuer: string; subjectId: string };

export type VerifiedAgentCredential = {
	credentialId: string;
	subjectId: string;
	issuer: string;
	scopes: readonly ("crdt:read" | "crdt:edit")[];
	expiresAt: Date;
};

export type CrdtAuthentication =
	| {
			principal: Extract<Principal, { kind: "user" | "oauth" }>;
			verifiedAgentCredential?: never;
			actor: Extract<AuthorityActor, { kind: "human" }>;
	  }
	| {
			principal: undefined;
			verifiedAgentCredential: VerifiedAgentCredential;
			actor: Extract<AuthorityActor, { kind: "agent" }>;
	  };

function requireIdentifier(value: unknown, label: string): string {
	if (typeof value !== "string" || value.length === 0 || value.length > 255) {
		throw new Error(
			`${label} must be a non-empty string of at most 255 characters`,
		);
	}
	return value;
}

export function createHumanCrdtAuthentication(
	principal: Principal,
): Extract<CrdtAuthentication, { actor: { kind: "human" } }> {
	if (principal.kind !== "user" && principal.kind !== "oauth") {
		throw new Error(
			"CRDT human authentication requires a user or OAuth principal",
		);
	}
	const subjectId = requireIdentifier(principal.user.id, "Human subjectId");
	return {
		principal,
		actor: { kind: "human", subjectId },
	};
}

export function createAgentCrdtAuthentication(
	credential: VerifiedAgentCredential,
	now: Date = new Date(),
): Extract<CrdtAuthentication, { actor: { kind: "agent" } }> {
	const credentialId = requireIdentifier(
		credential.credentialId,
		"Agent credentialId",
	);
	const subjectId = requireIdentifier(credential.subjectId, "Agent subjectId");
	let issuer: string;
	try {
		const url = new URL(credential.issuer);
		issuer = url.origin;
		if (credential.issuer !== issuer) throw new Error();
	} catch {
		throw new Error("Agent issuer must be a canonical URL origin");
	}
	if (
		!(credential.expiresAt instanceof Date) ||
		!Number.isFinite(credential.expiresAt.getTime()) ||
		credential.expiresAt <= now
	) {
		throw new Error("Agent credential is expired or has an invalid expiry");
	}
	if (
		credential.scopes.length === 0 ||
		credential.scopes.some(
			(scope) => scope !== "crdt:read" && scope !== "crdt:edit",
		) ||
		!credential.scopes.includes("crdt:read")
	) {
		throw new Error("Agent credential requires a valid crdt:read scope");
	}
	const verifiedAgentCredential = {
		credentialId,
		subjectId,
		issuer,
		scopes: Object.freeze([...new Set(credential.scopes)]),
		expiresAt: new Date(credential.expiresAt),
	} satisfies VerifiedAgentCredential;
	return {
		principal: undefined,
		verifiedAgentCredential,
		actor: {
			kind: "agent",
			subjectId,
			credentialId,
			issuer,
			scopes: verifiedAgentCredential.scopes,
			expiresAt: verifiedAgentCredential.expiresAt,
		},
	};
}

export function authoritySubject(
	authentication: CrdtAuthentication,
): CrdtAuthoritySubject {
	return authentication.actor.kind === "human"
		? { kind: "human", subjectId: authentication.actor.subjectId }
		: {
				kind: "agent",
				issuer: authentication.actor.issuer,
				subjectId: authentication.actor.subjectId,
			};
}

export function assertFreshCrdtAuthentication(
	authentication: CrdtAuthentication,
	now: Date = new Date(),
): void {
	if (authentication.actor.kind === "human") {
		const principal = authentication.principal;
		if (
			!principal ||
			(principal.kind !== "user" && principal.kind !== "oauth") ||
			typeof principal.user.id !== "string" ||
			principal.user.id.length === 0 ||
			principal.user.id !== authentication.actor.subjectId
		) {
			throw new Error("CRDT human actor does not match its principal");
		}
		return;
	}

	const credential = authentication.verifiedAgentCredential;
	const credentialExpiry = credential?.expiresAt;
	const actorExpiry = authentication.actor.expiresAt;
	if (
		authentication.principal !== undefined ||
		!credential ||
		!(credentialExpiry instanceof Date) ||
		!Number.isFinite(credentialExpiry.getTime()) ||
		!(actorExpiry instanceof Date) ||
		!Number.isFinite(actorExpiry.getTime()) ||
		credential.credentialId !== authentication.actor.credentialId ||
		credential.subjectId !== authentication.actor.subjectId ||
		credential.issuer !== authentication.actor.issuer ||
		credentialExpiry.getTime() !== actorExpiry.getTime() ||
		credentialExpiry <= now ||
		!credential.scopes.includes("crdt:read") ||
		credential.scopes.length !== authentication.actor.scopes.length ||
		credential.scopes.some(
			(scope, index) => scope !== authentication.actor.scopes[index],
		)
	) {
		throw new Error(
			"CRDT Agent actor does not have a fresh matching credential",
		);
	}
}

export function createFreshCrdtContextResolver<TContext>(input: {
	authenticate: () => Promise<CrdtAuthentication>;
	createContext: (authentication: CrdtAuthentication) => Promise<TContext>;
	now?: () => Date;
}): () => Promise<{
	authentication: CrdtAuthentication;
	context: TContext;
}> {
	return async () => {
		const authentication = await input.authenticate();
		assertFreshCrdtAuthentication(authentication, input.now?.() ?? new Date());
		const context = await input.createContext(authentication);
		if (
			context &&
			typeof context === "object" &&
			(context as { accessMode?: unknown }).accessMode === "system"
		) {
			throw new Error("CRDT authority decisions cannot use system access mode");
		}
		return { authentication, context };
	};
}
