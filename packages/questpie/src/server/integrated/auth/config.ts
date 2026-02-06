import { admin, apiKey, bearer } from "better-auth/plugins";
import {
  accountsCollection,
  apiKeysCollection,
  sessionsCollection,
  usersCollection,
  verificationsCollection,
} from "#questpie/server/collection/defaults/auth.js";

// Re-export from merge.ts for backwards compatibility
export { auth, type MergeAuthOptions, mergeAuthOptions } from "./merge.js";

import { auth } from "./merge.js";

/**
 * Core auth options with Better Auth plugins
 */
export const coreAuthOptions = auth({
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  advanced: {
    useSecureCookies: process.env.NODE_ENV === "production",
  },
  plugins: [admin(), apiKey(), bearer()],
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
  },
});

// Type inference validation:
//
// The MergeAuthOptions type correctly merges:
// 1. ✅ plugins array (type-level concatenation)
// 2. ✅ additionalFields (deep merge for user/session/account)
//
// Runtime behavior: All plugin methods work correctly
// Type inference: Use `typeof cms.auth.$Infer` to get merged types

export const coreAuthCollections = {
  user: usersCollection,
  session: sessionsCollection,
  account: accountsCollection,
  verification: verificationsCollection,
  apikey: apiKeysCollection,
};
