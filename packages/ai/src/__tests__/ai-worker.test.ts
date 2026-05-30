import { describe, expect, it, beforeEach } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	hashSecret,
	generateSecret,
} from "../server/modules/ai/services/worker-manager.js";
import { executeRun } from "../server/worker/execute-run.js";
import { prepareWorkerVolume } from "../server/worker/spawn-agent-runner.js";
import { createFakeSpawnAgentRunner } from "../server/worker/testing.js";

// ---------------------------------------------------------------------------
// In-memory mock collection store
// ---------------------------------------------------------------------------

interface MockDoc {
	id: string;
	[key: string]: unknown;
}

function createMockCollection() {
	let docs: MockDoc[] = [];

	function matchesWhere(doc: MockDoc, where: Record<string, unknown>): boolean {
		for (const [key, val] of Object.entries(where)) {
			if (val && typeof val === "object" && "in" in (val as any)) {
				if (!(val as any).in.includes(doc[key])) return false;
			} else if (doc[key] !== val) {
				return false;
			}
		}
		return true;
	}

	return {
		_docs: docs,

		async create(data: Record<string, unknown>): Promise<MockDoc> {
			const doc = { id: randomUUID(), ...data } as MockDoc;
			docs.push(doc);
			return doc;
		},

		async find(opts: {
			where?: Record<string, unknown>;
			limit?: number;
			orderBy?: Record<string, "asc" | "desc">;
		}): Promise<{ docs: MockDoc[] }> {
			let result = opts.where
				? docs.filter((d) => matchesWhere(d, opts.where!))
				: [...docs];

			if (opts.orderBy) {
				const [[key, dir]] = Object.entries(opts.orderBy);
				result.sort((a, b) => {
					const aVal = a[key!] as any;
					const bVal = b[key!] as any;
					if (aVal < bVal) return dir === "asc" ? -1 : 1;
					if (aVal > bVal) return dir === "asc" ? 1 : -1;
					return 0;
				});
			}
			if (opts.limit) result = result.slice(0, opts.limit);
			return { docs: result };
		},

		async findOne(opts: {
			where: Record<string, unknown>;
		}): Promise<MockDoc | null> {
			return docs.find((d) => matchesWhere(d, opts.where)) ?? null;
		},

		async updateById(opts: {
			id: string;
			data: Record<string, unknown>;
		}): Promise<MockDoc> {
			const doc = docs.find((d) => d.id === opts.id);
			if (!doc) throw new Error(`Doc ${opts.id} not found`);
			Object.assign(doc, opts.data);
			return doc;
		},

		async update(opts: {
			where: Record<string, unknown>;
			data: Record<string, unknown>;
		}): Promise<MockDoc[]> {
			const matched = docs.filter((d) => matchesWhere(d, opts.where));
			for (const doc of matched) {
				Object.assign(doc, opts.data);
			}
			return matched;
		},

		reset() {
			docs.length = 0;
		},
	};
}

function createMockCollections() {
	return {
		ai_runs: createMockCollection(),
		ai_workers: createMockCollection(),
		ai_worker_leases: createMockCollection(),
		ai_run_events: createMockCollection(),
	};
}

// ---------------------------------------------------------------------------
// Build services with mock collections (mirrors service().create(ctx) shape)
// ---------------------------------------------------------------------------

