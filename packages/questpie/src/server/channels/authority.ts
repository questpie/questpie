import { createHash } from "node:crypto";

import type { Principal } from "#questpie/server/config/context.js";

export type ChannelAuthoritySubject = Readonly<{
	kind: "user" | "oauth" | "session";
	id: string;
}>;

type ChannelAuthorityContext = Readonly<{
	principal?: Principal | null;
	session?: unknown;
}>;

export function resolveChannelAuthoritySubject(
	context: ChannelAuthorityContext,
): ChannelAuthoritySubject | null {
	const principalUserId =
		context.principal && context.principal.kind !== "system"
			? context.principal.user.id
			: undefined;
	const session = context.session;
	const user =
		session && typeof session === "object" && "user" in session
			? session.user
			: undefined;
	const sessionUserId =
		user && typeof user === "object" && "id" in user ? user.id : undefined;
	const userId = principalUserId ?? sessionUserId;
	if (typeof userId === "string" && userId) {
		return { kind: "user", id: userId };
	}
	const tokenId =
		context.principal?.kind === "oauth" ? context.principal.tokenId : undefined;
	if (typeof tokenId === "string" && tokenId) {
		return { kind: "oauth", id: tokenId };
	}
	const sessionInfo =
		session && typeof session === "object" && "session" in session
			? session.session
			: undefined;
	const sessionId =
		sessionInfo && typeof sessionInfo === "object" && "id" in sessionInfo
			? sessionInfo.id
			: undefined;
	return typeof sessionId === "string" && sessionId
		? { kind: "session", id: sessionId }
		: null;
}

/** One-way binding key; raw principal/session ids never enter delivery notices. */
export function opaqueChannelAuthoritySubject(
	subject: ChannelAuthoritySubject,
): string {
	return createHash("sha256")
		.update(`${subject.kind}:${subject.id}`)
		.digest("hex");
}
