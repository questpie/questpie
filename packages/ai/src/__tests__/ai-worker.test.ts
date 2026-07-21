/**
 * Worker-manager service over the single-model execution path: run_links is
 * the one execution record a worker claims (id-scoped CAS + producerLease
 * epoch fence) and heartbeats against. Exercises the REAL service factory
 * with an in-memory mock of the collections it touches (ai_workers +
 * run_links). Finalize/reap behavior lives in finalize-run.test.ts and
 * reap-run-links.test.ts.
 */

import { describe, expect, it, beforeEach } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startAIWorker } from "../exports/worker.js";
import workerManagerService, {
	hashSecret,
	generateSecret,
} from "../server/modules/ai/services/worker-manager.js";
import { prepareWorkerVolume } from "../server/worker/worker-volume.js";

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
		ai_workers: createMockCollection(),
		run_links: createMockCollection(),
	};
}

// ---------------------------------------------------------------------------
// Instantiate the REAL worker-manager service with a mock app context
// (the factory only reaches for ctx.app.collections)
// ---------------------------------------------------------------------------

const createWorkerManager = workerManagerService.state.create!;
type WorkerManager = Awaited<ReturnType<typeof createWorkerManager>>;

function buildWorkerManager(
	collections: ReturnType<typeof createMockCollections>,
): WorkerManager {
	return createWorkerManager({
		app: { collections },
	} as never) as WorkerManager;
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
	let wm: WorkerManager;

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

describe("Worker manager — claim (run_links CAS)", () => {
	let collections: ReturnType<typeof createMockCollections>;
	let wm: WorkerManager;
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

	it("claims a pending run_link and maps instructions → spawn.prompt", async () => {
		await collections.run_links.create({
			status: "pending",
			runtime: "claude-code",
			instructions: "do something",
			runtimeSessionRef: "sess_123",
			metadata: { cwd: "/tmp/project-a", source: "test" },
			createdAt: new Date(),
		});

		const claimed = await wm.claimRun({ workerId, runtimes: ["claude-code"] });
		expect(claimed).not.toBeNull();
		expect(claimed!.spawn.prompt).toBe("do something");
		expect(claimed!.spawn.runtime).toBe("claude-code");
		expect(claimed!.spawn.runtimeSessionRef).toBe("sess_123");
		expect("cwd" in claimed!.spawn).toBe(false);
		expect(claimed!.spawn.metadata).toEqual({
			cwd: "/tmp/project-a",
			source: "test",
		});
		expect(claimed!.lease.id).toBeTruthy();
		expect(claimed!.lease.runId).toBeTruthy();
		expect(claimed!.lease.expiresAt).toBeInstanceOf(Date);
		expect(claimed!.lease.expiresAt.getTime()).toBeGreaterThan(Date.now());

		// The claimed row + epoch travel with the claim — runHarnessRun and the
		// ONE finalizeRun fence on them.
		expect(claimed!.run!.id).toBe(claimed!.lease.runId);
		expect(claimed!.epoch).toBe(1);

		const run = await collections.run_links.findOne({
			where: { id: claimed!.lease.runId },
		});
		expect(run!.status).toBe("claimed");
		expect(run!.worker).toBe(workerId);
		expect(run!.startedAt).toBeInstanceOf(Date);

		// producerLease lives on the row (no ai_worker_leases anymore).
		const lease = run!.producerLease as Record<string, unknown>;
		expect(lease.epoch).toBe(1);
		expect(lease.workerId).toBe(workerId);
		expect(lease.leaseId).toBe(claimed!.lease.id);
		expect(typeof lease.expiresAt).toBe("string");
		expect(typeof lease.heartbeatAt).toBe("string");

		const worker = await collections.ai_workers.findOne({
			where: { id: workerId },
		});
		expect(worker!.status).toBe("busy");
	});

	it("bumps producerLease.epoch on claim (fences prior writers)", async () => {
		// A requeued row keeps its lease epoch — the reaper left epoch 5 behind.
		await collections.run_links.create({
			status: "pending",
			runtime: "claude-code",
			instructions: "requeued after reap",
			producerLease: { epoch: 5 },
			createdAt: new Date(),
		});

		const claimed = await wm.claimRun({ workerId, runtimes: ["claude-code"] });
		expect(claimed).not.toBeNull();
		expect(claimed!.epoch).toBe(6);

		const run = await collections.run_links.findOne({
			where: { id: claimed!.lease.runId },
		});
		const lease = run!.producerLease as Record<string, unknown>;
		expect(lease.epoch).toBe(6);
		expect(lease.workerId).toBe(workerId);
	});

	it("falls through to the next candidate when the first CAS loses", async () => {
		const first = await collections.run_links.create({
			status: "pending",
			runtime: "claude-code",
			instructions: "first candidate",
			createdAt: new Date(Date.now() - 1000),
		});
		const second = await collections.run_links.create({
			status: "pending",
			runtime: "claude-code",
			instructions: "second candidate",
			createdAt: new Date(),
		});

		// Simulate a rival worker winning the id-scoped CAS on the first
		// candidate between our find() and update().
		const realUpdate = collections.run_links.update.bind(collections.run_links);
		let raced = false;
		collections.run_links.update = async (opts) => {
			if (!raced && opts.where.id === first.id) {
				raced = true;
				await realUpdate({
					where: { id: first.id, status: "pending" },
					data: { status: "claimed", worker: "rival-worker" },
				});
			}
			return realUpdate(opts);
		};

		const claimed = await wm.claimRun({ workerId, runtimes: ["claude-code"] });
		expect(raced).toBe(true);
		expect(claimed).not.toBeNull();
		expect(claimed!.lease.runId).toBe(second.id);
		expect(claimed!.spawn.prompt).toBe("second candidate");

		// The rival's claim on the first candidate stays untouched.
		const firstRow = await collections.run_links.findOne({
			where: { id: first.id },
		});
		expect(firstRow!.status).toBe("claimed");
		expect(firstRow!.worker).toBe("rival-worker");
	});

	it("returns null when no pending run_links", async () => {
		const claimed = await wm.claimRun({ workerId, runtimes: ["claude-code"] });
		expect(claimed).toBeNull();
	});

	it("skips run_links with non-matching runtime", async () => {
		await collections.run_links.create({
			status: "pending",
			runtime: "codex",
			instructions: "codex work",
			createdAt: new Date(),
		});

		const claimed = await wm.claimRun({ workerId, runtimes: ["claude-code"] });
		expect(claimed).toBeNull();
	});

	it("skips runtime-less pending run_links", async () => {
		const row = await collections.run_links.create({
			status: "pending",
			instructions: "missing runtime",
			createdAt: new Date(),
		});

		const claimed = await wm.claimRun({ workerId, runtimes: ["claude-code"] });
		expect(claimed).toBeNull();

		const run = await collections.run_links.findOne({ where: { id: row.id } });
		expect(run!.status).toBe("pending");
		expect(run!.worker).toBeUndefined();
	});

	it("does not claim a runtime outside the worker capabilities", async () => {
		await collections.run_links.create({
			status: "pending",
			runtime: "codex",
			instructions: "unsupported runtime",
			createdAt: new Date(),
		});

		const claimed = await wm.claimRun({ workerId, runtimes: ["codex"] });
		expect(claimed).toBeNull();
	});

	it("won't claim if worker is offline", async () => {
		await wm.deregister(workerId);
		await collections.run_links.create({
			status: "pending",
			runtime: "claude-code",
			instructions: "x",
			createdAt: new Date(),
		});

		const claimed = await wm.claimRun({ workerId, runtimes: ["claude-code"] });
		expect(claimed).toBeNull();
	});

	it("respects maxConcurrent via run_links counts", async () => {
		await collections.run_links.create({
			status: "pending",
			runtime: "claude-code",
			instructions: "a",
			createdAt: new Date(),
		});
		await collections.run_links.create({
			status: "pending",
			runtime: "claude-code",
			instructions: "b",
			createdAt: new Date(),
		});
		await collections.run_links.create({
			status: "pending",
			runtime: "claude-code",
			instructions: "c",
			createdAt: new Date(),
		});

		const r1 = await wm.claimRun({ workerId, runtimes: ["claude-code"] });
		expect(r1).not.toBeNull();
		const r2 = await wm.claimRun({ workerId, runtimes: ["claude-code"] });
		expect(r2).not.toBeNull();
		const r3 = await wm.claimRun({ workerId, runtimes: ["claude-code"] });
		expect(r3).toBeNull(); // maxConcurrent=2 hit via claimed run_links rows
	});

	it("counts running run_links rows toward the per-runtime limit", async () => {
		// Rows this worker already executes (claimed earlier, one now running).
		await collections.run_links.create({
			status: "claimed",
			runtime: "claude-code",
			worker: workerId,
			instructions: "in flight",
			createdAt: new Date(Date.now() - 2000),
		});
		await collections.run_links.create({
			status: "running",
			runtime: "claude-code",
			worker: workerId,
			instructions: "streaming",
			createdAt: new Date(Date.now() - 1000),
		});
		await collections.run_links.create({
			status: "pending",
			runtime: "claude-code",
			instructions: "waiting",
			createdAt: new Date(),
		});

		const claimed = await wm.claimRun({ workerId, runtimes: ["claude-code"] });
		expect(claimed).toBeNull(); // claimed+running rows saturate maxConcurrent=2
	});

	it("applies maxConcurrent per runtime capability instead of globally", async () => {
		const { workerId: multiRuntimeWorkerId } = await wm.registerWorker({
			deviceId: "multi-runtime",
			name: "multi-runtime-worker",
			volumeId: "vol_multi",
			capabilities: [
				{ runtime: "claude-code", maxConcurrent: 1 },
				{ runtime: "codex", maxConcurrent: 1 },
			],
			secret: generateSecret(),
		});
		await collections.run_links.create({
			status: "pending",
			runtime: "claude-code",
			instructions: "long background task",
			createdAt: new Date(),
		});
		await collections.run_links.create({
			status: "pending",
			runtime: "codex",
			instructions: "chat response",
			createdAt: new Date(),
		});
		await collections.run_links.create({
			status: "pending",
			runtime: "codex",
			instructions: "second chat response",
			createdAt: new Date(),
		});

		const background = await wm.claimRun({
			workerId: multiRuntimeWorkerId,
			runtimes: ["claude-code"],
		});
		expect(background).not.toBeNull();
		expect(background!.spawn.runtime).toBe("claude-code");

		const chat = await wm.claimRun({
			workerId: multiRuntimeWorkerId,
			runtimes: ["codex"],
		});
		expect(chat).not.toBeNull();
		expect(chat!.spawn.runtime).toBe("codex");
		expect(chat!.spawn.prompt).toBe("chat response");

		const saturatedCodex = await wm.claimRun({
			workerId: multiRuntimeWorkerId,
			runtimes: ["codex"],
		});
		expect(saturatedCodex).toBeNull();
	});
});

describe("Worker manager — heartbeat", () => {
	let collections: ReturnType<typeof createMockCollections>;
	let wm: WorkerManager;
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

	it("reports online for an idle worker", async () => {
		const { activeLeases, status } = await wm.heartbeat(workerId);
		expect(activeLeases).toBe(0);
		expect(status).toBe("online");
	});

	it("stays busy while a claimed/running run_links row exists for the worker", async () => {
		await collections.run_links.create({
			status: "pending",
			runtime: "claude-code",
			instructions: "t",
			createdAt: new Date(),
		});
		const claimed = await wm.claimRun({ workerId, runtimes: ["claude-code"] });
		expect(claimed).not.toBeNull();

		const afterClaim = await wm.heartbeat(workerId);
		expect(afterClaim.activeLeases).toBe(1);
		expect(afterClaim.status).toBe("busy");

		// The executing worker flips the row to running — still busy.
		await collections.run_links.updateById({
			id: claimed!.lease.runId,
			data: { status: "running" },
		});
		const whileRunning = await wm.heartbeat(workerId);
		expect(whileRunning.activeLeases).toBe(1);
		expect(whileRunning.status).toBe("busy");

		const worker = await collections.ai_workers.findOne({
			where: { id: workerId },
		});
		expect(worker!.status).toBe("busy");
	});

	it("returns to online once the worker's rows are terminal", async () => {
		await collections.run_links.create({
			status: "pending",
			runtime: "claude-code",
			instructions: "work",
			createdAt: new Date(),
		});
		const claimed = await wm.claimRun({ workerId, runtimes: ["claude-code"] });

		// Another worker's in-flight run must not keep THIS worker busy.
		await collections.run_links.create({
			status: "running",
			runtime: "claude-code",
			worker: "other-worker",
			instructions: "not ours",
			createdAt: new Date(),
		});

		// finalizeRun's terminal write, simulated directly on the row.
		await collections.run_links.updateById({
			id: claimed!.lease.runId,
			data: { status: "completed" },
		});

		const { activeLeases, status } = await wm.heartbeat(workerId);
		expect(activeLeases).toBe(0);
		expect(status).toBe("online");

		const worker = await collections.ai_workers.findOne({
			where: { id: workerId },
		});
		expect(worker!.status).toBe("online");
	});
});

describe("Embedded worker execution", () => {
	it("prepares the worker volume directory with a stable volume id", async () => {
		const workerDir = await mkdtemp(join(tmpdir(), "questpie-ai-worker-"));

		try {
			const volume = await prepareWorkerVolume(workerDir);
			const workerStat = await stat(join(workerDir, "worker"));

			expect(volume.workerDir).toBe(workerDir);
			expect(volume.volumeId).toStartWith("vol_");
			expect(workerStat.isDirectory()).toBe(true);

			// Stable across calls (persisted to disk).
			const again = await prepareWorkerVolume(workerDir);
			expect(again.volumeId).toBe(volume.volumeId);
		} finally {
			await rm(workerDir, { recursive: true, force: true });
		}
	});

	it("polls the configured harness runtime", async () => {
		const workerDir = await mkdtemp(join(tmpdir(), "questpie-ai-worker-"));
		const claims: string[][] = [];
		const worker = await startAIWorker(
			{
				services: {
					workerManager: {
						async registerWorker() {
							return { workerId: "worker-runtime-poll" };
						},
						async heartbeat() {
							return { activeLeases: 0, status: "online" };
						},
						async claimRun(input: { runtimes: string[] }) {
							claims.push(input.runtimes);
							return null;
						},
						async deregister() {},
					},
				},
			},
			{
				workerDir,
				runtimes: [{ runtime: "claude-code" }],
				maxConcurrentRuns: 1,
				pollIntervalMs: 10,
			},
		);

		try {
			const deadline = Date.now() + 500;
			while (
				Date.now() < deadline &&
				!claims.some(
					(runtimes) => runtimes.length === 1 && runtimes[0] === "claude-code",
				)
			) {
				await new Promise((resolve) => setTimeout(resolve, 5));
			}

			expect(claims).toContainEqual(["claude-code"]);
		} finally {
			await worker.stop();
			await rm(workerDir, { recursive: true, force: true });
		}
	});
});