function buildWorkerManager(
	collections: ReturnType<typeof createMockCollections>,
) {
	async function activeLeaseCount(workerId: string): Promise<number> {
		const result = await collections.ai_worker_leases.find({
			where: { worker: workerId, status: "active" },
			limit: 1000,
		});
		return result.docs.length;
	}

	async function setWorkerStatus(workerId: string, status: string) {
		await collections.ai_workers.updateById({ id: workerId, data: { status } });
	}

	function isRecord(value: unknown): value is Record<string, unknown> {
		return typeof value === "object" && value !== null && !Array.isArray(value);
	}

	function relationId(value: unknown): string | null {
		if (typeof value === "string") return value;
		if (isRecord(value) && typeof value.id === "string") return value.id;
		return null;
	}

	function parseCapabilities(
		value: unknown,
	): Array<{ runtime?: string; maxConcurrent?: number }> {
		if (Array.isArray(value)) return value;
		if (typeof value !== "string") return [];
		try {
			const parsed = JSON.parse(value);
			return Array.isArray(parsed) ? parsed : [];
		} catch {
			return [];
		}
	}

	function maxConcurrentFromCapabilities(
		caps: Array<{ maxConcurrent?: number }>,
	): number {
		if (caps.length === 0) return 1;
		return Math.max(
			1,
			...caps.map((c) =>
				Number.isFinite(c.maxConcurrent) ? Number(c.maxConcurrent) : 1,
			),
		);
	}

	function formatError(error: unknown): string {
		if (error instanceof Error) return error.message;
		if (typeof error === "string") return error;
		try {
			return JSON.stringify(error);
		} catch {
			return String(error);
		}
	}

	function eventLevel(value: unknown) {
		return value === "debug" ||
			value === "info" ||
			value === "warn" ||
			value === "error"
			? value
			: "info";
	}

	return {
		hashSecret,
		generateSecret,

		async spawnRun(input: {
			prompt: string;
			runtime?: string | null;
			runtimeSessionRef?: string | null;
			metadata?: Record<string, unknown>;
		}) {
			const run = await collections.ai_runs.create({
				status: "pending",
				runtime: input.runtime ?? undefined,
				prompt: input.prompt,
				runtimeSessionRef: input.runtimeSessionRef ?? undefined,
				meta: input.metadata,
			});
			return { runId: run.id };
		},

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
			const active = await activeLeaseCount(workerId);
			const status = active > 0 ? "busy" : "online";
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
				leases.docs.map((lease) =>
					collections.ai_worker_leases.updateById({
						id: lease.id,
						data: { expiresAt },
					}),
				),
			);
			return { activeLeases: leases.docs.length, status };
		},

		async claimRun(input: {
			workerId: string;
			runtimes: string[];
			limit?: number;
		}) {
			const worker = await collections.ai_workers.findOne({
				where: { id: input.workerId },
			});
			if (!worker) return null;
			if (worker.status === "draining" || worker.status === "offline")
				return null;

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
			for (const candidate of pending.docs) {
				const runRuntime = candidate.runtime as string | undefined;
				if (!runRuntime || !runtimeSet.has(runRuntime)) continue;

				const updated = await collections.ai_runs.update({
					where: { id: candidate.id, status: "pending" },
					data: {
						status: "claimed",
						worker: input.workerId,
						startedAt: new Date(),
					},
				});
				const run = updated[0];
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
					lease: {
						id: lease.id,
						runId: String(run.id),
						expiresAt,
					},
					spawn: {
						prompt: (run.prompt as string) ?? "",
						runtime: runRuntime,
						runtimeSessionRef: run.runtimeSessionRef as string | undefined,
						metadata: isRecord(run.meta) ? run.meta : undefined,
					},
				};
			}
			return null;
		},

		async completeRun(input: {
			runId: string;
			workerId: string;
			result: Record<string, unknown>;
		}) {
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

		async failRun(input: { runId: string; workerId: string; error: unknown }) {
			await collections.ai_runs.updateById({
				id: input.runId,
				data: {
					status: "failed",
					error: formatError(input.error),
					endedAt: new Date(),
				},
			});
			const leases = await collections.ai_worker_leases.find({
				where: { worker: input.workerId, run: input.runId, status: "active" },
				limit: 1000,
			});
			await Promise.all(
				leases.docs.map((lease) =>
					collections.ai_worker_leases.updateById({
						id: lease.id,
						data: { status: "released" },
					}),
				),
			);
			const remaining = await activeLeaseCount(input.workerId);
			await setWorkerStatus(input.workerId, remaining > 0 ? "busy" : "online");
		},

		async reportRunEvent(input: {
			runId: string;
			event: Record<string, unknown>;
		}) {
			await collections.ai_run_events.create({
				run: input.runId,
				type: (input.event.type as string) ?? "unknown",
				level: eventLevel(input.event.level),
				summary: input.event.text ?? input.event.tool ?? undefined,
				sequence:
					typeof input.event.sequence === "number"
						? input.event.sequence
						: undefined,
				meta: input.event,
			});
		},

		async expireStaleLeases(now = new Date()) {
			const result = await collections.ai_worker_leases.find({
				where: { status: "active" },
				limit: 1000,
			});
			const expired = result.docs.filter(
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
						data: { status: "pending", worker: null },
					});
				}
			}
			return { expiredCount: expired.length };
		},
	};
}

