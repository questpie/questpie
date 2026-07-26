import { collection } from "#questpie/server/collection/builder/collection-builder.js";

export default collection("session")
	.options({ timestamps: true })
	.fields(({ f }) => ({
		userId: f.text(255).required(),
		token: f.text(255).required(),
		expiresAt: f.datetime().required(),
		ipAddress: f.text(45),
		userAgent: f.text(500),
		impersonatedBy: f.text(255),
	}))
	.access({
		read: false,
		create: false,
		update: false,
		delete: false,
		fields: {
			token: { read: false, create: false, update: false },
		},
	})
	.title(({ f }) => f.userId);
