import { createHash, randomBytes } from "node:crypto";

import { ApiError } from "questpie/errors";
import { service } from "questpie/services";

type Collections = Questpie.AppContext["collections"];

type WorkerStatus = "online" | "offline" | "busy" | "draining";
type LeaseStatus = "active" | "completed" | "expired" | "released";

export interface WorkerCapability {
	runtime?: string;
	models?: string[];
	tags?: string[];
	maxConcurrent?: number;
}

export interface ClaimRunsInput {
	workerId: string;
	runtime?: string | null;
	capabilities?: WorkerCapability[] | null;
	limit?: number | null;
}

export interface WorkerClaim {
	leaseId: string;
	expiresAt: Date;
	run: Record<string, unknown>;
	task: Record<string, unknown> | null;
	project: Record<string, unknown> | null;
	payload: Record<string, unknown>;
}

export function hashWorkerSecret(secret: string): string {
	return createHash("sha256").update(secret).digest("hex");
}

export function generateSecret(bytes = 32): string {
	return randomBytes(bytes).toString("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function relationId(value: unknown): string | null {
	if (typeof value === "string") return value;
	if (isRecord(value) && typeof value.id === "string") return value.id;
	return null;
}

function parseCapabilities(value: unknown): WorkerCapability[] {
	if (Array.isArray(value)) return value as WorkerCapability[];
	if (typeof value !== "string") return [];
	try {
		const parsed = JSON.parse(value);
		return Array.isArray(parsed) ? (parsed as WorkerCapability[]) : [];
	} catch {
		return [];
	}
}

function maxConcurrentFromCapabilities(
	capabilities: WorkerCapability[],
): number {
	if (capabilities.length === 0) return 1;
	return Math.max(
		1,
		...capabilities.map((capability) =>
			Number.isFinite(capability.maxConcurrent)
				? Number(capability.maxConcurrent)
				: 1,
		),
	);
}

function workerTags(capabilities: WorkerCapability[]) {
	const tags = new Set<string>();
	for (const capability of capabilities) {
		if (capability.runtime) tags.add(capability.runtime);
		for (const model of capability.models ?? []) tags.add(model);
		for (const tag of capability.tags ?? []) tags.add(tag);
	}
	return tags;
}

function parseTargeting(value: unknown): Record<string, unknown> {
	if (isRecord(value)) return value;
	if (typeof value !== "string" || !value.trim()) return {};
	try {
		const parsed = JSON.parse(value);
		return isRecord(parsed) ? parsed : {};
	} catch {
		return {};
	}
}

function arrayValue(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function runIsEligible(
	run: Record<string, unknown>,
	workerId: string,
	tags: Set<string>,
) {
	const preferredWorker = relationId(run.preferredWorker);
	if (preferredWorker && preferredWorker !== workerId) return false;

	const targeting = parseTargeting(run.targeting);
	const avoidWorkers = [
		...arrayValue(targeting.avoidWorkerIds),
		...arrayValue(targeting.avoid_worker_ids),
	];
	if (avoidWorkers.includes(workerId)) return false;

	const requiredWorker =
		typeof targeting.requiredWorkerId === "string"
			? targeting.requiredWorkerId
			: typeof targeting.required_worker_id === "string"
				? targeting.required_worker_id
				: null;
	if (requiredWorker && requiredWorker !== workerId) return false;

	const allowFallback =
		targeting.allowFallback !== false && targeting.allow_fallback !== false;
	const requiredRuntime =
		typeof targeting.requiredRuntime === "string"
			? targeting.requiredRuntime
			: typeof targeting.required_runtime === "string"
				? targeting.required_runtime
				: null;
	if (requiredRuntime && !tags.has(requiredRuntime) && !allowFallback) {
		return false;
	}

	const requiredTags = [
		...arrayValue(targeting.requiredWorkerTags),
		...arrayValue(targeting.required_worker_tags),
	];
	return !(
		requiredTags.length > 0 &&
		!allowFallback &&
		requiredTags.some((tag) => typeof tag === "string" && !tags.has(tag))
	);
}

async function activeLeaseCount(collections: Collections, workerId: string) {
	const result = await collections.worker_leases.find({
		where: { worker: workerId, status: "active" },
		limit: 1000,
	});
	return result.docs.length;
}

async function setWorkerStatus(
	collections: Collections,
	workerId: string,
	status: WorkerStatus,
) {
	await collections.workers.updateById({
		id: workerId,
		data: { status },
	});
}

async function buildClaimPayload(
	collections: Collections,
	claim: {
		run: Record<string, unknown>;
		leaseId: string;
		expiresAt: Date;
	},
): Promise<WorkerClaim> {
	const taskId = relationId(claim.run.task);
	const projectId = relationId(claim.run.project);
	const task = taskId
		? ((await collections.tasks.findOne({ where: { id: taskId } })) as Record<
				string,
				unknown
			> | null)
		: null;
	const project = projectId
		? ((await collections.projects.findOne({
				where: { id: projectId },
			})) as Record<string, unknown> | null)
		: null;
	const payload = {
		id: claim.run.id,
		taskId,
		projectId,
		status: claim.run.status,
		runtime: claim.run.runtime,
		modelId: relationId(claim.run.model),
		providerId: relationId(claim.run.provider),
		capabilityId: relationId(claim.run.capability),
		instructions: claim.run.instructions ?? null,
		runtimeSessionRef: claim.run.runtimeSessionRef ?? null,
		resumedFromRunId: relationId(claim.run.resumedFromRun),
		targeting: parseTargeting(claim.run.targeting),
		taskTitle: task?.title ?? null,
		taskDescription: task?.description ?? null,
		projectPath: project?.path ?? null,
		gitRemote: project?.gitRemote ?? null,
		defaultBranch: project?.defaultBranch ?? null,
	};

	return {
		leaseId: claim.leaseId,
		expiresAt: claim.expiresAt,
		run: claim.run,
		task,
		project,
		payload,
	};
}

export default service({
	lifecycle: "singleton",
	create: ({ collections }) => {
		const api = {
			hashSecret: hashWorkerSecret,
			generateSecret,

			async authenticate(secret: string | null | undefined) {
				if (!secret) return null;
				return collections.workers.findOne({
					where: { machineSecretHash: hashWorkerSecret(secret) },
				});
			},

			async requireWorker(secret: string | null | undefined) {
				const worker = await api.authenticate(secret);
				if (!worker) {
					throw ApiError.unauthorized(
						"Worker authentication required (X-Worker-Secret header)",
					);
				}
				return worker;
			},

			async createJoinToken(input: {
				description?: string | null;
				ttlSeconds?: number | null;
				createdBy?: string | null;
			}) {
				const secret = generateSecret();
				const expiresAt = new Date(
					Date.now() + (input.ttlSeconds ?? 3600) * 1000,
				);
				const token = await collections.join_tokens.create({
					secretHash: hashWorkerSecret(secret),
					description: input.description ?? undefined,
					createdBy: input.createdBy ?? undefined,
					expiresAt,
				});

				return { tokenId: token.id, secret, expiresAt };
			},

			async enroll(input: {
				token: string;
				name: string;
				deviceId: string;
				capabilities?: unknown;
			}) {
				const token = await collections.join_tokens.findOne({
					where: { secretHash: hashWorkerSecret(input.token) },
				});
				if (!token) throw ApiError.unauthorized("Invalid join token");
				if (token.usedAt) throw ApiError.badRequest("Join token already used");
				if (token.expiresAt && new Date(token.expiresAt) < new Date()) {
					throw ApiError.unauthorized("Join token expired");
				}

				const machineSecret = generateSecret();
				const existing = await collections.workers.findOne({
					where: { deviceId: input.deviceId },
				});
				const worker = existing
					? await collections.workers.updateById({
							id: existing.id,
							data: {
								name: input.name,
								status: "online",
								capabilities: input.capabilities ?? undefined,
								lastHeartbeat: new Date(),
								machineSecretHash: hashWorkerSecret(machineSecret),
							},
						})
					: await collections.workers.create({
							deviceId: input.deviceId,
							name: input.name,
							status: "online",
							capabilities: input.capabilities ?? undefined,
							lastHeartbeat: new Date(),
							machineSecretHash: hashWorkerSecret(machineSecret),
						});

				await collections.join_tokens.updateById({
					id: token.id,
					data: {
						usedAt: new Date(),
						usedByWorker: worker.id,
					},
				});

				return { workerId: worker.id, machineSecret };
			},

			async heartbeat(input: {
				workerId: string;
				status?: WorkerStatus | null;
				capabilities?: unknown;
			}) {
				const active = await activeLeaseCount(collections, input.workerId);
				const status = input.status ?? (active > 0 ? "busy" : "online");
				await collections.workers.updateById({
					id: input.workerId,
					data: {
						status,
						lastHeartbeat: new Date(),
						capabilities: input.capabilities ?? undefined,
					},
				});

				const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
				const leases = await collections.worker_leases.find({
					where: { worker: input.workerId, status: "active" },
					limit: 1000,
				});
				await Promise.all(
					leases.docs.map((lease: { id: string }) =>
						collections.worker_leases.updateById({
							id: lease.id,
							data: { expiresAt },
						}),
					),
				);

				return { activeLeases: leases.docs.length, status };
			},

			async findActiveLeaseForRun(workerId: string, runId: string) {
				return collections.worker_leases.findOne({
					where: { worker: workerId, run: runId, status: "active" },
				});
			},

			async requireActiveLease(workerId: string, runId: string) {
				const run = await collections.runs.findOne({ where: { id: runId } });
				if (!run) throw ApiError.notFound("Run", runId);
				if (relationId(run.worker) && relationId(run.worker) !== workerId) {
					throw ApiError.forbidden({
						operation: "update",
						resource: "runs",
						reason: `Run ${runId} belongs to another worker`,
					});
				}
				const lease = await api.findActiveLeaseForRun(workerId, runId);
				if (!lease) {
					throw ApiError.forbidden({
						operation: "update",
						resource: "worker_leases",
						reason: `Worker does not hold an active lease for run ${runId}`,
					});
				}
				return { run, lease };
			},

			async releaseLease(input: {
				workerId: string;
				runId: string;
				status?: LeaseStatus;
			}) {
				const lease = await api.findActiveLeaseForRun(
					input.workerId,
					input.runId,
				);
				if (lease) {
					await collections.worker_leases.updateById({
						id: lease.id,
						data: { status: input.status ?? "released" },
					});
				}
				const remaining = await activeLeaseCount(collections, input.workerId);
				await setWorkerStatus(
					collections,
					input.workerId,
					remaining > 0 ? "busy" : "online",
				);
				return { released: !!lease, remainingActiveLeases: remaining };
			},

			async expireStaleLeases(now = new Date()) {
				const result = await collections.worker_leases.find({
					where: { status: "active" },
					limit: 1000,
				});
				const expired = result.docs.filter(
					(lease: { expiresAt?: Date | string | null }) =>
						lease.expiresAt && new Date(lease.expiresAt) < now,
				);

				for (const lease of expired) {
					const runId = relationId((lease as { run?: unknown }).run);
					await collections.worker_leases.updateById({
						id: (lease as { id: string }).id,
						data: { status: "expired" },
					});
					if (runId) {
						await collections.runs.update({
							where: { id: runId, status: { in: ["claimed", "running"] } },
							data: {
								status: "pending",
								worker: null as any,
								error: "lease expired",
							},
						});
					}
				}

				const affectedWorkerIds = [
					...new Set(
						expired
							.map((lease: { worker?: unknown }) => relationId(lease.worker))
							.filter(Boolean),
					),
				] as string[];
				for (const workerId of affectedWorkerIds) {
					const remaining = await activeLeaseCount(collections, workerId);
					if (remaining === 0)
						await setWorkerStatus(collections, workerId, "online");
				}

				return {
					expiredLeaseIds: expired.map((lease: { id: string }) => lease.id),
					requeuedRunIds: expired
						.map((lease: { run?: unknown }) => relationId(lease.run))
						.filter(Boolean),
				};
			},

			async claimRuns(input: ClaimRunsInput): Promise<WorkerClaim[]> {
				const worker = await collections.workers.findOne({
					where: { id: input.workerId },
				});
				if (!worker) throw ApiError.notFound("Worker", input.workerId);
				if (worker.status === "draining" || worker.status === "offline")
					return [];

				const capabilities =
					input.capabilities ?? parseCapabilities(worker.capabilities);
				const maxConcurrent = maxConcurrentFromCapabilities(capabilities);
				const active = await activeLeaseCount(collections, input.workerId);
				const available = Math.max(
					0,
					Math.min(input.limit ?? 1, maxConcurrent - active),
				);
				if (available === 0) return [];

				const pending = await collections.runs.find({
					where: input.runtime
						? { status: "pending", runtime: input.runtime }
						: { status: "pending" },
					limit: 100,
					orderBy: { createdAt: "asc" },
				});
				const tags = workerTags(capabilities);
				const claims: WorkerClaim[] = [];

				for (const candidate of pending.docs as Array<
					Record<string, unknown>
				>) {
					if (claims.length >= available) break;
					if (!runIsEligible(candidate, input.workerId, tags)) continue;

					const updated = await collections.runs.update({
						where: { id: candidate.id, status: "pending" },
						data: {
							status: "claimed",
							worker: input.workerId,
							startedAt: new Date(),
						},
					});
					const run = updated[0] as Record<string, unknown> | undefined;
					if (!run) continue;

					const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
					const lease = await collections.worker_leases.create({
						worker: input.workerId,
						run: String(run.id),
						claimedAt: new Date(),
						expiresAt,
						status: "active",
					});
					claims.push(
						await buildClaimPayload(collections, {
							run,
							leaseId: lease.id,
							expiresAt,
						}),
					);
				}

				if (claims.length > 0) {
					await setWorkerStatus(collections, input.workerId, "busy");
				}
				return claims;
			},
		};
		return api;
	},
});