// ===========================================================================
// Tests
// ===========================================================================

describe("Pure functions — hashSecret / generateSecret", () => {
	it("hashSecret produces consistent SHA256 hex", () => {
		const hash = hashSecret("test-secret");
		expect(hash).toHaveLength(64);
		expect(hash).toBe(hashSecret("test-secret"));
		expect(hash).not.toBe(hashSecret("different"));
	});

	it("generateSecret produces unique random hex strings", () => {
		const a = generateSecret();
		const b = generateSecret();
		expect(a).not.toBe(b);
		expect(a).toHaveLength(64); // 32 bytes = 64 hex chars
	});

	it("generateSecret respects byte length", () => {
		const short = generateSecret(8);
		expect(short).toHaveLength(16); // 8 bytes = 16 hex chars
	});
});

describe("Worker manager — registration & auth", () => {
	let collections: ReturnType<typeof createMockCollections>;
	let wm: ReturnType<typeof buildWorkerManager>;

	beforeEach(() => {
		collections = createMockCollections();
		wm = buildWorkerManager(collections);
	});

	it("registers a worker and authenticates by secret", async () => {
		const secret = generateSecret();
		const { workerId } = await wm.registerWorker({
			deviceId: "dev-1",
			name: "test-worker",
			volumeId: "vol_abc",
			capabilities: [{ runtime: "claude-code", maxConcurrent: 2 }],
			secret,
		});

		expect(workerId).toBeTruthy();

		const authed = await wm.authenticate(secret);
		expect(authed).not.toBeNull();
		expect(authed!.id).toBe(workerId);

		const bad = await wm.authenticate("wrong-secret");
		expect(bad).toBeNull();
	});

	it("re-registers same deviceId (updates existing)", async () => {
		const secret1 = generateSecret();
		const { workerId: id1 } = await wm.registerWorker({
			deviceId: "dev-1",
			name: "w1",
			volumeId: "vol1",
			capabilities: [],
			secret: secret1,
		});

		const secret2 = generateSecret();
		const { workerId: id2 } = await wm.registerWorker({
			deviceId: "dev-1",
			name: "w1-updated",
			volumeId: "vol2",
			capabilities: [],
			secret: secret2,
		});

		expect(id2).toBe(id1);
		const authed = await wm.authenticate(secret2);
		expect(authed!.id).toBe(id1);
	});

	it("deregister sets worker offline", async () => {
		const { workerId } = await wm.registerWorker({
			deviceId: "dev-1",
			name: "w",
			volumeId: "v",
			capabilities: [],
			secret: generateSecret(),
		});

		await wm.deregister(workerId);
		const worker = await collections.ai_workers.findOne({
			where: { id: workerId },
		});
		expect(worker!.status).toBe("offline");
	});
});

describe("Worker manager — spawn run", () => {
	let collections: ReturnType<typeof createMockCollections>;
	let wm: ReturnType<typeof buildWorkerManager>;

	beforeEach(() => {
		collections = createMockCollections();
		wm = buildWorkerManager(collections);
	});

	it("spawns a pending agnostic run", async () => {
		const { runId } = await wm.spawnRun({
			prompt: "do the work",
			runtime: "codex",
			runtimeSessionRef: "sess_123",
			metadata: { source: "test" },
		});

		const run = await collections.ai_runs.findOne({ where: { id: runId } });
		expect(run!.status).toBe("pending");
		expect(run!.prompt).toBe("do the work");
		expect(run!.runtime).toBe("codex");
		expect(run!.runtimeSessionRef).toBe("sess_123");
		expect(run!.meta).toEqual({ source: "test" });
	});

	it("does not let a Codex-only worker claim a runtime-less spawned run", async () => {
		const { workerId } = await wm.registerWorker({
			deviceId: "codex-dev",
			name: "codex-worker",
			volumeId: "vol",
			capabilities: [{ runtime: "codex", maxConcurrent: 1 }],
			secret: generateSecret(),
		});
		const { runId } = await wm.spawnRun({ prompt: "runtime missing" });

		const claimed = await wm.claimRun({ workerId, runtimes: ["codex"] });
		expect(claimed).toBeNull();

		const run = await collections.ai_runs.findOne({ where: { id: runId } });
		expect(run!.status).toBe("pending");
		expect(run!.worker).toBeUndefined();
		expect(run!.runtime).toBeUndefined();
	});
});

