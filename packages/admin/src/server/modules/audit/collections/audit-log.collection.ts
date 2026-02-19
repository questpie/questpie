import { index } from "drizzle-orm/pg-core";
import { adminCoreBuilder as q } from "../../../core-builder.js";

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
export const auditLogCollection = q
	.collection("admin_audit_log")
	.fields((f) => ({
		/** Action performed: create, update, delete, transition, custom */
		action: f.text({ required: true, maxLength: 50, label: "Action" }),

		/** Resource type: collection, global, auth, system, custom */
		resourceType: f.text({
			required: true,
			maxLength: 50,
			label: "Resource Type",
		}),

		/** Resource slug (collection/global name) */
		resource: f.text({ required: true, maxLength: 255, label: "Resource" }),

		/** ID of the specific record (null for globals) */
		resourceId: f.text({ maxLength: 255, label: "Resource ID" }),

		/** Denormalized display label for the affected record */
		resourceLabel: f.text({ maxLength: 500, label: "Resource Label" }),

		/** User who performed the action */
		userId: f.text({ maxLength: 255, label: "User ID" }),

		/** Denormalized user display name */
		userName: f.text({ maxLength: 255, label: "User Name" }),

		/** Locale context of the operation */
		locale: f.text({ maxLength: 10, label: "Locale" }),

		/** Field-level diffs: { field: { from, to } } or null */
		changes: f.json({ label: "Changes" }),

		/** Extra context metadata */
		metadata: f.json({ label: "Metadata" }),

		/** Human-readable title: "User Action ResourceType 'ResourceLabel'" */
		title: f.text({ maxLength: 1000, label: "Title" }),
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
	.admin(({ c }) => ({
		label: { key: "audit.collection.label" },
		icon: c.icon("ph:clock-counter-clockwise"),
		description: { key: "audit.collection.description" },
		group: "administration",
		audit: false,
	}))
	.title(({ f }) => f.title)
	.list(({ v, f }) =>
		v.table({
			columns: [f.title, f.userName, "createdAt"],
			searchable: [f.title, f.userName],
			defaultSort: { field: "createdAt", direction: "desc" },
			actions: {
				header: { primary: [], secondary: [] },
				row: [],
				bulk: [],
			},
		}),
	)
	.form(({ v, f }) =>
		v.form({
			fields: [
				{
					type: "section",
					label: { key: "audit.sections.event" },
					layout: "grid",
					columns: 2,
					fields: [
						{ field: f.title },
						{ field: f.action },
						{ field: f.resourceType },
						{ field: f.resource },
						{ field: f.resourceId },
						{ field: f.resourceLabel },
						{ field: f.locale },
					],
				},
				{
					type: "section",
					label: { key: "audit.sections.user" },
					layout: "grid",
					columns: 2,
					fields: [{ field: f.userId }, { field: f.userName }],
				},
				{
					type: "section",
					label: { key: "audit.sections.changes" },
					fields: [{ field: f.changes }, { field: f.metadata }],
				},
			],
		}),
	);
