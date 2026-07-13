import { createHash, randomBytes } from "node:crypto";

import { service } from "questpie";

import type {
	AiWorkerStatus,
	ClaimedRun,
	ClaimRunInput,
	WorkerRuntime,
} from "../lib/execution-contract.js";

export type {
	AgentRuntimeRunRequest,
	AiRunStatus,
	AiLeaseStatus,
	AiWorkerStatus,
	ClaimedRun,
	ClaimRunInput,
	WorkerRuntime,
} from "../lib/execution-contract.js";

export function hashSecret(secret: string): string {
	return createHash("sha256").update(secret).digest("hex");
}

export function generateSecret(bytes = 32): string {
	return randomBytes(bytes).toString("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseCapabilities(value: unknown): WorkerRuntime[] {
	if (Array.isArray(value)) return value as WorkerRuntime[];
	if (typeof value !== "string") return [];
	try {
		const parsed = JSON.parse(value);
		return Array.isArray(parsed) ? (parsed as WorkerRuntime[]) : [];
	} catch {
		return [];
	}
}

function maxConcurrentForRuntime(
	capabilities: WorkerRuntime[],
	runtime: string,
): number | null {
	if (capabilities.length === 0) return 1;
	const matches = capabilities.filter(
		(capability) => capability.runtime === runtime,
	);
	if (matches.length === 0) return null;
	return Math.max(
		1,
		...matches.map((c) =>
			Number.isFinite(c.maxConcurrent) ? Number(c.maxConcurrent) : 1,
		),
	);
}

export default service()
	.lifecycle("singleton")
	.create((ctx) => {
		const collections = ctx.app.collections as any;

		async function activeRunCount(workerId: string): Promise<number> {
			// run_links is the single execution record — a worker is busy while it
			// holds rows in a non-terminal claim (same query shape as
			// activeLeaseCountForRuntime, minus the runtime filter).
			const result = await collections.run_links.find({
				where: { worker: workerId, status: { in: ["claimed", "running"] } },
				limit: 1000,
			});
			return result.docs.length;
		}

		async function activeLeaseCountForRuntime(
			workerId: string,
			runtime: string,
		): Promise<number> {
			// run_links carries worker + runtime + status directly, so the
			// per-runtime in-flight count is a plain indexed query (no lease join).
			const result = await collections.run_links.find({
				where: {
					worker: workerId,
					status: { in: ["claimed", "running"] },
					runtime,
				},
				limit: 1000,
			});
			return result.docs.length;
		}

		async function setWorkerStatus(workerId: string, status: AiWorkerStatus) {
			await collections.ai_workers.updateById({
				id: workerId,
				data: { status },
			});
		}

		const api = {
			hashSecret,
			generateSecret,

			async authenticate(secret: string | null | undefined) {
				if (!secret) return null;
				return collections.ai_workers.findOne({
					where: { secretHash: hashSecret(secret) },
				});
			},

			async registerWorker(input: {
				deviceId: string;
				name: string;
				volumeId: string;
				capabilities: unknown;
				secret: string;
			}) {
				const existing = await collections.ai_workers.findOne({
					where: { deviceId: input.deviceId },
				});
				const data = {
					name: input.name,
					volumeId: input.volumeId,
					status: "online" as AiWorkerStatus,
					capabilities: input.capabilities,
					lastHeartbeat: new Date(),
					secretHash: hashSecret(input.secret),
				};

				const worker = existing
					? await collections.ai_workers.updateById({ id: existing.id, data })
					: await collections.ai_workers.create({
							deviceId: input.deviceId,
							...data,
						});

				return { workerId: worker.id };
			},

			async deregister(workerId: string) {
				await setWorkerStatus(workerId, "offline");
			},

			async heartbeat(workerId: string) {
				// Busy-count comes from run_links; per-run liveness is the row's
				// producerLease (heartbeated by the executing worker), so there is
				// no ai_worker_leases extension loop here anymore.
				const active = await activeRunCount(workerId);
				const status: AiWorkerStatus = active > 0 ? "busy" : "online";
				await collections.ai_workers.updateById({
					id: workerId,
					data: { status, lastHeartbeat: new Date() },
				});

				return { activeLeases: active, status };
			},

			async claimRun(input: ClaimRunInput): Promise<ClaimedRun | null> {
				const worker = await collections.ai_workers.findOne({
					where: { id: input.workerId },
				});
				if (!worker) return null;
				if (worker.status === "draining" || worker.status === "offline")
					return null;

				const capabilities = parseCapabilities(worker.capabilities);
				const activeByRuntime = new Map<string, number>();
				const activeForRuntime = async (runtime: string) => {
					const cached = activeByRuntime.get(runtime);
					if (cached !== undefined) return cached;
					const active = await activeLeaseCountForRuntime(
						input.workerId,
						runtime,
					);
					activeByRuntime.set(runtime, active);
					return active;
				};

				// Candidate-fanout id-scoped CAS over run_links (the single
				// execution record). The collection update fires afterChange +
				// realtime (the chip + chat-status mirror depend on it). Each claim
				// bumps producerLease.epoch — the writer token runHarnessRun /
				// finalizeRun fence on. The lease lives on the row (producerLease),
				// not ai_worker_leases.
				const pending = await collections.run_links.find({
					where: { status: "pending" },
					limit: 50,
					orderBy: { createdAt: "asc" },
				});

				const runtimeSet = new Set(input.runtimes);
				for (const candidate of pending.docs as Array<
					Record<string, unknown>
				>) {
					const runRuntime = candidate.runtime as string | undefined;
					if (!runRuntime || !runtimeSet.has(runRuntime)) continue;
					const maxConcurrent = maxConcurrentForRuntime(
						capabilities,
						runRuntime,
					);
					if (!maxConcurrent) continue;
					const active = await activeForRuntime(runRuntime);
					if (active >= maxConcurrent) continue;

					const prevLease = isRecord(candidate.producerLease)
						? candidate.producerLease
						: null;
					const epoch =
						(typeof prevLease?.epoch === "number" ? prevLease.epoch : 0) + 1;
					const now = new Date();
					const leaseId = randomBytes(12).toString("hex");
					const expiresAt = new Date(now.getTime() + 90 * 1000);
					const producerLease = {
						epoch,
						workerId: input.workerId,
						leaseId,
						expiresAt: expiresAt.toISOString(),
						heartbeatAt: now.toISOString(),
					};

					const updated = await collections.run_links.update({
						where: { id: candidate.id, status: "pending" },
						data: {
							status: "claimed",
							worker: input.workerId,
							startedAt: now,
							producerLease,
						},
					});
					const run = (updated as any)[0] as
						| Record<string, unknown>
						| undefined;
					if (!run) continue; // lost the CAS race → next candidate

					await setWorkerStatus(input.workerId, "busy");

					const metadata = isRecord(run.metadata) ? run.metadata : undefined;
					const cwd =
						typeof metadata?.cwd === "string"
							? metadata.cwd.trim() || undefined
							: undefined;

					return {
						lease: {
							id: leaseId,
							runId: String(run.id),
							expiresAt,
						},
						spawn: {
							prompt: (run.instructions as string) ?? "",
							runtime: runRuntime,
							runtimeSessionRef: run.runtimeSessionRef as string | undefined,
							cwd,
							metadata,
						},
						run,
						epoch,
					};
				}

				return null;
			},
		};

		return api;
	});
