import { index } from "drizzle-orm/pg-core";
import { collection } from "questpie";

import type {
	AdminCollectionConfig,
	FormViewConfig,
	ListViewConfig,
} from "../../../augmentation.js";

/**
 * The collection slug used by the audit log.
 * Exported so hooks and jobs can reference the collection dynamically
 * instead of hardcoding the name.
 */
export const AUDIT_LOG_COLLECTION = "admin_audit_log" as const;

/**
 * Audit Log Collection
 *
 * Stores audit trail entries for all mutations across collections and globals.
 * Automatically populated by global hooks registered via the audit module.
 *
 * Access:
 * - create/delete: system mode only
 * - update: disallowed
 * - read: allowed (for admin UI display)
 */
export const auditLogCollection = collection(AUDIT_LOG_COLLECTION)
	.fields(({ f }) => ({
		/** Action performed: create, update, delete, transition, custom */
		action: f.text(50).required().label("Action"),

		/** Resource type: collection, global, auth, system, custom */
		resourceType: f.text(50).required().label("Resource Type"),

		/** Resource slug (collection/global name) */
		resource: f.text(255).required().label("Resource"),

		/** ID of the specific record (null for globals) */
		resourceId: f.text(255).label("Resource ID"),

		/** Denormalized display label for the affected record */
		resourceLabel: f.text(500).label("Resource Label"),

		/** User who performed the action */
		userId: f.text(255).label("User ID"),

		/** Denormalized user display name */
		userName: f.text(255).label("User Name"),

		/** Locale context of the operation */
		locale: f.text(10).label("Locale"),

		/** Field-level diffs: { field: { from, to } } or null */
		changes: f.json().label("Changes"),

		/** Extra context metadata */
		metadata: f.json().label("Metadata"),

		/** Human-readable title: "User Action ResourceType 'ResourceLabel'" */
		title: f.text(1000).label("Title"),
	}))
	.options({
		timestamps: true,
	})
	.indexes(({ table }) => [
		index("audit_log_resource_type_idx").on(
			table.resource as any,
			table.resourceType as any,
		),
		index("audit_log_user_id_idx").on(table.userId as any),
		index("audit_log_created_at_idx").on(table.createdAt as any),
		index("audit_log_resource_id_idx").on(
			table.resource as any,
			table.resourceId as any,
		),
	])
	.access({
		// create/delete are blocked for user mode; system mode bypasses access checks entirely
		create: false,
		update: false,
		delete: false,
		read: true,
	})
	.set("admin", {
		label: { key: "audit.collection.label" },
		icon: { type: "icon", props: { name: "ph:clock-counter-clockwise" } },
		description: { key: "audit.collection.description" },
		group: "administration",
		audit: false,
	} satisfies AdminCollectionConfig)
	.title(({ f }) => f.title)
	.set("adminList", {
		view: "collection-table",
		columns: ["title", "userName", "createdAt"],
		searchable: ["title", "userName"],
		defaultSort: { field: "createdAt", direction: "desc" },
		actions: {
			header: { primary: [], secondary: [] },
			row: [],
			bulk: [],
		},
	} satisfies ListViewConfig)
	.set("adminForm", {
		view: "collection-form",
		fields: [
			{
				type: "section",
				label: { key: "audit.sections.event" },
				layout: "grid",
				columns: 2,
				fields: [
					{ field: "title" },
					{ field: "action" },
					{ field: "resourceType" },
					{ field: "resource" },
					{ field: "resourceId" },
					{ field: "resourceLabel" },
					{ field: "locale" },
				],
			},
			{
				type: "section",
				label: { key: "audit.sections.user" },
				layout: "grid",
				columns: 2,
				fields: [{ field: "userId" }, { field: "userName" }],
			},
			{
				type: "section",
				label: { key: "audit.sections.changes" },
				fields: [{ field: "changes" }, { field: "metadata" }],
			},
		],
	} satisfies FormViewConfig);
