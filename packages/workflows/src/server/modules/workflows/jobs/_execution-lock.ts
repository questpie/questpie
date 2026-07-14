import { and, eq, inArray, isNull, lte, or } from "questpie/drizzle";
import type { AnyPgColumn } from "questpie/drizzle-pg-core";

import {
	resolveWorkflowsConfig,
	type WorkflowsConfigInput,
	type WorkflowsConfigState,
} from "../../../config.js";
import type { WorkflowRuntimeLogger } from "../routes/_helpers.js";

export type WorkflowExecutionLockClaimInput = {
	instanceId: string;
	ownerId: string;
	now: Date;
	expiresAt: Date;
	retryDelayMs: number;
};

export type WorkflowExecutionLockClaimResult =
	| {
			status: "claimed";
			ownerId: string;
			expiresAt: Date;
	  }
	| {
			status: "locked";
			retryAt: Date;
	  }
	| {
			status: "skipped";
			reason: "missing" | "not-executable";
			currentStatus?: string;
	  };

export type WorkflowExecutionLockRenewInput = {
	instanceId: string;
	ownerId: string;
	now: Date;
	expiresAt: Date;
};

export type WorkflowExecutionLockReleaseInput = {
	instanceId: string;
	ownerId: string;
	now: Date;
};

export interface WorkflowExecutionLockProvider {
	claim(
		input: WorkflowExecutionLockClaimInput,
	): Promise<WorkflowExecutionLockClaimResult>;
	renew(input: WorkflowExecutionLockRenewInput): Promise<boolean>;
	release(input: WorkflowExecutionLockReleaseInput): Promise<void>;
}

export type ClaimedWorkflowExecutionLock = {
	status: "claimed";
	instanceId: string;
	ownerId: string;
	leaseMs: number;
	heartbeatMs: number;
};

export type WorkflowExecutionLockResult =
	| ClaimedWorkflowExecutionLock
	| {
			status: "locked";
			retryAt: Date;
	  }
	| {
			status: "skipped";
			reason: "missing" | "not-executable";
			currentStatus?: string;
	  };

const DEFAULT_LEASE_SECONDS = 300;
const DEFAULT_RETRY_DELAY_SECONDS = 5;
const MIN_SECONDS = 1;
const EXECUTABLE_STATUSES = ["pending", "running", "suspended"] as const;

type WorkflowInstanceTable = {
	id: AnyPgColumn;
	status: AnyPgColumn;
	lockOwner: AnyPgColumn;
	lockedAt: AnyPgColumn;
	lockExpiresAt: AnyPgColumn;
	updatedAt: AnyPgColumn;
};

type WorkflowInstanceRow = {
	status?: unknown;
	lockExpiresAt?: unknown;
};

