import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { AgentRuntimeError } from "../types/errors.js";

export interface VolumeLockInfo {
	daemonId: string;
	pid: number;
	hostname: string;
	startedAt: string;
	heartbeat: string;
}

const LOCK_FILE = "worker.lock";
const VOLUME_ID_FILE = "volume-id";

export class VolumeLock {
	private readonly lockPath: string;
	private readonly volumeIdPath: string;
	private readonly workerDir: string;
	private readonly staleLockTimeoutMs: number;
	private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
	readonly daemonId: string;

	constructor(workerDir: string, staleLockTimeoutMs = 60_000) {
		this.workerDir = workerDir;
		this.lockPath = join(workerDir, "worker", LOCK_FILE);
		this.volumeIdPath = join(workerDir, "worker", VOLUME_ID_FILE);
		this.staleLockTimeoutMs = staleLockTimeoutMs;
		this.daemonId = `daemon_${randomUUID().slice(0, 8)}`;
	}

	async acquire(heartbeatIntervalMs = 30_000): Promise<string> {
		await mkdir(join(this.workerDir, "worker"), { recursive: true });

		const existing = await this.readLock();
		if (existing) {
			const heartbeatAge =
				Date.now() - new Date(existing.heartbeat).getTime();
			if (heartbeatAge < this.staleLockTimeoutMs) {
				const isAlive = this.isProcessAlive(existing.pid);
				if (isAlive) {
					throw new AgentRuntimeError(
						"VOLUME_LOCKED",
						`Volume locked by daemon ${existing.daemonId} (pid ${existing.pid})`,
					);
				}
			}
		}

		const lockInfo: VolumeLockInfo = {
			daemonId: this.daemonId,
			pid: process.pid,
			hostname: hostname(),
			startedAt: new Date().toISOString(),
			heartbeat: new Date().toISOString(),
		};

		await writeFile(this.lockPath, JSON.stringify(lockInfo, null, "\t"));

		this.heartbeatTimer = setInterval(async () => {
			await this.updateHeartbeat();
		}, heartbeatIntervalMs);

		return this.ensureVolumeId();
	}

	async release(): Promise<void> {
		if (this.heartbeatTimer) {
			clearInterval(this.heartbeatTimer);
			this.heartbeatTimer = null;
		}

		const existing = await this.readLock();
		if (existing && existing.daemonId === this.daemonId) {
			const { unlink } = await import("node:fs/promises");
			await unlink(this.lockPath).catch(() => {});
		}
	}

	private async updateHeartbeat(): Promise<void> {
		const existing = await this.readLock();
		if (existing && existing.daemonId === this.daemonId) {
			existing.heartbeat = new Date().toISOString();
			await writeFile(
				this.lockPath,
				JSON.stringify(existing, null, "\t"),
			);
		}
	}

	private async readLock(): Promise<VolumeLockInfo | null> {
		try {
			const data = await readFile(this.lockPath, "utf-8");
			return JSON.parse(data);
		} catch {
			return null;
		}
	}

	private async ensureVolumeId(): Promise<string> {
		try {
			const existing = await readFile(this.volumeIdPath, "utf-8");
			if (existing.trim()) return existing.trim();
		} catch {}

		const volumeId = `vol_${randomUUID().slice(0, 12)}`;
		await writeFile(this.volumeIdPath, volumeId);
		return volumeId;
	}

	private isProcessAlive(pid: number): boolean {
		try {
			process.kill(pid, 0);
			return true;
		} catch {
			return false;
		}
	}
}
