import { collection } from "questpie";

/**
 * Admin Locks Collection
 *
 * Stores document locks for collaborative editing awareness.
 * When a user opens a document for editing, a lock is created.
 * Other users see who is editing and the document becomes read-only for them.
 *
 * Lock behavior:
 * - Locks expire after 60 seconds without heartbeat
 * - Client sends heartbeat every 30 seconds to keep lock alive
 * - On browser close/crash, lock expires automatically
 * - Realtime subscription shows locks in table rows
 *
 * @example
 * ```ts
 * // Acquire lock when opening document
 * await app.collections.admin_locks.create({
 *   resourceType: "collection",
 *   resource: "posts",
 *   resourceId: "123",
 *   userId: currentUser.id,
 *   userName: currentUser.name,
 *   expiresAt: new Date(Date.now() + 60000),
 * });
 *
 * // Heartbeat to keep lock alive
 * await app.collections.admin_locks.update({
 *   id: lockId,
 *   data: { expiresAt: new Date(Date.now() + 60000) },
 * });
 *
 * // Release lock when closing document
 * await app.collections.admin_locks.delete({ id: lockId });
 * ```
 */
export const locksCollection = collection("admin_locks")
	.fields(({ f }) => ({
		// Resource type: "collection" or "global"
		resourceType: f
			.select([
				{ value: "collection", label: "Collection" },
				{ value: "global", label: "Global" },
			])
			.required()
			.label("Resource Type"),

		// Resource name (collection slug or global slug)
		resource: f.text(255).required().label("Resource"),

		// Document ID being locked
		resourceId: f.text(255).required().label("Resource ID"),

		// User who holds the lock (relation to user collection)
		user: f.relation("user").required().label("User"),

		// Browser session ID (unique per tab, allows same user to edit in multiple tabs)
		sessionId: f.text(64).required().label("Session ID"),

		// Lock expiration time (refreshed by heartbeat)
		expiresAt: f.date().required().label("Expires At"),
	}))
	.options({
		timestamps: true,
	});
