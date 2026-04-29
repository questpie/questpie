import { collection } from "#questpie/server/collection/builder/collection-builder.js";

export default collection("user")
	.options({ timestamps: true })
	.fields(({ f }) => ({
		name: f.text(255).required(),
		email: f.email(255).required(),
		emailVerified: f.boolean().required(),
		image: f.url(500),
		avatar: f
			.upload({
				to: "assets",
				mimeTypes: ["image/*"],
				maxSize: 5_000_000,
			})
			.label({ en: "Profile photo", sk: "Profilová fotka" })
			.set("admin", { accept: "image/*", previewVariant: "compact" }),
		role: f.text(50),
		banned: f.boolean().default(false),
		banReason: f.text(255),
		banExpires: f.datetime(),
	}))
	.hooks({
		beforeChange: async (ctx) => {
			const collections = (ctx as any).collections;
			const { data } = ctx;

			if (!Object.hasOwn(data, "avatar")) return;

			const avatarId = data.avatar;
			if (!avatarId) {
				data.image = null;
				return;
			}

			const asset = await collections.assets.findOne({
				where: { id: avatarId },
			});
			data.image = asset?.url ?? null;
		},
	})
	.title(({ f }) => f.name);
