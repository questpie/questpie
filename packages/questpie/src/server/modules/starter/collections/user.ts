import { collection } from "#questpie/server/collection/builder/collection-builder.js";

const isAdmin = (user: unknown): boolean =>
	!!user &&
	typeof user === "object" &&
	(user as { role?: unknown }).role === "admin";

const sessionUser = (
	context: unknown,
): { id?: string; role?: unknown } | undefined => {
	if (!context || typeof context !== "object") return undefined;
	const session = (context as { session?: unknown }).session;
	if (!session || typeof session !== "object") return undefined;
	const user = (session as { user?: unknown }).user;
	if (!user || typeof user !== "object") return undefined;
	const { id, role } = user as { id?: unknown; role?: unknown };
	return { id: typeof id === "string" ? id : undefined, role };
};

export default collection("user")
	.options({ timestamps: true })
	.fields(({ f }) => ({
		name: f
			.text(255)
			.label({ key: "defaults.users.fields.name.label", fallback: "Name" })
			.required()
			.set("admin", {
				placeholder: {
					key: "defaults.users.fields.name.placeholder",
					fallback: "Enter user name",
				},
				autoComplete: "name",
			}),
		email: f
			.email(255)
			.label({ key: "defaults.users.fields.email.label", fallback: "Email" })
			.description({
				key: "defaults.users.fields.email.description",
				fallback: "Email address (read-only)",
			})
			.required()
			.set("admin", { autoComplete: "email" }),
		emailVerified: f
			.boolean()
			.label({
				key: "defaults.users.fields.emailVerified.label",
				fallback: "Email Verified",
			})
			.description({
				key: "defaults.users.fields.emailVerified.description",
				fallback: "Whether the user has verified their email address",
			})
			.required(),
		image: f.url(500).label({
			key: "defaults.users.fields.image.label",
			fallback: "Image URL",
		}),
		avatar: f
			.upload({
				to: "assets",
				mimeTypes: ["image/*"],
				maxSize: 5_000_000,
			})
			.label({
				key: "defaults.users.fields.avatar.label",
				fallback: "Profile photo",
			})
			.set("admin", { accept: "image/*", previewVariant: "compact" }),
		role: f
			.select([
				{
					value: "admin",
					label: {
						key: "defaults.users.fields.role.options.admin",
						fallback: "Admin",
					},
				},
				{
					value: "user",
					label: {
						key: "defaults.users.fields.role.options.user",
						fallback: "User",
					},
				},
			])
			.label({ key: "defaults.users.fields.role.label", fallback: "Role" })
			.description({
				key: "defaults.users.fields.role.description",
				fallback:
					"Admins can manage the whole admin area; users have limited access.",
			})
			.set("admin", {
				placeholder: {
					key: "defaults.users.fields.role.placeholder",
					fallback: "Select a role",
				},
			}),
		banned: f
			.boolean()
			.label({ key: "defaults.users.fields.banned.label", fallback: "Banned" })
			.description({
				key: "defaults.users.fields.banned.description",
				fallback: "Prevent user from accessing the system",
			})
			.default(false),
		banReason: f
			.text(255)
			.label({
				key: "defaults.users.fields.banReason.label",
				fallback: "Ban Reason",
			})
			.set("admin", {
				placeholder: {
					key: "defaults.users.fields.banReason.placeholder",
					fallback: "Enter reason for banning...",
				},
			}),
		banExpires: f
			.datetime()
			.label({
				key: "defaults.users.fields.banExpires.label",
				fallback: "Ban Expires",
			})
			.description({
				key: "defaults.users.fields.banExpires.description",
				fallback: "When the user's ban should expire",
			}),
	}))
	.access({
		read: (context) => {
			const user = sessionUser(context);
			if (isAdmin(user)) return true;
			const userId = user?.id;
			return userId ? { id: userId } : false;
		},
		create: (context) => isAdmin(sessionUser(context)),
		update: (context) => {
			const user = sessionUser(context);
			return isAdmin(user) || (!!user?.id && context.data.id === user.id);
		},
		delete: (context) => isAdmin(sessionUser(context)),
		fields: {
			email: {
				create: ({ user }) => isAdmin(user),
				update: ({ user }) => isAdmin(user),
			},
			emailVerified: {
				create: ({ user }) => isAdmin(user),
				update: ({ user }) => isAdmin(user),
			},
			image: {
				create: ({ user }) => isAdmin(user),
				update: ({ user }) => isAdmin(user),
			},
			role: {
				create: ({ user }) => isAdmin(user),
				update: ({ user }) => isAdmin(user),
			},
			banned: {
				create: ({ user }) => isAdmin(user),
				update: ({ user }) => isAdmin(user),
			},
			banReason: {
				create: ({ user }) => isAdmin(user),
				update: ({ user }) => isAdmin(user),
			},
			banExpires: {
				create: ({ user }) => isAdmin(user),
				update: ({ user }) => isAdmin(user),
			},
		},
	})
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
