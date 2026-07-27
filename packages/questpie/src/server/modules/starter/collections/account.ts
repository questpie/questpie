import { collection } from "#questpie/server/collection/builder/collection-builder.js";

export default collection("account")
	.options({ timestamps: true })
	.fields(({ f }) => ({
		userId: f.text(255).required(),
		accountId: f.text(255).required(),
		providerId: f.text(255).required(),
		accessToken: f.text(500),
		refreshToken: f.text(500),
		accessTokenExpiresAt: f.datetime(),
		refreshTokenExpiresAt: f.datetime(),
		scope: f.text(255),
		idToken: f.text(500),
		password: f.text(255),
	}))
	.access({
		read: false,
		create: false,
		update: false,
		delete: false,
		fields: {
			accessToken: { read: false, create: false, update: false },
			refreshToken: { read: false, create: false, update: false },
			idToken: { read: false, create: false, update: false },
			password: { read: false, create: false, update: false },
		},
	})
	.title(({ f }) => f.providerId);
