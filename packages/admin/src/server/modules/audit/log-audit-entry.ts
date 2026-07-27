import { tryGetContext } from "questpie";

import { AUDIT_LOG_COLLECTION } from "./collections/audit-log.js";
import { toAuditJsonSafe } from "./json-safe.js";

/**
 * Options for a custom audit log entry.
 */
export type AuditActorType = "anonymous" | "system" | "user" | (string & {});

export interface LogAuditEntryOptions {
	/** Action performed (e.g., "create", "bulk-email", "archive", "migrate"). */
	action: string;
	/**
	 * Category of the affected resource.
	 * Built-in: "collection" | "global"
	 * Custom: "system" | "job" | "webhook" | any string
	 */
	resourceType: string;
	/** Resource identifier (e.g., collection slug, job name). */
	resource: string;
	/** Optional ID of a specific record. */
	resourceId?: string | null;
	/** Display label for the affected resource (e.g., record title, job description). */
	resourceLabel?: string | null;
	/** Override actor user name (auto-resolved from session when omitted). */
	userName?: string;
	/** Override actor user ID (auto-resolved from session when omitted). */
	userId?: string | null;
	/** Override actor category stored in metadata. */
	actorType?: AuditActorType;
	/** Locale context of the operation. */
	locale?: string | null;
	/** Field-level changes, or arbitrary structured data. */
	changes?: Record<string, unknown> | null;
	/** Extra metadata (e.g., job payload, webhook source). */
	metadata?: Record<string, unknown> | null;
}

/**
 * Audit context — pass the hook/job context directly.
 * Needs `collections` (or `app.collections`) and optionally `session`, `db`.
 */
export interface AuditContext {
	collections?: Record<string, any>;
	app?: {
		collections?: Record<string, any>;
		getCollectionConfig?: (slug: string) => any;
		getGlobals?: () => Record<string, any>;
	};
	session?: { user?: Record<string, unknown> | null } | null;
	accessMode?: string;
	db?: unknown;
	logger?: { error?: (...args: any[]) => void };
}

function resolveCollections(ctx: AuditContext): Record<string, any> | null {
	return ctx.collections ?? ctx.app?.collections ?? null;
}

function resolveActor(ctx: AuditContext): {
	actorType: AuditActorType;
	userId: string | null;
	userName: string;
} {
	const user = ctx.session?.user;
	const userId = user?.id != null ? String(user.id) : null;

	for (const candidate of [user?.name, user?.email, userId]) {
		if (typeof candidate === "string" && candidate.trim().length > 0) {
			return { actorType: "user", userId, userName: candidate.trim() };
		}
	}

	if (ctx.accessMode === "system") {
		return { actorType: "system", userId: "system", userName: "System" };
	}
	return { actorType: "anonymous", userId: null, userName: "Anonymous" };
}

function getResourceTypeLabel(
	ctx: AuditContext,
	resourceType: string,
	resource: string,
): string {
	const stored = tryGetContext();
	const app = ctx.app ?? (stored?.app as AuditContext["app"] | undefined);
	if (!app) return resource;

	if (resourceType === "collection") {
		const config = app.getCollectionConfig?.(resource);
		const label = config?.state?.admin?.label ?? config?.state?.label;
		if (typeof label === "string") return label;
		return resource;
	}
	if (resourceType === "global") {
		const config = app.getGlobals?.()?.[resource];
		const label = config?.state?.admin?.label ?? config?.state?.label;
		if (typeof label === "string") return label;
		return resource;
	}
	return resource;
}

function resolveActorType(
	actor: ReturnType<typeof resolveActor>,
	options: LogAuditEntryOptions,
	userId: string | null,
): AuditActorType {
	if (options.actorType) return options.actorType;
	if (options.userId !== undefined || options.userName !== undefined) {
		return userId && userId !== "system" ? "user" : "system";
	}
	return actor.actorType;
}

/**
 * Write a custom audit log entry.
 *
 * Use this in jobs, custom actions, webhooks, or anywhere you want
 * to record a meaningful event in the audit trail.
 *
 * @example
 * ```ts
 * import { logAuditEntry } from "@questpie/admin/server";
 *
 * // Inside a job handler:
 * await logAuditEntry(ctx, {
 *   action: "bulk-email",
 *   resourceType: "system",
 *   resource: "newsletter",
 *   resourceLabel: "Q1 Campaign",
 *   metadata: { sentCount: 1234, jobId: ctx.id },
 * });
 *
 * // Inside a collection hook with session:
 * await logAuditEntry(ctx, {
 *   action: "export",
 *   resourceType: "collection",
 *   resource: "orders",
 *   resourceLabel: "Monthly export",
 *   changes: { format: { from: null, to: "csv" } },
 * });
 * ```
 */
export async function logAuditEntry(
	ctx: AuditContext,
	options: LogAuditEntryOptions,
): Promise<void> {
	const collections = resolveCollections(ctx);
	if (!collections?.[AUDIT_LOG_COLLECTION]) {
		ctx.logger?.error?.(
			"[Audit] Cannot write audit entry — audit log collection not available",
		);
		return;
	}

	const actor = resolveActor(ctx);
	const userName = options.userName ?? actor.userName;
	const userId = options.userId !== undefined ? options.userId : actor.userId;
	const actorType = resolveActorType(actor, options, userId);
	const resourceTypeLabel = getResourceTypeLabel(
		ctx,
		options.resourceType,
		options.resource,
	);
	const resourceLabel = options.resourceLabel ?? null;
	const label = resourceLabel || "(unnamed)";

	const actionText: Record<string, string> = {
		create: "created",
		update: "updated",
		delete: "deleted",
		transition: "changed status of",
	};
	const actionVerb = actionText[options.action] || options.action;
	const title = `${userName} ${actionVerb} ${resourceTypeLabel} '${label}'`;

	await collections[AUDIT_LOG_COLLECTION].create(
		{
			action: options.action,
			resourceType: options.resourceType,
			resource: options.resource,
			resourceId: options.resourceId ?? null,
			resourceLabel,
			userId,
			userName,
			locale: options.locale ?? null,
			changes: toAuditJsonSafe(options.changes ?? null) as Record<
				string,
				unknown
			> | null,
			metadata: toAuditJsonSafe({
				actorType,
				accessMode: ctx.accessMode ?? "system",
				...(options.metadata ?? {}),
			}) as Record<string, unknown>,
			title,
		},
		{
			accessMode: "system" as const,
			db: ctx.db,
		},
	);
}
