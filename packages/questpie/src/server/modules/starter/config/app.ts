/**
 * Default app config for the starter module.
 * Requires an authenticated session for all CRUD operations.
 *
 * To make a specific collection publicly readable, override on the collection:
 * ```ts
 * const posts = collection("posts")
 *   .access({ read: true })  // Public reads, other ops inherit defaultAccess
 *   .fields(({ f }) => ({ ... }));
 * ```
 */
export default {
	access: {
		read: ({ session }: any) => !!session,
		create: ({ session }: any) => !!session,
		update: ({ session }: any) => !!session,
		delete: ({ session }: any) => !!session,
	},
};
