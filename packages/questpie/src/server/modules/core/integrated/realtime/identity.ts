import type { Principal } from "#questpie/server/config/context.js";

type RealtimeIdentityContext = Readonly<{
	principal?: Principal | null;
	session?: Readonly<{
		session?: Readonly<{ id?: string | null }> | null;
	}> | null;
}>;

/**
 * Stable request identity bound into topology capabilities.
 * Keep this shared by edge creation, control mutations, and CRDT open proof.
 */
export function realtimeControlIdentity(
	context: RealtimeIdentityContext,
): string {
	const principal = context.principal;
	if (principal?.kind === "user" && principal.session?.id) {
		return `user-session:${principal.session.id}`;
	}
	if (principal?.kind === "oauth" && principal.tokenId) {
		return `oauth:${principal.tokenId}`;
	}
	if (principal?.kind === "system") return "system";
	const sessionId = context.session?.session?.id;
	return sessionId ? `user-session:${sessionId}` : "anonymous";
}
