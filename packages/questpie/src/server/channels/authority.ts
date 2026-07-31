import { createHash } from "node:crypto";

import type { Principal } from "#questpie/server/config/context.js";

export type ChannelAuthoritySubject = Readonly<{
	kind: "user" | "oauth" | "session";
	id: string;
}>;

type ChannelAuthorityContext = Readonly<{
	principal?: Principal | null;
	session?: {
		user?: { id?: unknown };
		session?: { id?: unknown };
	} | null;
}>;

export function resolveChannelAuthoritySubject(
	context: ChannelAuthorityContext,
): ChannelAuthoritySubject | null {
	const principalUserId =
		context.principal && context.principal.kind !== "system"
			? context.principal.user.id
			: undefined;
	const userId = principalUserId ?? context.session?.user?.id;
	if (typeof userId === "string" && userId) {
		return { kind: "user", id: userId };
	}
	const tokenId =
		context.principal?.kind === "oauth" ? context.principal.tokenId : undefined;
	if (typeof tokenId === "string" && tokenId) {
		return { kind: "oauth", id: tokenId };
	}
	const sessionId = context.session?.session?.id;
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