describe("Worker manager — claim / complete / heartbeat", () => {
	let collections: ReturnType<typeof createMockCollections>;
	let wm: ReturnType<typeof buildWorkerManager>;
	let workerId: string;

	beforeEach(async () => {
		collections = createMockCollections();
		wm = buildWorkerManager(collections);
		const { workerId: id } = await wm.registerWorker({
			deviceId: "dev-1",
			name: "worker",
			volumeId: "vol",
			capabilities: [{ runtime: "claude-code", maxConcurrent: 2 }],
			secret: generateSecret(),
		});
		workerId = id;
	});

	it("claims a pending run", async () => {
		await collections.ai_runs.create({
			status: "pending",
			runtime: "claude-code",
			prompt: "do something",
			createdAt: new Date(),
		});

		const claimed = await wm.claimRun({ workerId, runtimes: ["claude-code"] });
		expect(claimed).not.toBeNull();
		expect(claimed!.spawn.prompt).toBe("do something");
		expect(claimed!.spawn.runtime).toBe("claude-code");
		expect(claimed!.lease.id).toBeTruthy();
		expect(claimed!.lease.runId).toBeTruthy();
		expect(claimed!.lease.expiresAt).toBeInstanceOf(Date);

		const run = await collections.ai_runs.findOne({
			where: { id: claimed!.lease.runId },
		});
		expect(run!.status).toBe("claimed");
		expect(run!.worker).toBe(workerId);
	});

	it("returns null when no pending runs", async () => {
		const claimed = await wm.claimRun({ workerId, runtimes: ["claude-code"] });
		expect(claimed).toBeNull();
	});

	it("skips runs with non-matching runtime", async () => {
		await collections.ai_runs.create({
			status: "pending",
			runtime: "codex",
			prompt: "codex work",
			createdAt: new Date(),
		});

		const claimed = await wm.claimRun({ workerId, runtimes: ["claude-code"] });
		expect(claimed).toBeNull();
	});

	it("skips runtime-less pending runs", async () => {
		await collections.ai_runs.create({
			status: "pending",
			prompt: "missing runtime",
			createdAt: new Date(),
		});

		const claimed = await wm.claimRun({ workerId, runtimes: ["claude-code"] });
		expect(claimed).toBeNull();
	});

	it("respects maxConcurrent from capabilities", async () => {
		await collections.ai_runs.create({
			status: "pending",
			runtime: "claude-code",
			prompt: "a",
			createdAt: new Date(),
		});
		await collections.ai_runs.create({
			status: "pending",
			runtime: "claude-code",
			prompt: "b",
			createdAt: new Date(),
		});
		await collections.ai_runs.create({
			status: "pending",
			runtime: "claude-code",
			prompt: "c",
			createdAt: new Date(),
		});

		const r1 = await wm.claimRun({ workerId, runtimes: ["claude-code"] });
		expect(r1).not.toBeNull();
		const r2 = await wm.claimRun({ workerId, runtimes: ["claude-code"] });
		expect(r2).not.toBeNull();
		const r3 = await wm.claimRun({ workerId, runtimes: ["claude-code"] });
		expect(r3).toBeNull(); // maxConcurrent=2 hit
	});

	it("won't claim if worker is offline", async () => {
		await wm.deregister(workerId);
		await collections.ai_runs.create({
			status: "pending",
			runtime: "claude-code",
			prompt: "x",
			createdAt: new Date(),
		});

		const claimed = await wm.claimRun({ workerId, runtimes: ["claude-code"] });
		expect(claimed).toBeNull();
	});

	it("completeRun updates run and releases lease", async () => {
		await collections.ai_runs.create({
			status: "pending",
			runtime: "claude-code",
			prompt: "work",
			createdAt: new Date(),
		});
		const claimed = await wm.claimRun({ workerId, runtimes: ["claude-code"] });

		await wm.completeRun({
			runId: claimed!.lease.runId,
			workerId,
			result: { text: "done", inputTokens: 100, outputTokens: 50 },
		});

		const run = await collections.ai_runs.findOne({
			where: { id: claimed!.lease.runId },
		});
		expect(run!.status).toBe("completed");
		expect(run!.summary).toBe("done");
		expect(run!.tokensInput).toBe(100);

		const lease = await collections.ai_worker_leases.findOne({
			where: { run: claimed!.lease.runId },
		});
		expect(lease!.status).toBe("completed");

		const worker = await collections.ai_workers.findOne({
			where: { id: workerId },
		});
		expect(worker!.status).toBe("online"); // no active leases left
	});

	it("failRun stores the error and releases the active lease", async () => {
		await collections.ai_runs.create({
			status: "pending",
			runtime: "claude-code",
			prompt: "work",
			createdAt: new Date(),
		});
		const claimed = await wm.claimRun({ workerId, runtimes: ["claude-code"] });

		await wm.failRun({
			runId: claimed!.lease.runId,
			workerId,
			error: new Error("spawn failed"),
		});

		const run = await collections.ai_runs.findOne({
			where: { id: claimed!.lease.runId },
		});
		expect(run!.status).toBe("failed");
		expect(run!.error).toBe("spawn failed");
		expect(run!.endedAt).toBeInstanceOf(Date);

		const lease = await collections.ai_worker_leases.findOne({
			where: { run: claimed!.lease.runId },
		});
		expect(lease!.status).toBe("released");

		const worker = await collections.ai_workers.findOne({
			where: { id: workerId },
		});
		expect(worker!.status).toBe("online");
	});

	it("heartbeat sets status and extends leases", async () => {
		await collections.ai_runs.create({
			status: "pending",
			runtime: "claude-code",
			prompt: "t",
			createdAt: new Date(),
		});
		await wm.claimRun({ workerId, runtimes: ["claude-code"] });

		const { activeLeases, status } = await wm.heartbeat(workerId);
		expect(activeLeases).toBe(1);
		expect(status).toBe("busy");

		const worker = await collections.ai_workers.findOne({
			where: { id: workerId },
		});
		expect(worker!.status).toBe("busy");
	});

	it("reportRunEvent creates run event record", async () => {
		await wm.reportRunEvent({
			runId: "run-123",
			event: { type: "text.delta", level: "warn", sequence: 7, text: "hello" },
		});

		const events = await collections.ai_run_events.find({
			where: { run: "run-123" },
		});
		expect(events.docs).toHaveLength(1);
		expect(events.docs[0]!.type).toBe("text.delta");
		expect(events.docs[0]!.level).toBe("warn");
		expect(events.docs[0]!.sequence).toBe(7);
		expect(events.docs[0]!.summary).toBe("hello");
	});
});

