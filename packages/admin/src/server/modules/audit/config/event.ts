import { toAuditJsonSafe } from "../json-safe.js";
import {
	REDACTED_AUDIT_VALUE,
	type AuditActorType,
	type AuditFieldPolicy,
} from "../policy.js";
import { isRecord, nestedValue, resolveAuditApp } from "./runtime.js";

const SKIP_CHANGE_FIELDS = new Set(["updatedAt", "createdAt", "id"]);
const CREDENTIAL_FIELD_PATTERN =
	/(?:password|passphrase|secret|token|api[_-]?key|authorization|cookie)/i;

export type AuditActor = {
	actorType: AuditActorType;
	userId: string | null;
	userName: string;
};

function shouldSkipChangeField(key: string): boolean {
	return SKIP_CHANGE_FIELDS.has(key) || key.startsWith("_");
}

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

export function makeFieldChangeMap(
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

export function computeChanges(
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
		if (fromVal == null && toVal == null) continue;
		if (JSON.stringify(fromVal) !== JSON.stringify(toVal)) {
			changes[key] = {
				from: classifyAuditValue(policy, fromVal ?? null),
				to: classifyAuditValue(policy, toVal ?? null),
			};
		}
	}
	return Object.keys(changes).length > 0 ? changes : null;
}

export function extractLabel(
	data: Record<string, any> | null | undefined,
): string | null {
	if (!data) return null;
	for (const field of ["_title", "title", "name", "label", "slug", "id"]) {
		const value = data[field];
		if (typeof value === "string" && value.length > 0) {
			return value.length > 200 ? `${value.slice(0, 200)}...` : value;
		}
	}
	return null;
}

export function getResourceTypeLabel(
	type: "collection" | "global",
	name: string,
): string {
	try {
		const app = resolveAuditApp();
		if (!app) return name;
		const globals = app.getGlobals?.();
		const config =
			type === "collection"
				? app.getCollectionConfig?.(name)
				: isRecord(globals)
					? globals[name]
					: undefined;
		const label = nestedValue(config, "state", "admin", "label");
		if (typeof label === "string") return label;
		if (isRecord(label) && label.key) return name;
		const fallback = nestedValue(config, "state", "label");
		return typeof fallback === "string" ? fallback : name;
	} catch {
		return name;
	}
}

export function generateTitle(
	action: string,
	resourceTypeLabel: string,
	resourceLabel: string | null,
	userName: string,
): string {
	const verbs: Record<string, string> = {
		create: "created",
		update: "updated",
		delete: "deleted",
		purge: "purged",
		transition: "changed status of",
	};
	return `${userName} ${verbs[action] || action} ${resourceTypeLabel} '${resourceLabel || "(unnamed)"}'`;
}

export interface AuditEventInput {
	action: string;
	resourceType: "collection" | "global";
	resource: string;
	resourceId: string | null;
	resourceLabel: string | null;
	titleLabel?: string | null;
	changes: Record<string, unknown> | null;
	metadata?: Record<string, unknown>;
}

export function buildAuditEvent(
	ctx: {
		session?: unknown;
		actor?: unknown;
		accessMode?: string;
		workload?: unknown;
		requestId?: string;
		traceId?: string;
		locale?: string;
	},
	input: AuditEventInput,
): Record<string, unknown> {
	const actor = resolveAuditActor(ctx);
	return {
		action: input.action,
		resourceType: input.resourceType,
		resource: input.resource,
		resourceId: input.resourceId,
		resourceLabel: input.resourceLabel,
		userId: actor.userId,
		userName: actor.userName,
		locale: ctx.locale || null,
		changes: input.changes,
		metadata: buildAuditMetadata(ctx, actor, input.metadata),
		title: generateTitle(
			input.action,
			getResourceTypeLabel(input.resourceType, input.resource),
			input.titleLabel ?? input.resourceLabel,
			actor.userName,
		),
	};
}

function firstNonEmptyString(...values: unknown[]): string | null {
	for (const value of values) {
		if (typeof value !== "string") continue;
		const trimmed = value.trim();
		if (trimmed.length > 0) return trimmed;
	}
	return null;
}

export function resolveAuditActor(ctx: {
	session?: unknown;
	accessMode?: string;
	workload?: unknown;
	actor?: unknown;
}): AuditActor {
	const session = isRecord(ctx.session) ? ctx.session : null;
	const user = isRecord(session?.user) ? session.user : null;
	const userId = user?.id != null ? String(user.id) : null;
	const userName = firstNonEmptyString(user?.name, user?.email, userId);
	if (userName) return { actorType: "user", userId, userName };

	const authorityActor = isRecord(ctx.actor) ? ctx.actor : null;
	const authoritySubjectId = firstNonEmptyString(authorityActor?.subjectId);
	if (
		authoritySubjectId &&
		(authorityActor?.kind === "human" || authorityActor?.kind === "agent")
	) {
		return {
			actorType: authorityActor.kind === "agent" ? "agent" : "user",
			userId: authoritySubjectId,
			userName: authoritySubjectId,
		};
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

export function buildAuditMetadata(
	ctx: {
		accessMode?: string;
		requestId?: string;
		traceId?: string;
		workload?: unknown;
	},
	actor: AuditActor,
	extra?: Record<string, unknown>,
): Record<string, unknown> {
	const workload = isRecord(ctx.workload) ? ctx.workload : null;
	return {
		actorType: actor.actorType,
		actorId: actor.userId,
		actorName: actor.userName,
		accessMode: ctx.accessMode ?? null,
		outcome: "succeeded",
		...(ctx.requestId ? { requestId: ctx.requestId } : {}),
		...(ctx.traceId ? { traceId: ctx.traceId } : {}),
		...(typeof workload?.type === "string"
			? { workloadType: workload.type }
			: {}),
		...(typeof workload?.id === "string" ? { workloadId: workload.id } : {}),
		...(typeof workload?.name === "string"
			? { workloadName: workload.name }
			: {}),
		...extra,
	};
}
