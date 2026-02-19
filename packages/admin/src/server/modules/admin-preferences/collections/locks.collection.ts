import { q } from "questpie";

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
 * await app.api.collections.adminLocks.create({
 *   resourceType: "collection",
 *   resource: "posts",
 *   resourceId: "123",
 *   userId: currentUser.id,
 *   userName: currentUser.name,
 *   expiresAt: new Date(Date.now() + 60000),
 * });
 *
 * // Heartbeat to keep lock alive
 * await app.api.collections.adminLocks.update({
 *   id: lockId,
 *   data: { expiresAt: new Date(Date.now() + 60000) },
 * });
 *
 * // Release lock when closing document
 * await app.api.collections.adminLocks.delete({ id: lockId });
 * ```
 */
export const locksCollection = q
	.collection("admin_locks")
	.fields((f) => ({
		// Resource type: "collection" or "global"
		resourceType: f.select({
			required: true,
			options: [
				{ value: "collection", label: "Collection" },
				{ value: "global", label: "Global" },
			],
			label: "Resource Type",
		}),

		// Resource name (collection slug or global slug)
		resource: f.text({
			required: true,
			maxLength: 255,
			label: "Resource",
		}),

		// Document ID being locked
		resourceId: f.text({
			required: true,
			maxLength: 255,
			label: "Resource ID",
		}),

		// User who holds the lock (relation to user collection)
		user: f.relation({
			to: "user",
			required: true,
			label: "User",
		}),

		// Browser session ID (unique per tab, allows same user to edit in multiple tabs)
		sessionId: f.text({
			required: true,
			maxLength: 64,
			label: "Session ID",
		}),

		// Lock expiration time (refreshed by heartbeat)
		expiresAt: f.date({
			required: true,
			label: "Expires At",
		}),
	}))
	.options({
		timestamps: true,
	});
