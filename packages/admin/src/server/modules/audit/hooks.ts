import type {
	GlobalCollectionHookContext,
	GlobalCollectionTransitionHookContext,
	GlobalGlobalHookContext,
	GlobalGlobalTransitionHookContext,
} from "questpie";

/**
 * Check if a collection/global has `audit: false` in its `.admin()` config.
 */
function isAuditDisabled(
	app: any,
	type: "collection" | "global",
	name: string,
): boolean {
	try {
		if (type === "collection") {
			const config = app.getCollectionConfig?.(name);
			return config?.state?.admin?.audit === false;
		}
		const globals = app.getGlobals?.();
		const config = globals?.[name];
		return config?.state?.admin?.audit === false;
	} catch {
		return false;
	}
}

/**
 * Compute field-level changes between original and current data.
 * Returns an object of `{ field: { from, to } }` or null if no meaningful changes.
 */
export function computeChanges(
	original: Record<string, any> | undefined,
	current: Record<string, any>,
): Record<string, { from: any; to: any }> | null {
	if (!original) return null;

	const changes: Record<string, { from: any; to: any }> = {};
	const skipFields = new Set(["updatedAt", "createdAt", "id"]);

	for (const key of Object.keys(current)) {
		if (skipFields.has(key) || key.startsWith("_")) continue;

		const fromVal = original[key];
		const toVal = current[key];

		// Skip if both are undefined/null
		if (fromVal == null && toVal == null) continue;

		// Use JSON.stringify for deep comparison
		if (JSON.stringify(fromVal) !== JSON.stringify(toVal)) {
			changes[key] = { from: fromVal ?? null, to: toVal ?? null };
		}
	}

	return Object.keys(changes).length > 0 ? changes : null;
}

/**
 * Extract a display label from data, trying common field names.
 */
export function extractLabel(
	data: Record<string, any> | null | undefined,
): string | null {
	if (!data) return null;
	const candidates = ["_title", "title", "name", "label", "slug", "id"];
	for (const field of candidates) {
		const val = data[field];
		if (val != null && typeof val === "string" && val.length > 0) {
			return val.length > 200 ? `${val.slice(0, 200)}...` : val;
		}
	}
	return null;
}

/**
 * Get the display label for a resource type (collection or global).
 * Falls back to the slug if no label is configured.
 */
function getResourceTypeLabel(
	app: any,
	type: "collection" | "global",
	name: string,
): string {
	try {
		if (type === "collection") {
			const config = app.getCollectionConfig?.(name);
			const label = config?.state?.admin?.label;
			if (typeof label === "string") return label;
			if (label?.key) return name; // Fallback for i18n keys
			return config?.state?.label || name;
		}
		// For globals
		const globals = app.getGlobals?.();
		const config = globals?.[name];
		const label = config?.state?.admin?.label;
		if (typeof label === "string") return label;
		if (label?.key) return name;
		return config?.state?.label || name;
	} catch {
		return name;
	}
}

/**
 * Generate a human-readable title for the audit log entry.
 * Format: "{userName} {action} {resourceTypeLabel} '{resourceLabel}'"
 */
function generateTitle(
	action: string,
	resourceType: "collection" | "global",
	resourceTypeLabel: string,
	resourceLabel: string | null,
	userName: string | null,
): string {
	const user = userName || "Unknown";
	const resource = resourceLabel || "(unnamed)";

	// Action translations
	const actionText: Record<string, string> = {
		create: "created",
		update: "updated",
		delete: "deleted",
		transition: "changed status of",
	};

	const actionVerb = actionText[action] || action;

	return `${user} ${actionVerb} ${resourceTypeLabel} '${resource}'`;
}

/**
 * Create global collection hooks for audit logging.
 */
