import { collection } from "#questpie/server/collection/builder/collection-builder.js";

/**
 * Better Auth `verification` table. Beyond short email-verification / password-
 * reset tokens, the `@better-auth/oauth-provider` stores large JSON payloads
 * here (OAuth authorization-code state, PKCE params) keyed by identifier, which
 * overflow a `varchar(255)`. `value` must therefore be unbounded text
 * (`textarea()`), not `text(255)`.
 */
export default collection("verification")
	.options({ timestamps: true })
	.fields(({ f }) => ({
		identifier: f.text(255).required(),
		value: f.textarea().required(),
		expiresAt: f.datetime().required(),
	}))
	.access({
		read: false,
		create: false,
		update: false,
		delete: false,
		fields: {
			value: { read: false, create: false, update: false },
		},
	})
	.title(({ f }) => f.identifier);
