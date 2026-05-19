import { ApiError } from "questpie/errors";

import { asRecord, relationId } from "./records";
import {
	asWorkerRecord,
	isLocalDevWorkerRequest,
	workerSecretFromRequest,
} from "./worker-auth";

type WorkerAuthContext = Questpie.AppContext & { request: Request };

export type LegacyWorkerCapability = {
	runtime?: string;
	models?: string[];
	tags?: string[];
	maxConcurrent?: number;
};

export function snakeWorkerId(input: {
	workerId?: string | null;
	worker_id?: string | null;
}) {
	return input.workerId ?? input.worker_id ?? null;
}

export function snakeDeviceId(input: {
	deviceId?: string | null;
	device_id?: string | null;
}) {
	return input.deviceId ?? input.device_id ?? null;
}

export function ttlSeconds(input: {
	ttlSeconds?: number | null;
	ttl_seconds?: number | null;
}) {
	return input.ttlSeconds ?? input.ttl_seconds ?? null;
}

export function toLegacyEnrollmentResponse(input: {
	workerId: string;
	machineSecret: string;
}) {
	return {
		worker_id: input.workerId,
		machine_secret: input.machineSecret,
	};
}

export function toLegacyJoinTokenResponse(input: {
	tokenId: string;
	secret: string;
	expiresAt: Date | string;
}) {
	return {
		token_id: input.tokenId,
		secret: input.secret,
		expires_at:
			input.expiresAt instanceof Date
				? input.expiresAt.toISOString()
				: new Date(input.expiresAt).toISOString(),
	};
}

export async function authenticateLegacyWorker(
	ctx: WorkerAuthContext,
	bodyWorkerId?: string | null,
) {
	const secret = workerSecretFromRequest(ctx.request);
	if (secret) {
		const worker = asWorkerRecord(
			await ctx.services.workerManager.requireWorker(secret),
		);
		if (bodyWorkerId && bodyWorkerId !== worker.id) {
			throw ApiError.forbidden({
				operation: "update",
				resource: "workers",
				reason: `Authenticated as ${worker.id} but body worker id is ${bodyWorkerId}`,
			});
		}
		return { worker, localDev: false };
	}

	if (isLocalDevWorkerRequest(ctx.request)) {
		if (!bodyWorkerId) {
			throw ApiError.badRequest(
				"worker_id is required for local dev worker calls",
			);
		}
		const worker = await ctx.collections.workers.findOne({
			where: { id: bodyWorkerId },
		});
		return { worker: worker ?? { id: bodyWorkerId }, localDev: true };
	}

	throw ApiError.unauthorized(
		"Worker authentication required (X-Worker-Secret or Authorization: Bearer)",
	);
}

export function toLegacyClaimRun(input: Record<string, unknown>) {
	const targeting = asRecord(input.targeting);
	const runtimeHints = asRecord(targeting.runtimeHints);
	const workspaceMode =
		typeof runtimeHints.workspaceMode === "string"
			? runtimeHints.workspaceMode
			: typeof runtimeHints.workspace_mode === "string"
				? runtimeHints.workspace_mode
				: relationId(input.task)
					? "isolated_worktree"
					: "none";

	return {
		id: String(input.id),
		agent_id:
			String(input.capabilityId ?? input.capability_id ?? "") ||
			String(input.capability ?? "default"),
		task_id: input.taskId ?? input.task_id ?? null,
		project_id: input.projectId ?? input.project_id ?? null,
		runtime: input.runtime,
		status: input.status,
		model: input.modelId ?? input.model_id ?? null,
		provider: input.providerId ?? input.provider_id ?? null,
		variant: runtimeHints.variant ?? null,
		task_title: input.taskTitle ?? input.task_title ?? null,
		task_description: input.taskDescription ?? input.task_description ?? null,
		agent_name: runtimeHints.agentName ?? runtimeHints.agent_name ?? null,
		agent_role: runtimeHints.agentRole ?? runtimeHints.agent_role ?? null,
		instructions: input.instructions ?? null,
		runtime_session_ref:
			input.runtimeSessionRef ?? input.runtime_session_ref ?? null,
		resumed_from_run_id:
			input.resumedFromRunId ?? input.resumed_from_run_id ?? null,
		targeting,
		actions: Array.isArray(targeting.actions) ? targeting.actions : [],
		secret_refs: Array.isArray(targeting.secretRefs)
			? targeting.secretRefs
			: Array.isArray(targeting.secret_refs)
				? targeting.secret_refs
				: [],
		resolved_scripts: Array.isArray(targeting.resolvedScripts)
			? targeting.resolvedScripts
			: Array.isArray(targeting.resolved_scripts)
				? targeting.resolved_scripts
				: [],
		resolved_shared_secrets: asRecord(
			targeting.resolvedSharedSecrets ?? targeting.resolved_shared_secrets,
		),
		resolved_capabilities:
			targeting.resolvedCapabilities ?? targeting.resolved_capabilities,
		workspace_mode:
			workspaceMode === "none" || workspaceMode === "isolated_worktree"
				? workspaceMode
				: "isolated_worktree",
		parent_branch:
			runtimeHints.parentBranch ?? runtimeHints.parent_branch ?? null,
		injected_context: asRecord(
			targeting.injectedContext ?? targeting.injected_context,
		),
		context_hints: Array.isArray(targeting.contextHints)
			? targeting.contextHints
			: Array.isArray(targeting.context_hints)
				? targeting.context_hints
				: [],
	};
}

export function toLegacyClaimResponse(input: {
	leaseId?: string | null;
	payload?: Record<string, unknown> | null;
}) {
	return {
		run: input.payload ? toLegacyClaimRun(input.payload) : null,
		lease_id: input.leaseId ?? null,
	};
}

export function toLegacyRunStatus(input: Record<string, unknown>) {
	const metadata = asRecord(input.metadata);
	return {
		...input,
		task_id: input.taskId ?? input.task_id ?? relationId(input.task),
		project_id:
			input.projectId ?? input.project_id ?? relationId(input.project),
		worker_id:
			input.workerId ??
			input.worker_id ??
			relationId(input.worker) ??
			metadata.workerId,
	};
}
