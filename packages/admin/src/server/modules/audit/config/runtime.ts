import { tryGetContext } from "questpie";

import { AUDIT_LOG_COLLECTION } from "../collections/audit-log.js";
import type {
	AuditPersistenceMode,
	AuditRetentionPolicy,
	AuditSink,
} from "../policy.js";

export interface AuditApp {
	db?: unknown;
	state?: unknown;
	collections?: unknown;
	getCollectionConfig?: (name: string) => unknown;
	getGlobals?: () => unknown;
}

export interface AuditCollectionWriter {
	create(
		data: Record<string, unknown>,
		context: { accessMode: "system"; db?: unknown },
	): Promise<unknown>;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object";
}

export function nestedValue(value: unknown, ...keys: string[]): unknown {
	let current = value;
	for (const key of keys) {
		if (!isRecord(current)) return undefined;
		current = current[key];
	}
	return current;
}

export function resolveAuditApp(override?: unknown): AuditApp | undefined {
	const candidate = override ?? tryGetContext()?.app;
	return isRecord(candidate) ? (candidate as AuditApp) : undefined;
}

export function getAuditCollection(ctx: {
	collections?: unknown;
	app?: unknown;
}): AuditCollectionWriter {
	const appCollections = resolveAuditApp(ctx.app)?.collections;
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

function isAuditCollectionWriter(
	value: unknown,
): value is AuditCollectionWriter {
	return isRecord(value) && typeof value.create === "function";
}

export function isAuditDisabled(
	type: "collection" | "global",
	name: string,
): boolean {
	try {
		const app = resolveAuditApp();
		if (!app) return false;

		if (type === "collection") {
			const config = app.getCollectionConfig?.(name);
			return nestedValue(config, "state", "admin", "audit") === false;
		}
		const globals = app.getGlobals?.();
		if (!isRecord(globals)) return false;
		return nestedValue(globals[name], "state", "admin", "audit") === false;
	} catch {
		return false;
	}
}

export function getAuditPersistence(ctx: {
	app?: unknown;
}): AuditPersistenceMode {
	return resolveAuditPolicy(ctx.app)?.persistence === "required"
		? "required"
		: "best-effort";
}

export function getAuditSink(ctx: { app?: unknown }): AuditSink | undefined {
	const sink = nestedValue(resolveAuditPolicy(ctx.app), "export", "sink");
	return isAuditSink(sink) ? sink : undefined;
}

export function getAuditRetention(ctx: {
	app?: unknown;
}): AuditRetentionPolicy | undefined {
	const retention = resolveAuditPolicy(ctx.app)?.retention;
	return isAuditRetentionPolicy(retention) ? retention : undefined;
}

function resolveAuditPolicy(
	appOverride?: unknown,
): Record<string, unknown> | undefined {
	const app = resolveAuditApp(appOverride);
	const policy = nestedValue(app?.state, "config", "audit");
	return isRecord(policy) ? policy : undefined;
}

function isAuditSink(value: unknown): value is AuditSink {
	return isRecord(value) && typeof value.append === "function";
}

function isAuditRetentionPolicy(value: unknown): value is AuditRetentionPolicy {
	if (!isRecord(value)) return false;
	if (
		value.days !== null &&
		!(
			typeof value.days === "number" &&
			Number.isFinite(value.days) &&
			value.days > 0
		)
	) {
		return false;
	}
	return value.legalHold === undefined || typeof value.legalHold === "function";
}
