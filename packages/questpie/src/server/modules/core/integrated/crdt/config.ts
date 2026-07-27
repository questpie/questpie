import type { VerifiedAgentCredential } from "#questpie/server/modules/core/integrated/crdt/authority.js";
import type { CrdtFieldEngine } from "#questpie/shared/crdt-engine.js";

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
}>;
