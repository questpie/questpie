import type { RouteAccessContext, RouteAccessRule } from "questpie";

export type WorkflowAccessOperation =
	| "trigger"
	| "read"
	| "sendEvent"
	| "cancel"
	| "retry";

export type WorkflowAccessRule = RouteAccessRule;

export interface WorkflowsAccessConfig {
	/**
	 * Fallback rule for every workflow route.
	 */
	default?: WorkflowAccessRule;
	/**
	 * Route group used by admin UI reads: definitions, instances, details.
	 */
	read?: WorkflowAccessRule;
	/**
	 * Fallback for mutating admin operations.
	 */
	manage?: WorkflowAccessRule;
	trigger?: WorkflowAccessRule;
	sendEvent?: WorkflowAccessRule;
	cancel?: WorkflowAccessRule;
	retry?: WorkflowAccessRule;
}

export interface WorkflowsConfigInput {
	/**
	 * Access control for workflow routes. A single rule applies to every route;
	 * an object can override specific operations.
	 *
	 * Default: logged-in admin user (`session.user.role === "admin"`).
	 */
	access?: WorkflowAccessRule | WorkflowsAccessConfig;
	/**
	 * Per-instance execution lease settings. The lease is stored on
	 * `wf_instance` and renewed while `wf-execute` is running, making duplicate
	 * queue deliveries idempotent across Cloudflare Queues, PgBoss, BullMQ, etc.
	 */
	executionLock?: WorkflowsExecutionLockConfig;
}

export interface WorkflowsExecutionLockConfig {
	/**
	 * How long a worker owns an instance claim without a heartbeat.
	 *
	 * Default: 300 seconds.
	 */
	leaseSeconds?: number;
	/**
	 * How often the active worker renews the lease.
	 *
	 * Default: one third of `leaseSeconds`, capped at 60 seconds.
	 */
	heartbeatSeconds?: number;
	/**
	 * Delay used when a duplicate delivery finds an active lock without a usable
	 * expiry timestamp.
	 *
	 * Default: 5 seconds.
	 */
	retryDelaySeconds?: number;
}

export function workflowsConfig<T extends WorkflowsConfigInput>(config: T): T {
	return config;
}

export function defaultWorkflowAccess(ctx: RouteAccessContext): boolean {
	const session = (ctx as { session?: unknown }).session as
		| { user?: { role?: string | null } | null }
		| null
		| undefined;
	return session?.user?.role === "admin";
}