type WorkflowLockDb = {
	update(table: WorkflowInstanceTable): {
		set(values: Record<string, unknown>): {
			where(condition: unknown): {
				returning(): Promise<WorkflowInstanceRow[]>;
				returning<TSelection extends Record<string, unknown>>(
					selection: TSelection,
				): Promise<Array<Record<keyof TSelection, unknown>>>;
			};
		};
	};
	select(): {
		from(table: WorkflowInstanceTable): {
			where(condition: unknown): {
				limit(count: number): Promise<WorkflowInstanceRow[]>;
			};
		};
	};
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getWorkflowsConfig(ctx: unknown): WorkflowsConfigInput | undefined {
	if (!isRecord(ctx)) return undefined;
	const app = ctx.app;
	if (!isRecord(app)) return undefined;
	const state = app.state;
	if (!isRecord(state)) return undefined;
	return resolveWorkflowsConfig(state as WorkflowsConfigState);
}

function isWorkflowExecutionLockProvider(
	value: unknown,
): value is WorkflowExecutionLockProvider {
	return (
		isRecord(value) &&
		typeof value.claim === "function" &&
		typeof value.renew === "function" &&
		typeof value.release === "function"
	);
}

function readPositiveSeconds(
	value: number | undefined,
	fallback: number,
	name: string,
): number {
	if (value === undefined) return fallback;
	if (Number.isFinite(value) && value >= MIN_SECONDS) return value;
	throw new Error(
		`[questpie] workflows.executionLock.${name} must be a positive number of seconds.`,
	);
}

function resolveExecutionLockTiming(ctx: unknown): {
	leaseMs: number;
	heartbeatMs: number;
	retryDelayMs: number;
} {
	const lockConfig = getWorkflowsConfig(ctx)?.executionLock;
	const leaseSeconds = readPositiveSeconds(
		lockConfig?.leaseSeconds,
		DEFAULT_LEASE_SECONDS,
		"leaseSeconds",
	);
	const heartbeatDefault = Math.max(1, Math.min(60, leaseSeconds / 3));
	const heartbeatSeconds = readPositiveSeconds(
		lockConfig?.heartbeatSeconds,
		heartbeatDefault,
		"heartbeatSeconds",
	);
	const retryDelaySeconds = readPositiveSeconds(
		lockConfig?.retryDelaySeconds,
		DEFAULT_RETRY_DELAY_SECONDS,
		"retryDelaySeconds",
	);

	if (heartbeatSeconds >= leaseSeconds) {
		throw new Error(
			"[questpie] workflows.executionLock.heartbeatSeconds must be lower than leaseSeconds.",
		);
	}

	return {
		leaseMs: Math.floor(leaseSeconds * 1000),
		heartbeatMs: Math.floor(heartbeatSeconds * 1000),
		retryDelayMs: Math.floor(retryDelaySeconds * 1000),
	};
}

function createOwnerId(instanceId: string): string {
	const randomId =
		globalThis.crypto?.randomUUID?.() ??
		`${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
	return `wf-execute:${instanceId}:${randomId}`;
}

function getInjectedProvider(
	ctx: unknown,
): WorkflowExecutionLockProvider | undefined {
	if (!isRecord(ctx)) return undefined;
	return isWorkflowExecutionLockProvider(ctx.workflowExecutionLock)
		? ctx.workflowExecutionLock
		: undefined;
}

function getDbProvider(
	ctx: unknown,
	instancesCrud: unknown,
): WorkflowExecutionLockProvider {
	if (!isRecord(ctx) || !ctx.db) {
		throw new Error(
			"Workflow execution locks require a database handle on the job context.",
		);
	}

	const table = isRecord(instancesCrud)
		? instancesCrud["~internalRelatedTable"]
		: undefined;
	if (!table || typeof table !== "object") {
		throw new Error(
			"Workflow execution locks require the wf_instance internal table.",
		);
	}

	return new DbWorkflowExecutionLockProvider(
		ctx.db as WorkflowLockDb,
		table as WorkflowInstanceTable,
	);
}

function getProvider(
	ctx: unknown,
	instancesCrud: unknown,
): WorkflowExecutionLockProvider {
	return getInjectedProvider(ctx) ?? getDbProvider(ctx, instancesCrud);
}

class DbWorkflowExecutionLockProvider implements WorkflowExecutionLockProvider {
	constructor(
		private readonly db: WorkflowLockDb,
		private readonly table: WorkflowInstanceTable,
	) {}

	async claim(
		input: WorkflowExecutionLockClaimInput,
	): Promise<WorkflowExecutionLockClaimResult> {
		const lockAvailable = or(
			isNull(this.table.lockOwner),
			isNull(this.table.lockExpiresAt),
			lte(this.table.lockExpiresAt, input.now),
		);
		const rows = await this.db
			.update(this.table)
			.set({
				lockOwner: input.ownerId,
				lockedAt: input.now,
				lockExpiresAt: input.expiresAt,
				updatedAt: input.now,
			})
			.where(
				and(
					eq(this.table.id, input.instanceId),
					inArray(this.table.status, EXECUTABLE_STATUSES),
					lockAvailable,
				),
			)
			.returning();

		if (rows[0]) {
			return {
				status: "claimed",
				ownerId: input.ownerId,
				expiresAt: input.expiresAt,
			};
		}

		const existing = await this.findInstance(input.instanceId);
		if (!existing) return { status: "skipped", reason: "missing" };

		const currentStatus =
			typeof existing.status === "string" ? existing.status : undefined;
		if (!currentStatus || !isExecutableStatus(currentStatus)) {
			return {
				status: "skipped",
				reason: "not-executable",
				currentStatus,
			};
		}

		return {
			status: "locked",
			retryAt: this.resolveRetryAt(existing.lockExpiresAt, input),
		};
	}

	async renew(input: WorkflowExecutionLockRenewInput): Promise<boolean> {
		const rows = await this.db
			.update(this.table)
			.set({
				lockExpiresAt: input.expiresAt,
				updatedAt: input.now,
			})
			.where(
				and(
					eq(this.table.id, input.instanceId),
					eq(this.table.lockOwner, input.ownerId),
				),
			)
			.returning({ id: this.table.id });

		return rows.length > 0;
	}

	async release(input: WorkflowExecutionLockReleaseInput): Promise<void> {
		await this.db
			.update(this.table)
			.set({
				lockOwner: null,
				lockedAt: null,
				lockExpiresAt: null,
				updatedAt: input.now,
			})
			.where(
				and(
					eq(this.table.id, input.instanceId),
					eq(this.table.lockOwner, input.ownerId),
				),
			);
	}

	private async findInstance(
		instanceId: string,
	): Promise<WorkflowInstanceRow | null> {
		const rows = await this.db
			.select()
			.from(this.table)
			.where(eq(this.table.id, instanceId))
			.limit(1);
		return rows[0] ?? null;
	}

	private resolveRetryAt(
		lockExpiresAt: unknown,
		input: WorkflowExecutionLockClaimInput,
	): Date {
		const expiresAt = toValidDate(lockExpiresAt);

		if (expiresAt) {
			return new Date(Math.max(expiresAt.getTime(), input.now.getTime()));
		}

		return new Date(input.now.getTime() + input.retryDelayMs);
	}
}

function isExecutableStatus(
	status: string,
): status is (typeof EXECUTABLE_STATUSES)[number] {
	return (EXECUTABLE_STATUSES as readonly string[]).includes(status);
}

function toValidDate(value: unknown): Date | null {
	if (value instanceof Date) return value;
	if (typeof value !== "string") return null;

	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
}

export async function claimWorkflowExecutionLock(
	ctx: unknown,
	instancesCrud: unknown,
	instanceId: string,
): Promise<WorkflowExecutionLockResult> {
	const timing = resolveExecutionLockTiming(ctx);
	const provider = getProvider(ctx, instancesCrud);
	const ownerId = createOwnerId(instanceId);
	const now = new Date();
	const expiresAt = new Date(now.getTime() + timing.leaseMs);
	const result = await provider.claim({
		instanceId,
		ownerId,
		now,
		expiresAt,
		retryDelayMs: timing.retryDelayMs,
	});

	if (result.status !== "claimed") return result;

	return {
		status: "claimed",
		instanceId,
		ownerId,
		leaseMs: timing.leaseMs,
		heartbeatMs: timing.heartbeatMs,
	};
}

export function startWorkflowExecutionLockHeartbeat(
	ctx: unknown,
	instancesCrud: unknown,
	claim: ClaimedWorkflowExecutionLock,
	logger: WorkflowRuntimeLogger | undefined,
): { stop: () => void } {
	const provider = getProvider(ctx, instancesCrud);
	const timer = setInterval(() => {
		const now = new Date();
		const expiresAt = new Date(now.getTime() + claim.leaseMs);
		void provider
			.renew({
				instanceId: claim.instanceId,
				ownerId: claim.ownerId,
				now,
				expiresAt,
			})
			.then((renewed) => {
				if (!renewed) {
					logger?.error?.("Workflow execution lock heartbeat lost", {
						instanceId: claim.instanceId,
					});
				}
			})
			.catch((error) => {
				logger?.error?.("Workflow execution lock heartbeat failed", {
					instanceId: claim.instanceId,
					error: error instanceof Error ? error.message : String(error),
				});
			});
	}, claim.heartbeatMs);

	if (
		typeof timer === "object" &&
		timer !== null &&
		"unref" in timer &&
		typeof timer.unref === "function"
	) {
		timer.unref();
	}

	return {
		stop: () => clearInterval(timer),
	};
}

export async function releaseWorkflowExecutionLock(
	ctx: unknown,
	instancesCrud: unknown,
	claim: ClaimedWorkflowExecutionLock,
): Promise<void> {
	const provider = getProvider(ctx, instancesCrud);
	await provider.release({
		instanceId: claim.instanceId,
		ownerId: claim.ownerId,
		now: new Date(),
	});
}
