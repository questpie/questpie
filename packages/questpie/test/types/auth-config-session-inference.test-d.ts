import { organization } from "better-auth/plugins";

import { authConfig } from "#questpie/server/config/factories.js";
import type { InferSessionFromAuthConfig } from "#questpie/server/config/context.js";

import type { Equal, Expect, HasKey } from "./type-test-utils.js";

const config = authConfig({
	emailAndPassword: { enabled: true },
	plugins: [
		organization({
			allowUserToCreateOrganization: true,
		}),
	],
});

type Session = InferSessionFromAuthConfig<typeof config>;

type _sessionHasSessionKey = Expect<Equal<HasKey<Session, "session">, true>>;
type _sessionHasUserKey = Expect<Equal<HasKey<Session, "user">, true>>;
type _organizationPluginSessionField = Expect<
	Equal<
		HasKey<NonNullable<Session["session"]>, "activeOrganizationId">,
		true
	>
>;
