import { principal, type Principal } from "questpie";

import { awaitExecutionPhase } from "../execution";
import { safeCredentialChallenge } from "./http-carrier";
import type { McpAuthenticationOutcome } from "./mcp";
import { classifyOperationCredentialFailure } from "./operation-carrier";

/**
 * Builds the MCP ingress's credential preflight. Called by
 * `createMcpIngress` only for a method the caller armed
 * (`requireCredential`/`protectCatalog`); see `mcp/index.ts`.
 *
 * Fail-closed by construction:
 * - a resolved, non-anonymous Principal is `"authenticated"` (and is
 *   returned so `tools/call` never resolves the credential twice — see
 *   `mcp-operation.ts`'s `principal` passthrough);
 * - `null`/an invalid Principal/an **anonymous** Principal is
 *   `"unauthenticated"` — an anonymous outcome (the normal shape of "no
 *   credential presented") is deliberately not treated as authenticated once
 *   the gate is armed, otherwise arming would protect nothing against the
 *   common case of a missing `Authorization` header;
 * - a credential-provider outage (`RUNTIME_UNAVAILABLE`) is `"unavailable"`
 *   (503), never silently deferred to the public/unauthenticated path;
 * - an aborted resolution (`DEADLINE_EXCEEDED`) is `"deadline"` (408);
 * - any other, unclassified resolver error is `"deferred"`: it still falls
 *   through to the existing `mcp-operation.ts`-owned `200`/SSE-wrapped
 *   `INTERNAL` frame rather than inventing a new status for a case nobody
 *   asked to change.
 *
 * The `WWW-Authenticate` header is pure decoration (`safeCredentialChallenge`
 * fails closed to "no header" on a throwing/malformed challenge — it never
 * changes whether the caller is denied).
 */
export function createMcpCredentialPreflight(
	input: Readonly<{
		resolvePrincipal(
			request: Request,
			signal: AbortSignal,
		): Principal | null | Promise<Principal | null>;
		credentialChallenge?(request: Request): string | undefined;
	}>,
): (
	request: Request,
	signal: AbortSignal,
) => Promise<McpAuthenticationOutcome> {
	const unauthenticated = (request: Request): McpAuthenticationOutcome => ({
		kind: "unauthenticated",
		wwwAuthenticate: safeCredentialChallenge(
			input.credentialChallenge,
			request,
		),
	});
	return async (request, signal) => {
		let caller: Principal | null;
		try {
			caller = await awaitExecutionPhase(signal, () =>
				input.resolvePrincipal(request, signal),
			);
		} catch (error) {
			const code = classifyOperationCredentialFailure(error, signal);
			if (code === "UNAUTHENTICATED") return unauthenticated(request);
			if (code === "RUNTIME_UNAVAILABLE") return { kind: "unavailable" };
			if (code === "DEADLINE_EXCEEDED") return { kind: "deadline" };
			return { kind: "deferred" };
		}
		if (!caller || !principal.is(caller) || caller.kind === "anonymous")
			return unauthenticated(request);
		return { kind: "authenticated", principal: caller };
	};
}
