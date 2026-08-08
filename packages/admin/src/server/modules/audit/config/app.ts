import type {
	GlobalCollectionHookContext,
	GlobalCollectionTransitionHookContext,
	GlobalGlobalHookContext,
	GlobalGlobalTransitionHookContext,
} from "questpie";
import { appConfig, tryGetContext } from "questpie";
import type { RequestContextLogger } from "questpie/types";

import { AUDIT_LOG_COLLECTION } from "../collections/audit-log.js";
import { toAuditJsonSafe } from "../json-safe.js";
import {
	REDACTED_AUDIT_VALUE,
	type AuditDeliveryMode,
	type AuditFieldPolicy,
	type AuditSink,
	type PersistedAuditEvent,
	toCanonicalAuditEvent,
} from "../policy.js";

interface AuditApp {
	state?: unknown;
	collections?: unknown;
	getCollectionConfig?: (name: string) => unknown;
	getGlobals?: () => unknown;
}

interface AuditCollectionWriter {
	create(
		data: Record<string, unknown>,
		context: { accessMode: "system"; db?: unknown },
	): Promise<unknown>;
}

function isAuditApp(value: unknown): value is AuditApp {
	return isRecord(value);
}

function nestedValue(value: unknown, ...keys: string[]): unknown {
	let current = value;
	for (const key of keys) {
		if (!isRecord(current)) return undefined;
		current = current[key];
	}
	return current;
}

function resolveAuditApp(override?: unknown): AuditApp | undefined {
	const candidate = override ?? tryGetContext()?.app;
	return isAuditApp(candidate) ? candidate : undefined;
}

function isAuditCollectionWriter(
	value: unknown,
): value is AuditCollectionWriter {
	return isRecord(value) && typeof value.create === "function";
}

function getAuditCollection(ctx: {
	collections?: unknown;
	app?: unknown;
}): AuditCollectionWriter {
	const appCollections = isAuditApp(ctx.app) ? ctx.app.collections : undefined;
	const collections = isRecord(ctx.collections)
		? ctx.collections
		: isRecord(appCollections)
			? appCollections
			: undefined;
	const auditCollection = collections?.[AUDIT_LOG_COLLECTION];
	if (!isAuditCollectionWriter(auditCollection)) {
		throw new Error("Audit log collection is not available");
	}
	return auditCollection;
}

/**
 * Check if a collection/global has `audit: false` in its `.admin()` config.
 */
function isAuditDisabled(type: "collection" | "global", name: string): boolean {
	try {
		const app = resolveAuditApp();
		if (!app) return false;

		if (type === "collection") {
			const config = app.getCollectionConfig?.(name);
			return nestedValue(config, "state", "admin", "audit") === false;
		}
		const globals = app.getGlobals?.();
		if (!isRecord(globals)) return false;
		const config = globals?.[name];
		return nestedValue(config, "state", "admin", "audit") === false;
	} catch {
		return false;
	}
}

/**
 * Compute field-level changes between original and current data.
 * Returns an object of `{ field: { from, to } }` or null if no meaningful changes.
 */
const SKIP_CHANGE_FIELDS = new Set(["updatedAt", "createdAt", "id"]);

function shouldSkipChangeField(key: string): boolean {
	return SKIP_CHANGE_FIELDS.has(key) || key.startsWith("_");
}

function getAuditDelivery(ctx: { app?: unknown }): AuditDeliveryMode {
	const app = resolveAuditApp(ctx.app);
	return nestedValue(app?.state, "config", "audit", "delivery") === "required"
		? "required"
		: "best-effort";
}

function getAuditSink(ctx: { app?: unknown }): AuditSink | undefined {
	const app = resolveAuditApp(ctx.app);
	const sink = nestedValue(app?.state, "config", "audit", "sink");
	return isAuditSink(sink) ? sink : undefined;
}

function isAuditSink(value: unknown): value is AuditSink {
	return isRecord(value) && typeof value.append === "function";
}

