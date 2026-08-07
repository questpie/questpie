import type { AnyDrizzleClient } from "#questpie/server/config/types.js";
import type { VerifiedAgentCredential } from "#questpie/server/modules/core/integrated/crdt/authority.js";
import type { CrdtFieldEngine } from "#questpie/shared/crdt-engine.js";

export type CrdtCanonicalProjectionValue = string | readonly string[];

export type CrdtProjectionContributor = Readonly<{
	commitSeq: bigint;
	sessionId: string | null;
	actor:
		| Readonly<{ kind: "human"; subjectId: string }>
		| Readonly<{ kind: "agent"; issuer: string; subjectId: string }>;
}>;

export type CrdtProjectionAcknowledgementInput = Readonly<{
	/** The framework-owned projection transaction. Writes join canonical acknowledgement. */
	transaction: AnyDrizzleClient<any>;
	owner: Readonly<{
		kind: "collection" | "global";
		key: string;
		recordId: string | number | null;
		current: Readonly<Record<string, unknown>>;
	}>;
	/** Complete authoritative aggregate cut, keyed by CRDT source path. */
	values: ReadonlyMap<string, CrdtCanonicalProjectionValue>;
	/** Source paths whose CRDT cursor advanced in this cut. */
	changed: ReadonlySet<string>;
	contributors: readonly CrdtProjectionContributor[];
	resourceId: string;
	resourceEpochId: string;
	basisCommitSeq: bigint;
	commitSeq: bigint;
}>;

export type CrdtProjectionAcknowledgementResult = void | Readonly<{
	/**
	 * Canonical aggregate values to persist. When present, the map must contain
	 * exactly the same paths and value kinds as `input.values`.
	 */
	values?: ReadonlyMap<string, CrdtCanonicalProjectionValue>;
	/** Non-CRDT columns on the locked canonical owner, written with the cut. */
	ownerValues?: Readonly<Record<string, unknown>>;
}>;

export type CrdtProjectionAcknowledgementHook = (
	input: CrdtProjectionAcknowledgementInput,
) =>
	| CrdtProjectionAcknowledgementResult
	| Promise<CrdtProjectionAcknowledgementResult>;

export type CrdtAgentAuthenticationInput = Readonly<{
	request: Request;
	bearerToken: string;
	audience: string;
	namespace: string;
}>;

export type CrdtRuntimeConfig = Readonly<{
	namespace: string;
	engines?: Readonly<{
		text?: CrdtFieldEngine<"text", string>;
	}>;
	allowedOrigins?: readonly string[];
	authenticateAgent?: (
		input: CrdtAgentAuthenticationInput,
	) => VerifiedAgentCredential | null | Promise<VerifiedAgentCredential | null>;
	projection?: Readonly<{
		/**
		 * Validate and canonically project one complete CRDT aggregate cut. Any
		 * throw rolls back callback writes, canonical values, cursors and realtime.
		 */
		prepareAcknowledgement: CrdtProjectionAcknowledgementHook;
	}>;
}>;
