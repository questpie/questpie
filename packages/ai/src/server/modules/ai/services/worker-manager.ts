import { createHash, randomBytes } from "node:crypto";

import { service } from "questpie";

type WorkerStatus = "online" | "offline" | "busy" | "draining";

export interface WorkerCapability {
  runtime?: string;
  models?: string[];
  tags?: string[];
  maxConcurrent?: number;
}

export interface ClaimRunInput {
  workerId: string;
  runtimes: string[];
  models?: string[];
  limit?: number;
}

export interface ClaimedRun {
  runId: string;
  leaseId: string;
  expiresAt: Date;
  prompt: string;
  runtime: string;
  modelId: string | null;
  cwd?: string;
  sessionRef?: string;
  mcpServers?: unknown[];
  systemPrompt?: string;
  context?: string;
  meta?: Record<string, unknown>;
}

export function hashSecret(secret: string): string {
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

function maxConcurrentFromCapabilities(capabilities: WorkerCapability[]): number {
  if (capabilities.length === 0) return 1;
  return Math.max(
    1,
    ...capabilities.map((c) =>
      Number.isFinite(c.maxConcurrent) ? Number(c.maxConcurrent) : 1,
    ),
  );
}

export default service()
  .lifecycle("singleton")
  .create((ctx) => {
    const collections = ctx.collections as any;

    async function activeLeaseCount(workerId: string): Promise<number> {
      const result = await collections.ai_worker_leases.find({
        where: { worker: workerId, status: "active" },
        limit: 1000,
      });
      return result.docs.length;
    }

    async function setWorkerStatus(workerId: string, status: WorkerStatus) {
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
          status: "online" as const,
          capabilities: input.capabilities,
          lastHeartbeat: new Date(),
          secretHash: hashSecret(input.secret),
        };

        const worker = existing
          ? await collections.ai_workers.updateById({ id: existing.id, data })
          : await collections.ai_workers.create({ deviceId: input.deviceId, ...data });

        return { workerId: worker.id };
      },

      async deregister(workerId: string) {
        await setWorkerStatus(workerId, "offline");
      },

      async heartbeat(workerId: string) {
        const active = await activeLeaseCount(workerId);
        const status: WorkerStatus = active > 0 ? "busy" : "online";
        await collections.ai_workers.updateById({
          id: workerId,
          data: { status, lastHeartbeat: new Date() },
        });

        const leases = await collections.ai_worker_leases.find({
          where: { worker: workerId, status: "active" },
          limit: 1000,
        });
        const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
        await Promise.all(
          leases.docs.map((lease: { id: string }) =>
            collections.ai_worker_leases.updateById({
              id: lease.id,
              data: { expiresAt },
            }),
          ),
        );

        return { activeLeases: leases.docs.length, status };
      },

      async claimRun(input: ClaimRunInput): Promise<ClaimedRun | null> {
        const worker = await collections.ai_workers.findOne({
          where: { id: input.workerId },
        });
        if (!worker) return null;
        if (worker.status === "draining" || worker.status === "offline") return null;

        const capabilities = parseCapabilities(worker.capabilities);
        const maxConcurrent = maxConcurrentFromCapabilities(capabilities);
        const active = await activeLeaseCount(input.workerId);
        if (active >= maxConcurrent) return null;

        const pending = await collections.ai_runs.find({
          where: { status: "pending" },
          limit: 50,
          orderBy: { createdAt: "asc" },
        });

        const runtimeSet = new Set(input.runtimes);
        for (const candidate of pending.docs as Array<Record<string, unknown>>) {
          const runRuntime = candidate.runtime as string | undefined;
          if (runRuntime && !runtimeSet.has(runRuntime)) continue;

          const updated = await collections.ai_runs.update({
            where: { id: candidate.id, status: "pending" },
            data: {
              status: "claimed",
              worker: input.workerId,
              startedAt: new Date(),
            },
          });
          const run = (updated as any)[0] as Record<string, unknown> | undefined;
          if (!run) continue;

          const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
          const lease = await collections.ai_worker_leases.create({
            worker: input.workerId,
            run: String(run.id),
            claimedAt: new Date(),
            expiresAt,
            status: "active",
          });

          await setWorkerStatus(input.workerId, "busy");

          return {
            runId: String(run.id),
            leaseId: lease.id,
            expiresAt,
            prompt: (run.prompt as string) ?? "",
            runtime: (run.runtime as string) ?? "claude-code",
            modelId: run.model as string | null,
            sessionRef: run.runtimeSessionRef as string | undefined,
            meta: isRecord(run.meta) ? run.meta : undefined,
          };
        }

        return null;
      },

      async completeRun(input: { runId: string; workerId: string; result: Record<string, unknown> }) {
        await collections.ai_runs.updateById({
          id: input.runId,
          data: {
            status: "completed",
            summary: input.result.text ?? undefined,
            runtimeSessionRef: input.result.sessionRef ?? undefined,
            tokensInput: input.result.inputTokens ?? undefined,
            tokensOutput: input.result.outputTokens ?? undefined,
            cost: input.result.cost ?? undefined,
            endedAt: new Date(),
          },
        });

        const lease = await collections.ai_worker_leases.findOne({
          where: { worker: input.workerId, run: input.runId, status: "active" },
        });
        if (lease) {
          await collections.ai_worker_leases.updateById({
            id: lease.id,
            data: { status: "completed" },
          });
        }

        const remaining = await activeLeaseCount(input.workerId);
        await setWorkerStatus(input.workerId, remaining > 0 ? "busy" : "online");
      },

      async reportEvent(input: { runId: string; event: Record<string, unknown> }) {
        await collections.ai_run_events.create({
          run: input.runId,
          type: (input.event.type as string) ?? "unknown",
          level: "info",
          summary: input.event.text ?? input.event.tool ?? undefined,
          meta: input.event,
        });
      },

      async expireStaleLeases(now = new Date()) {
        const result = await collections.ai_worker_leases.find({
          where: { status: "active" },
          limit: 1000,
        });
        const expired = (result.docs as Array<Record<string, unknown>>).filter(
          (lease) => lease.expiresAt && new Date(lease.expiresAt as string) < now,
        );

        for (const lease of expired) {
          const runId = relationId(lease.run);
          await collections.ai_worker_leases.updateById({
            id: lease.id as string,
            data: { status: "expired" },
          });
          if (runId) {
            await collections.ai_runs.update({
              where: { id: runId, status: { in: ["claimed", "running"] } },
              data: { status: "pending", worker: null as any },
            });
          }
        }

        return { expiredCount: expired.length };
      },
    };

    return api;
  });
