import { inferAdditionalFields } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

import type { SupportBetterAuth } from "../../runtime/better-auth";

export const authClient = createAuthClient({
	baseURL: location.origin,
	plugins: [inferAdditionalFields<SupportBetterAuth>()],
});

type AuthSession = typeof authClient.$Infer.Session;

export function supportSession(session: AuthSession) {
	const { user } = session;
	if (
		typeof user.membershipHint !== "string" ||
		typeof user.organizationHint !== "string" ||
		(user.roleHint !== "customer" &&
			user.roleHint !== "agent" &&
			user.roleHint !== "admin")
	)
		return null;
	return Object.freeze({
		label: user.name,
		membershipId: user.membershipHint,
		organizationId: user.organizationHint,
		principalId: user.id,
		role: user.roleHint,
	});
}

export type SupportSession = NonNullable<ReturnType<typeof supportSession>>;
