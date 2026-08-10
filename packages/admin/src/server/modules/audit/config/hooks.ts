import type {
	GlobalCollectionHookContext,
	GlobalCollectionTransitionHookContext,
	GlobalGlobalHookContext,
	GlobalGlobalTransitionHookContext,
} from "questpie";
import type { RequestContextLogger } from "questpie/types";

import {
	buildAuditEvent,
	computeChanges,
	extractLabel,
	makeFieldChangeMap,
	type AuditEventInput,
} from "./event.js";
import {
	handleAuditFailure,
	persistAuditEvent,
	type AuditOperationDetails,
} from "./persistence.js";
import { getAuditCollection, isAuditDisabled, isRecord } from "./runtime.js";

type AuditHookContext = {
	app?: unknown;
	db?: unknown;
	collections?: unknown;
	logger?: RequestContextLogger;
	session?: unknown;
	actor?: unknown;
	accessMode?: string;
	workload?: unknown;
	requestId?: string;
	traceId?: string;
	locale?: string;
};

async function recordAuditEvent(
	ctx: AuditHookContext,
	input: AuditEventInput,
	options?: { fatalTransition?: boolean },
): Promise<void> {
	const details: AuditOperationDetails = {
		operation: input.action,
		resource: input.resource,
	};
	try {
		if (isAuditDisabled(input.resourceType, input.resource)) return;
		await persistAuditEvent(
			ctx,
			getAuditCollection(ctx),
			buildAuditEvent(ctx, input),
			details,
		);
	} catch (error) {
		handleAuditFailure(
			ctx,
			`[Audit] Failed to log ${input.action} for ${input.resourceType} "${input.resource}":`,
			error,
			details,
			options?.fatalTransition,
		);
	}
}

export async function collectionAfterChange(
	ctx: GlobalCollectionHookContext,
): Promise<void> {
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

	await recordAuditEvent(ctx, {
		action,
		resourceType: "collection",
		resource: ctx.collection,
		resourceId: ctx.data?.id ? String(ctx.data.id) : null,
		resourceLabel: extractLabel(ctx.data),
		changes,
		metadata: { operation: ctx.operation },
	});
}

export async function collectionAfterDelete(
	ctx: GlobalCollectionHookContext,
): Promise<void> {
	await recordAuditEvent(ctx, {
		action: "delete",
		resourceType: "collection",
		resource: ctx.collection,
		resourceId: ctx.data?.id ? String(ctx.data.id) : null,
		resourceLabel: extractLabel(ctx.data),
		changes: makeFieldChangeMap(
			ctx.data,
			"delete",
			"collection",
			ctx.collection,
			ctx.app,
		),
		metadata: { operation: "delete" },
	});
}

export async function collectionAfterPurge(
	ctx: GlobalCollectionHookContext,
): Promise<void> {
	const resourceId = ctx.data?.id ? String(ctx.data.id) : null;
	await recordAuditEvent(ctx, {
		action: "purge",
		resourceType: "collection",
		resource: ctx.collection,
		resourceId,
		// A purge audit fact must not retain the purged row's preimage.
		resourceLabel: null,
		titleLabel: resourceId,
		changes: null,
		metadata: { operation: "purge" },
	});
}

export async function collectionAfterTransition(
	ctx: GlobalCollectionTransitionHookContext,
): Promise<void> {
	await recordAuditEvent(
		ctx,
		{
			action: "transition",
			resourceType: "collection",
			resource: ctx.collection,
			resourceId: ctx.data?.id ? String(ctx.data.id) : null,
			resourceLabel: extractLabel(ctx.data),
			changes: { stage: { from: ctx.fromStage, to: ctx.toStage } },
			metadata: { fromStage: ctx.fromStage, toStage: ctx.toStage },
		},
		{ fatalTransition: true },
	);
}

export async function globalAfterChange(
	ctx: GlobalGlobalHookContext,
): Promise<void> {
	const current = isRecord(ctx.input)
		? { ...ctx.original, ...ctx.input }
		: ctx.data;
	await recordAuditEvent(ctx, {
		action: "update",
		resourceType: "global",
		resource: ctx.global,
		resourceId: null,
		resourceLabel: ctx.global,
		changes: computeChanges(
			ctx.original,
			current,
			"global",
			ctx.global,
			ctx.app,
		),
		metadata: { operation: "update" },
	});
}

export async function globalAfterTransition(
	ctx: GlobalGlobalTransitionHookContext,
): Promise<void> {
	await recordAuditEvent(
		ctx,
		{
			action: "transition",
			resourceType: "global",
			resource: ctx.global,
			resourceId: null,
			resourceLabel: ctx.global,
			changes: { stage: { from: ctx.fromStage, to: ctx.toStage } },
			metadata: { fromStage: ctx.fromStage, toStage: ctx.toStage },
		},
		{ fatalTransition: true },
	);
}
