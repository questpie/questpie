export type AuditFieldPolicy = "include" | "redact" | "omit";

export type AuditDeliveryMode = "best-effort" | "required";

export type AuditActorType = "anonymous" | "system" | "user" | (string & {});

export interface AuditActorIdentity {
	type: AuditActorType;
	id: string | null;
	name: string;
}

export interface CanonicalAuditEvent {
	id: string;
	timestamp: string;
	outcome: "succeeded" | "failed";
	action: string;
	resource: {
		type: string;
		name: string;
		id: string | null;
	};
	actor: AuditActorIdentity;
	requestId?: string;
	traceId?: string;
	changes: Record<string, unknown> | null;
	metadata: Record<string, unknown> | null;
}

export interface AuditPolicy {
	delivery?: AuditDeliveryMode;
}

/** Flat shape persisted by the backwards-compatible audit collection. */
export interface PersistedAuditEvent {
	id: string;
	createdAt: Date | string;
	action: string;
	resourceType: string;
	resource: string;
	resourceId?: string | null;
	userId?: string | null;
	userName?: string | null;
	changes?: unknown;
	metadata?: unknown;
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function auditActorType(value: unknown, userId: string | null): AuditActorType {
	if (typeof value === "string" && value.length > 0) return value;
	return userId ? "user" : "anonymous";
}

/**
 * Adapt the stable flat persistence shape to the canonical consumer event.
 * Persistence stays unchanged; sinks and other consumers can use this boundary.
 */
export function toCanonicalAuditEvent(
	record: PersistedAuditEvent,
): CanonicalAuditEvent {
	const metadata = recordOrNull(record.metadata);
	const userId = record.userId ?? null;
	const actorId = metadata?.actorId;
	const actorName = metadata?.actorName;
	const outcome = metadata?.outcome;

	return {
		id: record.id,
		timestamp:
			record.createdAt instanceof Date
				? record.createdAt.toISOString()
				: record.createdAt,
		outcome: outcome === "failed" ? "failed" : "succeeded",
		action: record.action,
		resource: {
			type: record.resourceType,
			name: record.resource,
			id: record.resourceId ?? null,
		},
		actor: {
			type: auditActorType(metadata?.actorType, userId),
			id: typeof actorId === "string" || actorId === null ? actorId : userId,
			name:
				typeof actorName === "string"
					? actorName
					: (record.userName ?? "Anonymous"),
		},
		...(typeof metadata?.requestId === "string"
			? { requestId: metadata.requestId }
			: {}),
		...(typeof metadata?.traceId === "string"
			? { traceId: metadata.traceId }
			: {}),
		changes: recordOrNull(record.changes),
		metadata,
	};
}

export const REDACTED_AUDIT_VALUE = "[REDACTED]";
