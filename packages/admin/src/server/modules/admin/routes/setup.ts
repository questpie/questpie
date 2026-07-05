/**
 * Setup Functions
 *
 * Built-in functions for bootstrapping the first admin user.
 * Solves the chicken-and-egg problem where invitation-based systems
 * need an existing admin to create the first invitation.
 */

import { route } from "questpie";
import { eq, sql } from "questpie/drizzle";
import { z } from "zod";

import { translateAdminMessage } from "./i18n-helpers.js";
import { getApp, getLocale } from "./route-helpers.js";

// ============================================================================
// Schema Definitions
// ============================================================================

const isSetupRequiredSchema = z.object({});

const isSetupRequiredOutputSchema = z.object({
	required: z.boolean(),
});

const createFirstAdminSchema = z.object({
	email: z.string().email(),
	password: z.string().min(8),
	name: z.string().min(2),
});

const createFirstAdminOutputSchema = z.object({
	success: z.boolean(),
	user: z
		.object({
			id: z.string(),
			email: z.string(),
			name: z.string(),
		})
		.optional(),
	error: z.string().optional(),
});

const adminUserContractMessage =
	'QUESTPIE Admin requires the canonical Better Auth "user" collection from adminModule/starterModule. The current "user" collection is missing required admin auth fields. Do not replace collection("user") from scratch; merge starterModule.collections.user or adminModule.collections.user and extend it.';

type AdminUserTableContract = {
	id: unknown;
	role: unknown;
	emailVerified: unknown;
};

export function getAdminUserTableContract(userCollection: {
	table?: Record<string, unknown>;
}): AdminUserTableContract {
	const table = userCollection?.table;
	const missing = ["id", "role", "emailVerified"].filter(
		(field) => !table?.[field],
	);

	if (missing.length > 0) {
		throw new Error(
			`${adminUserContractMessage} Missing field(s): ${missing.join(", ")}.`,
		);
	}

	return table as AdminUserTableContract;
}

// ============================================================================
// Functions
// ============================================================================

/**
 * Check if setup is required (no admin users exist in the system).
 *
 * @example
 * ```ts
 * const result = await client.routes.isSetupRequired.post({});
 * if (result.required) {
 *   // Redirect to setup page
 * }
 * ```
 */
export const isSetupRequired = route()
	.post()
	.schema(isSetupRequiredSchema)
	.outputSchema(isSetupRequiredOutputSchema)
	.handler(async (ctx) => {
		const app = getApp(ctx);
		const userCollection = app.getCollectionConfig("user");
		const userTable = getAdminUserTableContract(userCollection);
		const result = await app.db
			.select({ count: sql`count(*)::int` as any })
			.from(userCollection.table)
			.where(eq(userTable.role as any, "admin") as any);
		return { required: (result[0] as { count: number }).count === 0 };
	});

/**
 * Create the first admin user in the system.
 * This function only works when no admin users exist (setup mode).
 *
 * Security: Once any admin user exists, this function will refuse to create more users.
 * This prevents unauthorized admin creation after initial setup.
 *
 * @example
 * ```ts
 * const result = await client.routes.createFirstAdmin.post({
 *   email: "admin@example.com",
 *   password: "securepassword123",
 *   name: "Admin User",
 * });
 *
 * if (result.success) {
 *   // Redirect to login page
 * } else {
 *   console.error(result.error);
 * }
 * ```
 */
export const createFirstAdmin = route()
	.post()
	.schema(createFirstAdminSchema)
	.outputSchema(createFirstAdminOutputSchema)
	.handler(async (ctx) => {
		const app = getApp(ctx);
		const locale = getLocale(ctx);
		const t = (key: string, params?: Record<string, unknown>) =>
			translateAdminMessage(locale, key, params);
		const input = ctx.input as z.infer<typeof createFirstAdminSchema>;
		const userCollection = app.getCollectionConfig("user");
		const userTable = getAdminUserTableContract(userCollection);

		// Check if setup already completed (any admin user exists)
		const checkResult = await app.db
			.select({ count: sql`count(*)::int` as any })
			.from(userCollection.table)
			.where(eq(userTable.role as any, "admin") as any);

		if ((checkResult[0] as { count: number }).count > 0) {
			return {
				success: false,
				error: t("auth.setupAlreadyCompleted"),
			};
		}

		try {
			// Create user via Better Auth signUp
			const signUpResult = await app.auth.api.signUpEmail({
				body: {
					email: input.email,
					password: input.password,
					name: input.name,
				},
			});

			if (!signUpResult.user) {
				return {
					success: false,
					error: t("auth.failedToCreateUserAccount"),
				};
			}

			// Update role to admin and verify email (first user is always admin)
			// TODO: we can also use our builder pattern for admin functions for proper typesafety here !
			// Note: Type assertion needed due to drizzle-orm duplicate dependency resolution
			await (app.db as any)
				.update(userCollection.table)
				.set({
					role: "admin",
					emailVerified: true,
				})
				.where(eq(userTable.id as any, signUpResult.user.id));

			return {
				success: true,
				user: {
					id: signUpResult.user.id,
					email: signUpResult.user.email,
					name: signUpResult.user.name,
				},
			};
		} catch (error) {
			return {
				success: false,
				error:
					error instanceof Error ? error.message : t("error.unexpectedError"),
			};
		}
	});

// ============================================================================
// Export Bundle
// ============================================================================

/**
 * Bundle of setup-related functions.
 */
export const setupFunctions = {
	isSetupRequired,
	createFirstAdmin,
} as const;
