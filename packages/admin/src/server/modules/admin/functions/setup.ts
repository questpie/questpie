/**
 * Setup Functions
 *
 * Built-in functions for bootstrapping the first admin user.
 * Solves the chicken-and-egg problem where invitation-based systems
 * need an existing admin to create the first invitation.
 */

import { eq, sql } from "drizzle-orm";
import { fn, type Questpie } from "questpie";
import { z } from "zod";

// ============================================================================
// Type Helpers
// ============================================================================

/**
 * Helper to get typed CMS app from handler context.
 * Used internally for better IDE support without affecting the public API.
 */
function getApp(ctx: { app: unknown }): Questpie<any> {
  return ctx.app as Questpie<any>;
}

// ============================================================================
// Schema Definitions
// ============================================================================

const isSetupRequiredSchema = z.object({});

const isSetupRequiredOutputSchema = z.object({
  required: z.boolean(),
});

const createFirstAdminSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  name: z.string().min(2, "Name must be at least 2 characters"),
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

// ============================================================================
// Functions
// ============================================================================

/**
 * Check if setup is required (no users exist in the system).
 *
 * @example
 * ```ts
 * const result = await client.rpc.isSetupRequired({});
 * if (result.required) {
 *   // Redirect to setup page
 * }
 * ```
 */
export const isSetupRequired = fn({
  type: "query",
  schema: isSetupRequiredSchema,
  outputSchema: isSetupRequiredOutputSchema,
  handler: async (ctx) => {
    const app = getApp(ctx);
    const userCollection = app.getCollectionConfig("user");
    const result = await app.db
      .select({ count: sql`count(*)::int` as any })
      .from(userCollection.table);
    return { required: (result[0] as { count: number }).count === 0 };
  },
});

/**
 * Create the first admin user in the system.
 * This function only works when no users exist (setup mode).
 *
 * Security: Once any user exists, this function will refuse to create more users.
 * This prevents unauthorized admin creation after initial setup.
 *
 * @example
 * ```ts
 * const result = await client.rpc.createFirstAdmin({
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
export const createFirstAdmin = fn({
  type: "mutation",
  schema: createFirstAdminSchema,
  outputSchema: createFirstAdminOutputSchema,
  handler: async (ctx) => {
    const app = getApp(ctx);
    const input = ctx.input as z.infer<typeof createFirstAdminSchema>;
    const userCollection = app.getCollectionConfig("user");

    // Check if setup already completed (any users exist)
    const checkResult = await app.db
      .select({ count: sql`count(*)::int` as any })
      .from(userCollection.table);

    if ((checkResult[0] as { count: number }).count > 0) {
      return {
        success: false,
        error: "Setup already completed - users exist in the system",
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
          error: "Failed to create user account",
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
        .where(eq(userCollection.table.id as any, signUpResult.user.id));

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
          error instanceof Error
            ? error.message
            : "An unexpected error occurred",
      };
    }
  },
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