async function persistAuditEvent(
	ctx: { app?: unknown; db?: unknown },
	auditCollection: AuditCollectionWriter,
	data: Record<string, unknown>,
): Promise<void> {
	const stored = await auditCollection.create(data, {
		accessMode: "system",
		db: ctx.db,
	});
	const sink = getAuditSink(ctx);
	if (!sink) return;
	await sink.append(toCanonicalAuditEvent(stored as PersistedAuditEvent));
}

const CREDENTIAL_FIELD_PATTERN =
	/(?:password|passphrase|secret|token|api[_-]?key|authorization|cookie)/i;

function getFieldPolicy(
	type: "collection" | "global",
	name: string,
	key: string,
	appOverride?: unknown,
): AuditFieldPolicy {
	const app = resolveAuditApp(appOverride);
	const globalsCandidate = type === "global" ? app?.getGlobals?.() : undefined;
	const globals = isRecord(globalsCandidate) ? globalsCandidate : undefined;
	const owner =
		type === "collection"
			? app?.getCollectionConfig?.(name)
			: (globals?.[name] ??
				Object.values(globals ?? {}).find(
					(global) => nestedValue(global, "state", "name") === name,
				));
	// Field extensions intentionally live in the builder's runtime state.
	// oxlint-disable-next-line eslint(no-underscore-dangle)
	const configured = nestedValue(
		owner,
		"state",
		"fieldDefinitions",
		key,
		"_state",
		"extensions",
		"audit",
	);
	if (
		configured === "include" ||
		configured === "redact" ||
		configured === "omit"
	) {
		return configured;
	}
	return CREDENTIAL_FIELD_PATTERN.test(key) ? "omit" : "include";
}

function classifyAuditValue(policy: AuditFieldPolicy, value: unknown): unknown {
	return policy === "redact" ? REDACTED_AUDIT_VALUE : toAuditJsonSafe(value);
}

function makeFieldChangeMap(
	data: Record<string, any> | null | undefined,
	direction: "create" | "delete",
	type: "collection" | "global",
	name: string,
	app?: unknown,
): Record<string, { from: any; to: any }> | null {
	if (!data) return null;

	const changes: Record<string, { from: any; to: any }> = {};

	for (const key of Object.keys(data)) {
		if (shouldSkipChangeField(key)) continue;
		const policy = getFieldPolicy(type, name, key, app);
		if (policy === "omit") continue;

		const value = data[key];
		if (value == null) continue;

		const safeValue = classifyAuditValue(policy, value);
		changes[key] =
			direction === "create"
				? { from: null, to: safeValue }
				: { from: safeValue, to: null };
	}

	return Object.keys(changes).length > 0 ? changes : null;
}

function computeChanges(
	original: Record<string, any> | undefined,
	current: Record<string, any>,
	type: "collection" | "global",
	name: string,
	app?: unknown,
): Record<string, { from: any; to: any }> | null {
	if (!original) return null;

	const changes: Record<string, { from: any; to: any }> = {};

	for (const key of Object.keys(current)) {
		if (shouldSkipChangeField(key)) continue;
		const policy = getFieldPolicy(type, name, key, app);
		if (policy === "omit") continue;

		const fromVal = original[key];
		const toVal = current[key];

		// Skip if both are undefined/null
		if (fromVal == null && toVal == null) continue;

		// Use JSON.stringify for deep comparison
		if (JSON.stringify(fromVal) !== JSON.stringify(toVal)) {
			changes[key] = {
				from: classifyAuditValue(policy, fromVal ?? null),
				to: classifyAuditValue(policy, toVal ?? null),
			};
		}
	}

	return Object.keys(changes).length > 0 ? changes : null;
}

/**
 * Extract a display label from data, trying common field names.
 */
