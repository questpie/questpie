/**
 * Admin-configured User Collection
 *
 * Extends the starter user collection with full admin UI configuration:
 * - Admin panel metadata (label, icon, group)
 * - List view with table columns, search, and actions
 * - Form view with tabbed layout (profile + security)
 * - Custom actions: create user, reset password
 *
 * @see account.ts for explanation of the collection().merge().set() pattern.
 * stateKey mapping: admin=".admin()", adminList=".list()", adminForm=".form()", adminActions=".actions()"
 */

import { starterModule } from "questpie";

import { collection } from "../factories";

const adminUserCollection = collection("user")
	.merge(starterModule.collections.user)
	.admin(({ c }) => ({
		label: { key: "defaults.users.label" },
		icon: c.icon("ph:users"),
		description: { key: "defaults.users.description" },
		group: "administration",
	}))
	.list(({ v, f, a }) =>
		v.collectionTable({
			columns: [f.avatar, f.name, f.email, f.role, f.banned],
			searchable: [f.name, f.email],
			defaultSort: { field: f.name, direction: "asc" },
			actions: {
				header: { primary: [], secondary: [] },
				bulk: [a.deleteMany],
			},
		}),
	)
	.form(({ v, f }) =>
		v.collectionForm({
			sidebar: {
				position: "right",
				fields: [f.avatar, f.role, f.emailVerified],
			},
			fields: [
				{
					type: "tabs",
					tabs: [
						{
							id: "profile",
							label: { key: "defaults.users.tabs.profile" },
							fields: [
								{
									type: "section",
									label: { key: "defaults.users.sections.basicInfo" },
									layout: "grid",
									columns: 2,
									fields: [
										f.name,
										{
											field: f.email,
											readOnly: ({ data }: any) => Boolean((data as any)?.id),
										},
									],
								},
							],
						},
						{
							id: "security",
							label: { key: "defaults.users.tabs.security" },
							fields: [
								{
									type: "section",
									label: { key: "defaults.users.sections.accessControl" },
									fields: [
										f.banned,
										{
											field: f.banReason,
											hidden: ({ data }: any) => !(data as any)?.banned,
										},
										{
											field: f.banExpires,
											hidden: ({ data }: any) => !(data as any)?.banned,
										},
									],
								},
							],
						},
					],
				},
			],
		}),
	)
	.actions(({ a, c, f }: any) => ({
		builtin: [a.save(), a.delete(), a.deleteMany(), a.duplicate()],
		custom: [
			a.headerAction({
				id: "createUser",
				label: { key: "defaults.users.actions.createUser.label" },
				icon: c.icon("ph:user-plus"),
				form: {
					title: { key: "defaults.users.actions.createUser.title" },
					description: {
						key: "defaults.users.actions.createUser.description",
					},
					submitLabel: { key: "defaults.users.actions.createUser.submit" },
					fields: {
						name: f
							.text()
							.label({ key: "defaults.users.fields.name.label" })
							.description({
								en: "Shown in the admin panel and account profile.",
								sk: "Zobrazí sa v administrácii a profile účtu.",
							})
							.required()
							.set("admin", {
								placeholder: {
									key: "defaults.users.fields.name.placeholder",
									fallback: "Enter the user's full name",
								},
								autoComplete: "name",
							}),
						email: f
							.email()
							.label({ key: "defaults.users.fields.email.label" })
							.description({
								en: "The address this user will use to sign in.",
								sk: "Adresa, ktorú bude používateľ používať na prihlásenie.",
							})
							.required()
							.set("admin", {
								placeholder: {
									en: "name@example.com",
									sk: "meno@example.com",
								},
								autoComplete: "email",
							}),
						password: f
							.text()
							.label({
								key: "defaults.users.actions.createUser.fields.password.label",
							})
							.description({
								en: "Share this password securely with the new user.",
								sk: "Toto heslo bezpečne odovzdajte novému používateľovi.",
							})
							.required()
							.set("admin", {
								type: "password",
								autoComplete: "new-password",
								placeholder: {
									key: "defaults.users.actions.createUser.fields.password.placeholder",
									fallback: "Enter a temporary password",
								},
							}),
						role: f
							.select([
								{
									value: "admin",
									label: {
										key: "defaults.users.fields.role.options.admin",
									},
								},
								{
									value: "user",
									label: { key: "defaults.users.fields.role.options.user" },
								},
							])
							.label({ key: "defaults.users.fields.role.label" })
							.description({
								en: "Admins can manage the whole admin area; users have limited access.",
								sk: "Administrátori môžu spravovať celú administráciu; používatelia majú obmedzený prístup.",
							})
							.default("user")
							.set("admin", {
								placeholder: {
									en: "Select a role",
									sk: "Vyberte rolu",
								},
							}),
					},
				},
				handler: async ({ data, auth, session }: any) => {
					const authApi = (auth as any)?.api;
					if (!authApi?.createUser) {
						return {
							type: "error",
							toast: {
								message:
									"Auth admin API is not configured. Cannot create user.",
							},
						};
					}

					const token = (session as any)?.session?.token;
					const headers = token
						? new Headers({ authorization: `Bearer ${token}` })
						: undefined;

					const result = await authApi.createUser({
						body: {
							email: String((data as any).email || ""),
							password: String((data as any).password || ""),
							name: String((data as any).name || ""),
							role: (data as any).role ? String((data as any).role) : undefined,
						},
						...(headers ? { headers } : {}),
					});

					const createdUserId = (result as any)?.user?.id;
					const createdUserEmail = (result as any)?.user?.email;

					if (!createdUserId) {
						return {
							type: "error",
							toast: {
								message: "Failed to create user",
							},
						};
					}

					return {
						type: "success",
						toast: {
							message: `User ${createdUserEmail || ""} created successfully`,
						},
						effects: {
							invalidate: ["user"],
							redirect: `/admin/collections/user/${createdUserId}`,
						},
					};
				},
			}),
			a.action({
				id: "resetPassword",
				label: { key: "defaults.users.actions.resetPassword.label" },
				icon: c.icon("ph:key"),
				variant: "outline",
				form: {
					title: { key: "defaults.users.actions.resetPassword.title" },
					description: {
						key: "defaults.users.actions.resetPassword.description",
					},
					submitLabel: {
						key: "defaults.users.actions.resetPassword.submit",
					},
					fields: {
						newPassword: f
							.text()
							.label({
								key: "defaults.users.actions.resetPassword.fields.newPassword.label",
							})
							.required()
							.set("admin", { type: "password", autoComplete: "new-password" }),
						confirmPassword: f
							.text()
							.label({
								key: "defaults.users.actions.resetPassword.fields.confirmPassword.label",
							})
							.required()
							.set("admin", { type: "password", autoComplete: "new-password" }),
					},
				},
				handler: async ({ data, itemId, auth, session }: any) => {
					if (!itemId) {
						return {
							type: "error",
							toast: { message: "User ID is required" },
						};
					}

					const newPassword = String((data as any).newPassword || "");
					const confirmPassword = String((data as any).confirmPassword || "");

					if (newPassword !== confirmPassword) {
						return {
							type: "error",
							toast: {
								message: "Passwords do not match",
							},
						};
					}

					const authApi = (auth as any)?.api;
					if (!authApi?.setUserPassword) {
						return {
							type: "error",
							toast: {
								message:
									"Auth admin API is not configured. Cannot reset password.",
							},
						};
					}

					const token = (session as any)?.session?.token;
					const headers = token
						? new Headers({ authorization: `Bearer ${token}` })
						: undefined;

					await authApi.setUserPassword({
						body: {
							userId: itemId,
							newPassword,
						},
						...(headers ? { headers } : {}),
					});

					return {
						type: "success",
						toast: { message: "Password reset successfully" },
						effects: { invalidate: ["user"] },
					};
				},
			}),
		],
	}));

export default adminUserCollection;