describe("Worker manager — lease expiry", () => {
	let collections: ReturnType<typeof createMockCollections>;
	let wm: ReturnType<typeof buildWorkerManager>;
	let workerId: string;

	beforeEach(async () => {
		collections = createMockCollections();
		wm = buildWorkerManager(collections);
		const { workerId: id } = await wm.registerWorker({
			deviceId: "dev-1",
			name: "w",
			volumeId: "v",
			capabilities: [{ runtime: "claude-code", maxConcurrent: 1 }],
			secret: generateSecret(),
		});
		workerId = id;
	});

	it("expires stale leases and resets runs to pending", async () => {
		await collections.ai_runs.create({
			status: "pending",
			runtime: "claude-code",
			prompt: "expire me",
			createdAt: new Date(),
		});
		const claimed = await wm.claimRun({ workerId, runtimes: ["claude-code"] });

		// Manually set lease expiresAt to the past
		const lease = await collections.ai_worker_leases.findOne({
			where: { run: claimed!.lease.runId },
		});
		await collections.ai_worker_leases.updateById({
			id: lease!.id,
			data: { expiresAt: new Date(Date.now() - 60_000).toISOString() },
		});

		const { expiredCount } = await wm.expireStaleLeases();
		expect(expiredCount).toBe(1);

		const run = await collections.ai_runs.findOne({
			where: { id: claimed!.lease.runId },
		});
		expect(run!.status).toBe("pending");

		const updatedLease = await collections.ai_worker_leases.findOne({
			where: { id: lease!.id },
		});
		expect(updatedLease!.status).toBe("expired");
	});
});

