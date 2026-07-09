import { collection } from "#questpie/server/collection/builder/collection-builder.js";

/**
 * Better Auth `jwks` table (from the `jwt()` plugin). Stores the JWK key pairs
 * used to sign/verify OAuth access tokens. `privateKey` is secret — hidden from
 * reads. Mirrors better-auth's plugin schema so the drizzle adapter round-trips.
 */
export default collection("jwks")
	.options({ timestamps: false })
	.fields(({ f }) => ({
		publicKey: f.textarea().required(),
		privateKey: f.textarea().required(),
		createdAt: f.datetime().required(),
		expiresAt: f.datetime(),
	}))
	.access({
		fields: {
			privateKey: { read: false, create: false, update: false },
		},
	})
	.title(({ f }) => f.publicKey);