export function createCollectionAuditHooks() {
	return {
		async afterChange(ctx: GlobalCollectionHookContext) {
			try {
				const app = ctx.app as any;

				// Skip collections with audit: false
				if (isAuditDisabled(app, "collection", ctx.collection)) return;

				const action = ctx.operation === "create" ? "create" : "update";

				const changes =
					ctx.operation === "update"
						? computeChanges(ctx.original, ctx.data)
						: null;

				// For updates with no meaningful changes, skip logging
				if (ctx.operation === "update" && !changes) return;

				const resourceLabel = extractLabel(ctx.data);
				const userName =
					ctx.session?.user?.name || ctx.session?.user?.email || null;
				const resourceTypeLabel = getResourceTypeLabel(
					app,
					"collection",
					ctx.collection,
				);

				await app.api.collections.adminAuditLog.create(
					{
						action,
						resourceType: "collection",
						resource: ctx.collection,
						resourceId: ctx.data?.id ? String(ctx.data.id) : null,
						resourceLabel,
						userId: ctx.session?.user?.id ? String(ctx.session.user.id) : null,
						userName,
						locale: ctx.locale || null,
						changes,
						metadata: null,
						title: generateTitle(
							action,
							"collection",
							resourceTypeLabel,
							resourceLabel,
							userName,
						),
					},
					{
						accessMode: "system",
						db: ctx.db,
					},
				);
			} catch (err) {
				console.error(
					`[Audit] Failed to log ${ctx.operation} for collection "${ctx.collection}":`,
					err,
				);
			}
		},

		async afterDelete(ctx: GlobalCollectionHookContext) {
			try {
				const app = ctx.app as any;

				// Skip collections with audit: false
				if (isAuditDisabled(app, "collection", ctx.collection)) return;

				const resourceLabel = extractLabel(ctx.data);
				const userName =
					ctx.session?.user?.name || ctx.session?.user?.email || null;
				const resourceTypeLabel = getResourceTypeLabel(
					app,
					"collection",
					ctx.collection,
				);

				await app.api.collections.adminAuditLog.create(
					{
						action: "delete",
						resourceType: "collection",
						resource: ctx.collection,
						resourceId: ctx.data?.id ? String(ctx.data.id) : null,
						resourceLabel,
						userId: ctx.session?.user?.id ? String(ctx.session.user.id) : null,
						userName,
						locale: ctx.locale || null,
						changes: null,
						metadata: null,
						title: generateTitle(
							"delete",
							"collection",
							resourceTypeLabel,
							resourceLabel,
							userName,
						),
					},
					{
						accessMode: "system",
						db: ctx.db,
					},
				);
			} catch (err) {
				console.error(
					`[Audit] Failed to log delete for collection "${ctx.collection}":`,
					err,
				);
			}
		},

		/**
		 * Log workflow stage transitions for collections.
		 * Records the from/to stage in both `changes` and `metadata`
		 * so the History sidebar can display a clean stage diff.
		 */
		async afterTransition(ctx: GlobalCollectionTransitionHookContext) {
			try {
				const app = ctx.app as any;

				// Skip collections with audit: false
				if (isAuditDisabled(app, "collection", ctx.collection)) return;

				const resourceLabel = extractLabel(ctx.data);
				const userName =
					ctx.session?.user?.name || ctx.session?.user?.email || null;
				const resourceTypeLabel = getResourceTypeLabel(
					app,
					"collection",
					ctx.collection,
				);

				await app.api.collections.adminAuditLog.create(
					{
						action: "transition",
						resourceType: "collection",
						resource: ctx.collection,
						resourceId: ctx.data?.id ? String(ctx.data.id) : null,
						resourceLabel,
						userId: ctx.session?.user?.id ? String(ctx.session.user.id) : null,
						userName,
						locale: ctx.locale || null,
						changes: {
							stage: { from: ctx.fromStage, to: ctx.toStage },
						},
						metadata: {
							fromStage: ctx.fromStage,
							toStage: ctx.toStage,
						},
						title: generateTitle(
							"transition",
							"collection",
							resourceTypeLabel,
							resourceLabel,
							userName,
						),
					},
					{
						accessMode: "system",
						db: ctx.db,
					},
				);
			} catch (err) {
				console.error(
					`[Audit] Failed to log transition for collection "${ctx.collection}":`,
					err,
				);
			}
		},
	};
}

/**
 * Create global global hooks for audit logging.
 */
export function createGlobalAuditHooks() {
	return {
		async afterChange(ctx: GlobalGlobalHookContext) {
			try {
				const app = ctx.app as any;

				// Skip globals with audit: false
				if (isAuditDisabled(app, "global", ctx.global)) return;

				const userName =
					ctx.session?.user?.name || ctx.session?.user?.email || null;
				const resourceTypeLabel = getResourceTypeLabel(
					app,
					"global",
					ctx.global,
				);

				await app.api.collections.adminAuditLog.create(
					{
						action: "update",
						resourceType: "global",
						resource: ctx.global,
						resourceId: null,
						resourceLabel: ctx.global,
						userId: ctx.session?.user?.id ? String(ctx.session.user.id) : null,
						userName,
						locale: ctx.locale || null,
						changes: null,
						metadata: null,
						title: generateTitle(
							"update",
							"global",
							resourceTypeLabel,
							ctx.global,
							userName,
						),
					},
					{
						accessMode: "system",
						db: ctx.db,
					},
				);
			} catch (err) {
				console.error(
					`[Audit] Failed to log update for global "${ctx.global}":`,
					err,
				);
			}
		},

		/**
		 * Log workflow stage transitions for globals.
		 * Records the from/to stage in both `changes` and `metadata`.
		 */
		async afterTransition(ctx: GlobalGlobalTransitionHookContext) {
			try {
				const app = ctx.app as any;

				// Skip globals with audit: false
				if (isAuditDisabled(app, "global", ctx.global)) return;

				const userName =
					ctx.session?.user?.name || ctx.session?.user?.email || null;
				const resourceTypeLabel = getResourceTypeLabel(
					app,
					"global",
					ctx.global,
				);

				await app.api.collections.adminAuditLog.create(
					{
						action: "transition",
						resourceType: "global",
						resource: ctx.global,
						resourceId: null,
						resourceLabel: ctx.global,
						userId: ctx.session?.user?.id ? String(ctx.session.user.id) : null,
						userName,
						locale: ctx.locale || null,
						changes: {
							stage: { from: ctx.fromStage, to: ctx.toStage },
						},
						metadata: {
							fromStage: ctx.fromStage,
							toStage: ctx.toStage,
						},
						title: generateTitle(
							"transition",
							"global",
							resourceTypeLabel,
							ctx.global,
							userName,
						),
					},
					{
						accessMode: "system",
						db: ctx.db,
					},
				);
			} catch (err) {
				console.error(
					`[Audit] Failed to log transition for global "${ctx.global}":`,
					err,
				);
			}
		},
	};
}
