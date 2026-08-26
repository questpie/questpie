import { createSupportBetterAuth } from "../../runtime/better-auth";

// Better Auth's CLI discovers this named export. Its process owns and releases
// the short-lived migration connection pool when the command exits.
export const { auth } = await createSupportBetterAuth();