describe("Embedded worker execution", () => {
	it("prepares the filesystem skills directory for Claude Code runs", async () => {
		const workerDir = await mkdtemp(join(tmpdir(), "questpie-ai-worker-"));

		try {
			const volume = await prepareWorkerVolume(workerDir);
			const skillsDir = join(
				workerDir,
				"homes",
				"claude-code",
				".claude",
				"skills",
			);
			const skillsStat = await stat(skillsDir);

			expect(volume.workerDir).toBe(workerDir);
			expect(volume.volumeId).toStartWith("vol_");
			expect(skillsStat.isDirectory()).toBe(true);
		} finally {
			await rm(workerDir, { recursive: true, force: true });
		}
	});

	it("calls failRun when spawn execution throws", async () => {
		const error = new Error("spawn failed");
		const failCalls: Array<{
			runId: string;
			workerId: string;
			error: unknown;
		}> = [];

		await executeRun(
			{
				async run() {
					throw error;
				},
			},
			{
				async reportRunEvent() {
					throw new Error("reportRunEvent should not be called");
				},
				async completeRun() {
					throw new Error("completeRun should not be called");
				},
				async failRun(input: {
					runId: string;
					workerId: string;
					error: unknown;
				}) {
					failCalls.push(input);
				},
			},
			{
				lease: {
					id: "lease_123",
					runId: "run_123",
					expiresAt: new Date(),
				},
				spawn: {
					runtime: "codex",
					prompt: "run this",
				},
			},
			"worker_123",
		);

		expect(failCalls).toHaveLength(1);
		expect(failCalls[0]).toEqual({
			runId: "run_123",
			workerId: "worker_123",
			error,
		});
	});
});

describe("End-to-end: run → worker → spawn-agent runner → completion", () => {
	it("full flow with fake spawn-agent runner", async () => {
		const collections = createMockCollections();
		const wm = buildWorkerManager(collections);

		// 1. Register worker
		const secret = generateSecret();
		const { workerId } = await wm.registerWorker({
			deviceId: "e2e-dev",
			name: "e2e-worker",
			volumeId: "vol_e2e",
			capabilities: [{ runtime: "claude-code", maxConcurrent: 1 }],
			secret,
		});

		// 2. App submits an agnostic pending run
		const { runId } = await wm.spawnRun({
			runtime: "claude-code",
			prompt: "write tests",
		});

		// 3. Worker claims run
		const claimed = await wm.claimRun({ workerId, runtimes: ["claude-code"] });
		expect(claimed).not.toBeNull();
		expect(claimed!.lease.runId).toBe(runId);
		expect(claimed!.spawn.prompt).toBe("write tests");

		// 4. Execute through the AI-owned spawn-agent runner seam
		const runner = createFakeSpawnAgentRunner({
			responseText: "Tests written successfully",
		});
		await executeRun(runner, wm, claimed!, workerId);

		// 5. Verify final state
		const run = await collections.ai_runs.findOne({ where: { id: runId } });
		expect(run!.status).toBe("completed");
		expect(run!.summary).toBe("Tests written successfully");

		const events = await collections.ai_run_events.find({
			where: { run: runId },
		});
		expect(events.docs.length).toBeGreaterThanOrEqual(5); // started, resolved, text.delta, usage, completed

		const worker = await collections.ai_workers.findOne({
			where: { id: workerId },
		});
		expect(worker!.status).toBe("online"); // back to online after completion

		const lease = await collections.ai_worker_leases.findOne({
			where: { run: runId },
		});
		expect(lease!.status).toBe("completed");
	});
});
