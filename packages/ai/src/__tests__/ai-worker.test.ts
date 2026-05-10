import { describe, expect, it, beforeEach } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
	hashSecret,
	generateSecret,
} from "../server/modules/ai/services/worker-manager.js";
import { createDaemon } from "@questpie/agent-runtime/worker";
import { createFakeAdapter } from "@questpie/agent-runtime/testing";

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

		async findOne(opts: { where: Record<string, unknown> }): Promise<MockDoc | null> {
			return docs.find((d) => matchesWhere(d, opts.where)) ?? null;
		},

		async updateById(opts: { id: string; data: Record<string, unknown> }): Promise<MockDoc> {
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
		ai_sessions: createMockCollection(),
		ai_messages: createMockCollection(),
		ai_workers: createMockCollection(),
		ai_worker_leases: createMockCollection(),
		ai_run_events: createMockCollection(),
	};
}

// ---------------------------------------------------------------------------
// Build services with mock collections (mirrors service().create(ctx) shape)
// ---------------------------------------------------------------------------

function buildWorkerManager(collections: ReturnType<typeof createMockCollections>) {
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

	function parseCapabilities(value: unknown): Array<{ runtime?: string; maxConcurrent?: number }> {
		if (Array.isArray(value)) return value;
		if (typeof value !== "string") return [];
		try {
			const parsed = JSON.parse(value);
			return Array.isArray(parsed) ? parsed : [];
		} catch {
			return [];
		}
	}

	function maxConcurrentFromCapabilities(caps: Array<{ maxConcurrent?: number }>): number {
		if (caps.length === 0) return 1;
		return Math.max(1, ...caps.map((c) => (Number.isFinite(c.maxConcurrent) ? Number(c.maxConcurrent) : 1)));
	}

	return {
		hashSecret,
		generateSecret,

		async authenticate(secret: string | null | undefined) {
			if (!secret) return null;
			return collections.ai_workers.findOne({ where: { secretHash: hashSecret(secret) } });
		},

		async registerWorker(input: {
			deviceId: string;
			name: string;
			volumeId: string;
			capabilities: unknown;
			secret: string;
		}) {
			const existing = await collections.ai_workers.findOne({ where: { deviceId: input.deviceId } });
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
					collections.ai_worker_leases.updateById({ id: lease.id, data: { expiresAt } }),
				),
			);
			return { activeLeases: leases.docs.length, status };
		},

		async claimRun(input: { workerId: string; runtimes: string[]; limit?: number }) {
			const worker = await collections.ai_workers.findOne({ where: { id: input.workerId } });
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
			for (const candidate of pending.docs) {
				const runRuntime = candidate.runtime as string | undefined;
				if (runRuntime && !runtimeSet.has(runRuntime)) continue;

				const updated = await collections.ai_runs.update({
					where: { id: candidate.id, status: "pending" },
					data: { status: "claimed", worker: input.workerId, startedAt: new Date() },
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
				await collections.ai_worker_leases.updateById({ id: lease.id, data: { status: "completed" } });
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
			const result = await collections.ai_worker_leases.find({ where: { status: "active" }, limit: 1000 });
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

function buildChatService(collections: ReturnType<typeof createMockCollections>) {
	return {
		async sendMessage(input: { sessionId?: string | null; content: string }) {
			let sessionId = input.sessionId;
			if (!sessionId) {
				const session = await collections.ai_sessions.create({
					status: "active",
					scopeType: "global",
				});
				sessionId = session.id;
			}
			const message = await collections.ai_messages.create({
				session: sessionId,
				role: "user",
				content: input.content,
			});
			const run = await collections.ai_runs.create({
				session: sessionId,
				status: "pending",
				runtime: "claude-code",
				prompt: input.content,
				createdAt: new Date(),
			});
			return { sessionId: sessionId!, messageId: message.id, runId: run.id };
		},

		async createAssistantMessage(input: {
			sessionId: string;
			runId: string;
			content: unknown;
			model?: string;
		}) {
			return collections.ai_messages.create({
				session: input.sessionId,
				role: "assistant",
				content: input.content,
				run: input.runId,
				model: input.model ?? undefined,
			});
		},

		async getMessages(sessionId: string) {
			const result = await collections.ai_messages.find({
				where: { session: sessionId },
				orderBy: { createdAt: "asc" },
			});
			return result.docs;
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
		const worker = await collections.ai_workers.findOne({ where: { id: workerId } });
		expect(worker!.status).toBe("offline");
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
		expect(claimed!.prompt).toBe("do something");
		expect(claimed!.runtime).toBe("claude-code");

		const run = await collections.ai_runs.findOne({ where: { id: claimed!.runId } });
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
			prompt: "codex task",
			createdAt: new Date(),
		});

		const claimed = await wm.claimRun({ workerId, runtimes: ["claude-code"] });
		expect(claimed).toBeNull();
	});

	it("respects maxConcurrent from capabilities", async () => {
		await collections.ai_runs.create({ status: "pending", runtime: "claude-code", prompt: "a", createdAt: new Date() });
		await collections.ai_runs.create({ status: "pending", runtime: "claude-code", prompt: "b", createdAt: new Date() });
		await collections.ai_runs.create({ status: "pending", runtime: "claude-code", prompt: "c", createdAt: new Date() });

		const r1 = await wm.claimRun({ workerId, runtimes: ["claude-code"] });
		expect(r1).not.toBeNull();
		const r2 = await wm.claimRun({ workerId, runtimes: ["claude-code"] });
		expect(r2).not.toBeNull();
		const r3 = await wm.claimRun({ workerId, runtimes: ["claude-code"] });
		expect(r3).toBeNull(); // maxConcurrent=2 hit
	});

	it("won't claim if worker is offline", async () => {
		await wm.deregister(workerId);
		await collections.ai_runs.create({ status: "pending", runtime: "claude-code", prompt: "x", createdAt: new Date() });

		const claimed = await wm.claimRun({ workerId, runtimes: ["claude-code"] });
		expect(claimed).toBeNull();
	});

	it("completeRun updates run and releases lease", async () => {
		await collections.ai_runs.create({ status: "pending", runtime: "claude-code", prompt: "task", createdAt: new Date() });
		const claimed = await wm.claimRun({ workerId, runtimes: ["claude-code"] });

		await wm.completeRun({
			runId: claimed!.runId,
			workerId,
			result: { text: "done", inputTokens: 100, outputTokens: 50 },
		});

		const run = await collections.ai_runs.findOne({ where: { id: claimed!.runId } });
		expect(run!.status).toBe("completed");
		expect(run!.summary).toBe("done");
		expect(run!.tokensInput).toBe(100);

		const lease = await collections.ai_worker_leases.findOne({ where: { run: claimed!.runId } });
		expect(lease!.status).toBe("completed");

		const worker = await collections.ai_workers.findOne({ where: { id: workerId } });
		expect(worker!.status).toBe("online"); // no active leases left
	});

	it("heartbeat sets status and extends leases", async () => {
		await collections.ai_runs.create({ status: "pending", runtime: "claude-code", prompt: "t", createdAt: new Date() });
		await wm.claimRun({ workerId, runtimes: ["claude-code"] });

		const { activeLeases, status } = await wm.heartbeat(workerId);
		expect(activeLeases).toBe(1);
		expect(status).toBe("busy");

		const worker = await collections.ai_workers.findOne({ where: { id: workerId } });
		expect(worker!.status).toBe("busy");
	});

	it("reportEvent creates run event record", async () => {
		await wm.reportEvent({
			runId: "run-123",
			event: { type: "text.delta", text: "hello" },
		});

		const events = await collections.ai_run_events.find({ where: { run: "run-123" } });
		expect(events.docs).toHaveLength(1);
		expect(events.docs[0]!.type).toBe("text.delta");
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
		const lease = await collections.ai_worker_leases.findOne({ where: { run: claimed!.runId } });
		await collections.ai_worker_leases.updateById({
			id: lease!.id,
			data: { expiresAt: new Date(Date.now() - 60_000).toISOString() },
		});

		const { expiredCount } = await wm.expireStaleLeases();
		expect(expiredCount).toBe(1);

		const run = await collections.ai_runs.findOne({ where: { id: claimed!.runId } });
		expect(run!.status).toBe("pending");

		const updatedLease = await collections.ai_worker_leases.findOne({ where: { id: lease!.id } });
		expect(updatedLease!.status).toBe("expired");
	});
});

describe("Chat service", () => {
	let collections: ReturnType<typeof createMockCollections>;
	let chat: ReturnType<typeof buildChatService>;

	beforeEach(() => {
		collections = createMockCollections();
		chat = buildChatService(collections);
	});

	it("sendMessage creates session + message + pending run", async () => {
		const result = await chat.sendMessage({ content: "hello AI" });

		expect(result.sessionId).toBeTruthy();
		expect(result.messageId).toBeTruthy();
		expect(result.runId).toBeTruthy();

		const session = await collections.ai_sessions.findOne({ where: { id: result.sessionId } });
		expect(session!.status).toBe("active");

		const message = await collections.ai_messages.findOne({ where: { id: result.messageId } });
		expect(message!.role).toBe("user");
		expect(message!.content).toBe("hello AI");

		const run = await collections.ai_runs.findOne({ where: { id: result.runId } });
		expect(run!.status).toBe("pending");
		expect(run!.prompt).toBe("hello AI");
	});

	it("sendMessage reuses existing sessionId", async () => {
		const r1 = await chat.sendMessage({ content: "first" });
		const r2 = await chat.sendMessage({ sessionId: r1.sessionId, content: "second" });
		expect(r2.sessionId).toBe(r1.sessionId);

		const sessions = await collections.ai_sessions.find({});
		expect(sessions.docs).toHaveLength(1);
	});

	it("createAssistantMessage records assistant reply", async () => {
		const { sessionId, runId } = await chat.sendMessage({ content: "hi" });
		const msg = await chat.createAssistantMessage({
			sessionId,
			runId,
			content: "hello back",
		});

		expect(msg.role).toBe("assistant");
		expect(msg.content).toBe("hello back");
		expect(msg.run).toBe(runId);
	});

	it("getMessages returns ordered messages", async () => {
		const { sessionId } = await chat.sendMessage({ content: "one" });
		await chat.sendMessage({ sessionId, content: "two" });
		await chat.createAssistantMessage({ sessionId, runId: "r", content: "reply" });

		const msgs = await chat.getMessages(sessionId);
		expect(msgs).toHaveLength(3);
		expect(msgs[0]!.content).toBe("one");
		expect(msgs[1]!.content).toBe("two");
		expect(msgs[2]!.role).toBe("assistant");
	});
});

describe("End-to-end: chat → worker → daemon → completion", () => {
	it("full flow with fake adapter", async () => {
		const collections = createMockCollections();
		const wm = buildWorkerManager(collections);
		const chat = buildChatService(collections);
		const workerDir = await mkdtemp(join(tmpdir(), "ai-e2e-"));

		// 1. Register worker
		const secret = generateSecret();
		const { workerId } = await wm.registerWorker({
			deviceId: "e2e-dev",
			name: "e2e-worker",
			volumeId: "vol_e2e",
			capabilities: [{ runtime: "claude-code", maxConcurrent: 1 }],
			secret,
		});

		// 2. User sends message → creates pending run
		const { sessionId, runId } = await chat.sendMessage({ content: "write tests" });

		// 3. Worker claims run
		const claimed = await wm.claimRun({ workerId, runtimes: ["claude-code"] });
		expect(claimed).not.toBeNull();
		expect(claimed!.runId).toBe(runId);
		expect(claimed!.prompt).toBe("write tests");

		// 4. Create daemon with fake adapter and execute
		const adapter = createFakeAdapter({ responseText: "Tests written successfully" });
		const daemon = createDaemon(
			{ workerDir, runtimes: [{ runtime: "claude-code" }] },
			[adapter],
		);
		await daemon.start();

		try {
			const handle = await daemon.submit({
				type: "message.send",
				runtime: claimed!.runtime as any,
				prompt: claimed!.prompt,
				sessionRef: claimed!.sessionRef,
				priority: 100,
				meta: { runId: claimed!.runId },
			});

			// 5. Stream events and report
			let sequence = 0;
			let accumulatedText = "";
			for await (const event of handle.events) {
				await wm.reportEvent({
					runId: claimed!.runId,
					event: { ...event, sequence: sequence++ },
				});
				if (event.type === "text.delta") {
					accumulatedText += event.text;
				}
			}

			// 6. Complete the run
			const result = await handle.completion;
			await chat.createAssistantMessage({
				sessionId,
				runId: claimed!.runId,
				content: accumulatedText,
			});
			await wm.completeRun({ runId: claimed!.runId, workerId, result: result as unknown as Record<string, unknown> });

			// 7. Verify final state
			const run = await collections.ai_runs.findOne({ where: { id: runId } });
			expect(run!.status).toBe("completed");
			expect(run!.summary).toBe("Tests written successfully");

			const events = await collections.ai_run_events.find({ where: { run: runId } });
			expect(events.docs.length).toBeGreaterThanOrEqual(4); // started, resolved, text.delta, usage, completed

			const messages = await chat.getMessages(sessionId);
			expect(messages).toHaveLength(2);
			expect(messages[0]!.role).toBe("user");
			expect(messages[1]!.role).toBe("assistant");
			expect(messages[1]!.content).toBe("Tests written successfully");

			const worker = await collections.ai_workers.findOne({ where: { id: workerId } });
			expect(worker!.status).toBe("online"); // back to online after completion

			const lease = await collections.ai_worker_leases.findOne({ where: { run: runId } });
			expect(lease!.status).toBe("completed");
		} finally {
			await daemon.stop();
		}
	});
});