function extractLabel(
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
	type: "collection" | "global",
	name: string,
): string {
	try {
		const stored = tryGetContext();
		const app = stored?.app as any;
		if (!app) return name;

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
 */
function generateTitle(
	action: string,
	_resourceType: "collection" | "global",
	resourceTypeLabel: string,
	resourceLabel: string | null,
	userName: string,
): string {
	const resource = resourceLabel || "(unnamed)";

	const actionText: Record<string, string> = {
		create: "created",
		update: "updated",
		delete: "deleted",
		purge: "purged",
		transition: "changed status of",
	};

	const actionVerb = actionText[action] || action;

	return `${userName} ${actionVerb} ${resourceTypeLabel} '${resource}'`;
}

type AuditActor = {
	actorType: "anonymous" | "system" | "user";
	userId: string | null;
	userName: string;
};

function firstNonEmptyString(...values: unknown[]): string | null {
	for (const value of values) {
		if (typeof value !== "string") continue;
		const trimmed = value.trim();
		if (trimmed.length > 0) return trimmed;
	}
	return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object";
}

function resolveAuditActor(ctx: {
	session?: unknown;
	accessMode?: string;
	workload?: unknown;
}): AuditActor {
	const session = isRecord(ctx.session) ? ctx.session : null;
	const user = isRecord(session?.user) ? session.user : null;
	const userId = user?.id != null ? String(user.id) : null;
	const userName = firstNonEmptyString(user?.name, user?.email, userId);
	if (userName) {
		return { actorType: "user", userId, userName };
	}

	if (ctx.accessMode === "system") {
		const workload = isRecord(ctx.workload) ? ctx.workload : null;
		const workloadId = firstNonEmptyString(workload?.id, workload?.name);
		if (workloadId) {
			return {
				actorType: "system",
				userId: workloadId,
				userName: firstNonEmptyString(workload?.name, workloadId)!,
			};
		}
		return { actorType: "system", userId: "system", userName: "System" };
	}

	return { actorType: "anonymous", userId: null, userName: "Anonymous" };
}

function buildAuditMetadata(
	ctx: { accessMode?: string; requestId?: string; traceId?: string },
	actor: AuditActor,
	extra?: Record<string, unknown>,
): Record<string, unknown> {
	return {
		actorType: actor.actorType,
		actorId: actor.userId,
		actorName: actor.userName,
		accessMode: ctx.accessMode ?? null,
		outcome: "succeeded",
		...(ctx.requestId ? { requestId: ctx.requestId } : {}),
		...(ctx.traceId ? { traceId: ctx.traceId } : {}),
		...extra,
	};
}

function logAuditFailure(
	ctx: { logger?: RequestContextLogger },
	message: string,
	err: unknown,
	details: { operation: string; resource: string },
) {
	ctx.logger?.error?.(message, {
		error:
			err instanceof Error
				? { name: err.name, message: err.message }
				: { message: String(err) },
		...details,
	});
}

function handleAuditFailure(
	ctx: { app?: unknown; logger?: RequestContextLogger },
	message: string,
	err: unknown,
	details: { operation: string; resource: string },
): void {
	if (getAuditDelivery(ctx) === "required") throw err;
	logAuditFailure(ctx, message, err, details);
}

// ============================================================================
// Hook implementations
// ============================================================================

async function collectionAfterChange(ctx: GlobalCollectionHookContext) {
	try {
		const auditCollection = getAuditCollection(ctx);

		if (isAuditDisabled("collection", ctx.collection)) return;

		const action = ctx.operation === "create" ? "create" : "update";
		const changes =
			ctx.operation === "update"
				? computeChanges(
						ctx.original,
						ctx.data,
						"collection",
						ctx.collection,
						ctx.app,
					)
				: makeFieldChangeMap(
						ctx.data,
						"create",
						"collection",
						ctx.collection,
						ctx.app,
					);

		if (ctx.operation === "update" && !changes) return;

		const resourceLabel = extractLabel(ctx.data);
		const actor = resolveAuditActor(ctx);
		const resourceTypeLabel = getResourceTypeLabel(
			"collection",
			ctx.collection,
		);

		await persistAuditEvent(ctx, auditCollection, {
			action,
			resourceType: "collection",
			resource: ctx.collection,
			resourceId: ctx.data?.id ? String(ctx.data.id) : null,
			resourceLabel,
			userId: actor.userId,
			userName: actor.userName,
			locale: ctx.locale || null,
			changes,
			metadata: buildAuditMetadata(ctx, actor, {
				operation: ctx.operation,
			}),
			title: generateTitle(
				action,
				"collection",
				resourceTypeLabel,
				resourceLabel,
				actor.userName,
			),
		});
	} catch (err) {
		handleAuditFailure(
			ctx,
			`[Audit] Failed to log ${ctx.operation} for collection "${ctx.collection}":`,
			err,
			{ operation: ctx.operation, resource: ctx.collection },
		);
	}
}

async function collectionAfterDelete(ctx: GlobalCollectionHookContext) {
	try {
		const auditCollection = getAuditCollection(ctx);

		if (isAuditDisabled("collection", ctx.collection)) return;

		const resourceLabel = extractLabel(ctx.data);
		const actor = resolveAuditActor(ctx);
		const resourceTypeLabel = getResourceTypeLabel(
			"collection",
			ctx.collection,
		);

		await persistAuditEvent(ctx, auditCollection, {
			action: "delete",
			resourceType: "collection",
			resource: ctx.collection,
			resourceId: ctx.data?.id ? String(ctx.data.id) : null,
			resourceLabel,
			userId: actor.userId,
			userName: actor.userName,
			locale: ctx.locale || null,
			changes: makeFieldChangeMap(
				ctx.data,
				"delete",
				"collection",
				ctx.collection,
				ctx.app,
			),
			metadata: buildAuditMetadata(ctx, actor, {
				operation: "delete",
			}),
			title: generateTitle(
				"delete",
				"collection",
				resourceTypeLabel,
				resourceLabel,
				actor.userName,
			),
		});
	} catch (err) {
		handleAuditFailure(
			ctx,
			`[Audit] Failed to log delete for collection "${ctx.collection}":`,
			err,
			{ operation: "delete", resource: ctx.collection },
		);
	}
}

async function collectionAfterPurge(ctx: GlobalCollectionHookContext) {
	try {
		const auditCollection = getAuditCollection(ctx);

		if (isAuditDisabled("collection", ctx.collection)) return;

		const actor = resolveAuditActor(ctx);
		const resourceTypeLabel = getResourceTypeLabel(
			"collection",
			ctx.collection,
		);
		const resourceId = ctx.data?.id ? String(ctx.data.id) : null;

		await persistAuditEvent(ctx, auditCollection, {
			action: "purge",
			resourceType: "collection",
			resource: ctx.collection,
			resourceId,
			// The irreversible fact must not retain the purged row's label
			// or field-level preimage.
			resourceLabel: null,
			userId: actor.userId,
			userName: actor.userName,
			locale: ctx.locale || null,
			changes: null,
			metadata: buildAuditMetadata(ctx, actor, {
				operation: "purge",
			}),
			title: generateTitle(
				"purge",
				"collection",
				resourceTypeLabel,
				resourceId,
				actor.userName,
			),
		});
	} catch (err) {
		handleAuditFailure(
			ctx,
			`[Audit] Failed to log purge for collection "${ctx.collection}":`,
			err,
			{ operation: "purge", resource: ctx.collection },
		);
	}
}

async function collectionAfterTransition(
	ctx: GlobalCollectionTransitionHookContext,
) {
	try {
		const auditCollection = getAuditCollection(ctx);

		if (isAuditDisabled("collection", ctx.collection)) return;

		const resourceLabel = extractLabel(ctx.data);
		const actor = resolveAuditActor(ctx);
		const resourceTypeLabel = getResourceTypeLabel(
			"collection",
			ctx.collection,
		);

		await persistAuditEvent(ctx, auditCollection, {
			action: "transition",
			resourceType: "collection",
			resource: ctx.collection,
			resourceId: ctx.data?.id ? String(ctx.data.id) : null,
			resourceLabel,
			userId: actor.userId,
			userName: actor.userName,
			locale: ctx.locale || null,
			changes: {
				stage: { from: ctx.fromStage, to: ctx.toStage },
			},
			metadata: buildAuditMetadata(ctx, actor, {
				fromStage: ctx.fromStage,
				toStage: ctx.toStage,
			}),
			title: generateTitle(
				"transition",
				"collection",
				resourceTypeLabel,
				resourceLabel,
				actor.userName,
			),
		});
	} catch (err) {
		handleAuditFailure(
			ctx,
			`[Audit] Failed to log transition for collection "${ctx.collection}":`,
			err,
			{ operation: "transition", resource: ctx.collection },
		);
	}
}

async function globalAfterChange(ctx: GlobalGlobalHookContext) {
	try {
		const auditCollection = getAuditCollection(ctx);

		if (isAuditDisabled("global", ctx.global)) return;

		const actor = resolveAuditActor(ctx);
		const resourceTypeLabel = getResourceTypeLabel("global", ctx.global);
		const current = isRecord(ctx.input)
			? { ...ctx.original, ...ctx.input }
			: ctx.data;

		await persistAuditEvent(ctx, auditCollection, {
			action: "update",
			resourceType: "global",
			resource: ctx.global,
			resourceId: null,
			resourceLabel: ctx.global,
			userId: actor.userId,
			userName: actor.userName,
			locale: ctx.locale || null,
			changes: computeChanges(
				ctx.original,
				current,
				"global",
				ctx.global,
				ctx.app,
			),
			metadata: buildAuditMetadata(ctx, actor, {
				operation: "update",
			}),
			title: generateTitle(
				"update",
				"global",
				resourceTypeLabel,
				ctx.global,
				actor.userName,
			),
		});
	} catch (err) {
		handleAuditFailure(
			ctx,
			`[Audit] Failed to log update for global "${ctx.global}":`,
			err,
			{ operation: "update", resource: ctx.global },
		);
	}
}

async function globalAfterTransition(ctx: GlobalGlobalTransitionHookContext) {
	try {
		const auditCollection = getAuditCollection(ctx);

		if (isAuditDisabled("global", ctx.global)) return;

		const actor = resolveAuditActor(ctx);
		const resourceTypeLabel = getResourceTypeLabel("global", ctx.global);

		await persistAuditEvent(ctx, auditCollection, {
			action: "transition",
			resourceType: "global",
			resource: ctx.global,
			resourceId: null,
			resourceLabel: ctx.global,
			userId: actor.userId,
			userName: actor.userName,
			locale: ctx.locale || null,
			changes: {
				stage: { from: ctx.fromStage, to: ctx.toStage },
			},
			metadata: buildAuditMetadata(ctx, actor, {
				fromStage: ctx.fromStage,
				toStage: ctx.toStage,
			}),
			title: generateTitle(
				"transition",
				"global",
				resourceTypeLabel,
				ctx.global,
				actor.userName,
			),
		});
	} catch (err) {
		handleAuditFailure(
			ctx,
			`[Audit] Failed to log transition for global "${ctx.global}":`,
			err,
			{ operation: "transition", resource: ctx.global },
		);
	}
}

// ============================================================================
// Default export — audit hooks via appConfig pattern
// ============================================================================

/**
 * Audit hooks contributed by the audit module.
 * Intercepts all collection and global mutations to create audit log entries.
 */
export default appConfig({
	hooks: {
		collections: {
			afterChange: collectionAfterChange,
			afterDelete: collectionAfterDelete,
			afterPurge: collectionAfterPurge,
			afterTransition: collectionAfterTransition,
		},
		globals: {
			afterChange: globalAfterChange,
			afterTransition: globalAfterTransition,
		},
	},
});
