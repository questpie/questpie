/**
 * wf-maintenance Job
 *
 * Periodic cron job that:
 * 1. Resumes sleeping steps whose scheduledAt has passed
 * 2. Times out instances that have exceeded their timeout
 * 3. Triggers cron-scheduled workflows (with overlap guard)
 * 4. Cleans up old completed instances based on retention policy
 *
 * Runs every 5 minutes by default.
 */

import { job } from "questpie";
import { z } from "zod";

import type { CollectionCrud } from "../../../client.js";
import { cronFiredInWindow } from "../../../engine/cron.js";
import { parseDuration } from "../../../engine/duration.js";
import type {
	CronOverlapPolicy,
	RetentionPolicy,
	WorkflowDefinition,
} from "../../../workflow/types.js";

/** Maintenance polling interval in minutes. */
const POLL_INTERVAL_MINUTES = 5;

export const wfMaintenanceJob = job({
	name: "questpie-wf-maintenance",
	schema: z.object({}),
	options: {
		cron: "*/5 * * * *",
		retryLimit: 1,
	},
	handler: async (ctx) => {
		const collections = (ctx as any).collections as
			| Record<string, CollectionCrud>
			| undefined;
		const queue = (ctx as any).queue as any;
		const logger = (ctx as any).logger as any;
		const app = (ctx as any).app as any;

		const instancesCrud = collections?.wf_instance;
		const stepsCrud = collections?.wf_step;
		const eventsCrud = collections?.wf_event;
		const logsCrud = collections?.wf_log;

		if (!instancesCrud || !stepsCrud) {
			throw new Error(
				"Workflow system collections not found. Is workflowsModule registered?",
			);
		}

		const now = new Date();

		// ── 1. Resume sleeping steps whose scheduledAt has passed ────
		const sleepingSteps = await stepsCrud.find(
			{
				where: {
					status: "sleeping",
					scheduledAt: { lte: now },
				},
				limit: 100,
			},
			{ accessMode: "system" },
		);

		let resumedCount = 0;
		for (const step of sleepingSteps.docs) {
			try {
				await queue.wfResume.publish({
					instanceId: step.instanceId,
					stepName: step.name,
				});
				resumedCount++;
			} catch (err) {
				logger?.warn?.(
					`Failed to publish resume for step ${step.name} of instance ${step.instanceId}`,
					{ error: err instanceof Error ? err.message : String(err) },
				);
			}
		}

		// ── 2. Time out instances that exceeded their timeout ────────
		const timedOutInstances = await instancesCrud.find(
			{
				where: {
					status: { in: ["running", "suspended", "pending"] },
					timeoutAt: { lte: now },
				},
				limit: 100,
			},
			{ accessMode: "system" },
		);

		let timedOutCount = 0;
		for (const instance of timedOutInstances.docs) {
			try {
				await instancesCrud.updateById(
					{
						id: instance.id,
						data: {
							status: "timed_out",
							error: {
								message: `Workflow timed out at ${now.toISOString()}`,
								code: "WORKFLOW_TIMEOUT",
							},
							completedAt: now,
						},
					},
					{ accessMode: "system" },
				);
				timedOutCount++;
			} catch (err) {
				logger?.warn?.(`Failed to time out instance ${instance.id}`, {
					error: err instanceof Error ? err.message : String(err),
				});
			}
		}

		// ── 3. Cron triggers ────────────────────────────────────────
		let cronTriggered = 0;
		const definitions = (app?.state?.workflows ?? {}) as Record<
			string,
			WorkflowDefinition
		>;

		const windowStart = new Date(
			now.getTime() - POLL_INTERVAL_MINUTES * 60 * 1000,
		);

		for (const [name, def] of Object.entries(definitions)) {
			if (!def.cron) continue;

			try {
				const shouldFire = cronFiredInWindow(def.cron, windowStart, now);
				if (!shouldFire) continue;

				const overlapPolicy: CronOverlapPolicy = def.cronOverlap ?? "skip";

				// Check for existing running instances
				if (overlapPolicy !== "allow") {
					const running = await instancesCrud.find(
						{
							where: {
								name,
								status: { in: ["running", "suspended", "pending"] },
							},
							limit: 1,
						},
						{ accessMode: "system" },
					);

					if (running.docs.length > 0) {
						if (overlapPolicy === "skip") {
							logger?.debug?.(
								`Skipping cron trigger for "${name}" — instance already running`,
							);
							continue;
						}

						if (overlapPolicy === "cancel-previous") {
							for (const runningInstance of running.docs) {
								await instancesCrud.updateById(
									{
										id: runningInstance.id,
										data: {
											status: "cancelled",
											error: {
												message:
													"Cancelled by cron overlap policy (cancel-previous)",
												code: "CRON_OVERLAP_CANCELLED",
											},
											completedAt: now,
										},
									},
									{ accessMode: "system" },
								);
								logger?.debug?.(
									`Cancelled running instance ${runningInstance.id} for cron overlap of "${name}"`,
								);
							}
						}
					}
				}

				// Create and queue the new cron-triggered instance
				let timeoutAt: Date | undefined;
				if (def.timeout) {
					timeoutAt = new Date(now.getTime() + parseDuration(def.timeout));
				}

				const instance = await instancesCrud.create(
					{
						name,
						status: "pending",
						input: {},
						output: null,
						error: null,
						attempt: 0,
						parentInstanceId: null,
						parentStepName: null,
						idempotencyKey: `cron:${name}:${now.toISOString().slice(0, 16)}`,
						timeoutAt: timeoutAt ?? null,
						startedAt: null,
						suspendedAt: null,
						completedAt: null,
					},
					{ accessMode: "system" },
				);

				await queue.wfExecute.publish({
					instanceId: instance.id,
					workflowName: name,
				});

				cronTriggered++;
			} catch (err) {
				logger?.warn?.(`Failed to trigger cron workflow "${name}"`, {
					error: err instanceof Error ? err.message : String(err),
				});
			}
		}

		// ── 4. Retention cleanup ────────────────────────────────────
		let cleanedInstances = 0;
		let cleanedEvents = 0;

		// Collect retention policies from all workflow definitions
		// Use the most aggressive policy across all definitions for global cleanup
		const globalRetention = mergeRetentionPolicies(definitions);

		// Clean completed instances
		if (globalRetention.completedAfter && instancesCrud) {
			const cutoff = new Date(
				now.getTime() - parseDuration(globalRetention.completedAfter),
			);
			cleanedInstances += await cleanupInstances(
				instancesCrud,
				stepsCrud,
				logsCrud,
				"completed",
				cutoff,
				logger,
			);
		}

		// Clean failed instances
		if (globalRetention.failedAfter && instancesCrud) {
			const cutoff = new Date(
				now.getTime() - parseDuration(globalRetention.failedAfter),
			);
			cleanedInstances += await cleanupInstances(
				instancesCrud,
				stepsCrud,
				logsCrud,
				"failed",
				cutoff,
				logger,
			);
		}

		// Clean cancelled instances
		if (globalRetention.cancelledAfter && instancesCrud) {
			const cutoff = new Date(
				now.getTime() - parseDuration(globalRetention.cancelledAfter),
			);
			cleanedInstances += await cleanupInstances(
				instancesCrud,
				stepsCrud,
				logsCrud,
				"cancelled",
				cutoff,
				logger,
			);
		}

		// Clean timed_out instances (uses failedAfter policy)
		if (globalRetention.failedAfter && instancesCrud) {
			const cutoff = new Date(
				now.getTime() - parseDuration(globalRetention.failedAfter),
			);
			cleanedInstances += await cleanupInstances(
				instancesCrud,
				stepsCrud,
				logsCrud,
				"timed_out",
				cutoff,
				logger,
			);
		}

		// Clean old unconsumed events
		if (globalRetention.eventsAfter && eventsCrud) {
			const cutoff = new Date(
				now.getTime() - parseDuration(globalRetention.eventsAfter),
			);
			const oldEvents = await eventsCrud.find(
				{
					where: {
						createdAt: { lte: cutoff },
					},
					limit: 100,
				},
				{ accessMode: "system" },
			);

			for (const event of oldEvents.docs) {
				try {
					await eventsCrud.deleteById?.(
						{ id: event.id },
						{ accessMode: "system" },
					);
					cleanedEvents++;
				} catch {
					// deleteById may not exist — collection CRUD might not expose it
					// In that case, retention for events is a no-op
				}
			}
		}

		// ── Summary ─────────────────────────────────────────────────
		if (
			resumedCount > 0 ||
			timedOutCount > 0 ||
			cronTriggered > 0 ||
			cleanedInstances > 0 ||
			cleanedEvents > 0
		) {
			logger?.info?.(
				`Workflow maintenance: resumed=${resumedCount}, timedOut=${timedOutCount}, cronTriggered=${cronTriggered}, cleaned=${cleanedInstances} instances + ${cleanedEvents} events`,
			);
		}
	},
});

// ── Helpers ─────────────────────────────────────────────────

/**
 * Merge retention policies from all workflow definitions.
 * Uses the shortest duration for each category (most aggressive cleanup).
 */
function mergeRetentionPolicies(
	definitions: Record<string, WorkflowDefinition>,
): RetentionPolicy {
	const result: RetentionPolicy = {};

	for (const def of Object.values(definitions)) {
		if (!def.retention) continue;

		if (def.retention.completedAfter) {
			result.completedAfter = shorterDuration(
				result.completedAfter,
				def.retention.completedAfter,
			);
		}
		if (def.retention.failedAfter) {
			result.failedAfter = shorterDuration(
				result.failedAfter,
				def.retention.failedAfter,
			);
		}
		if (def.retention.cancelledAfter) {
			result.cancelledAfter = shorterDuration(
				result.cancelledAfter,
				def.retention.cancelledAfter,
			);
		}
		if (def.retention.eventsAfter) {
			result.eventsAfter = shorterDuration(
				result.eventsAfter,
				def.retention.eventsAfter,
			);
		}
	}

	return result;
}

/**
 * Return the shorter of two duration strings.
 */
function shorterDuration(a: string | undefined, b: string): string {
	if (!a) return b;
	return parseDuration(a) <= parseDuration(b) ? a : b;
}

/**
 * Delete instances of a given status older than the cutoff date,
 * along with their associated steps and logs.
 */
async function cleanupInstances(
	instancesCrud: CollectionCrud,
	stepsCrud: CollectionCrud,
	logsCrud: CollectionCrud | undefined,
	status: string,
	cutoff: Date,
	logger: any,
): Promise<number> {
	const oldInstances = await instancesCrud.find(
		{
			where: {
				status,
				completedAt: { lte: cutoff },
			},
			limit: 50,
		},
		{ accessMode: "system" },
	);

	let count = 0;
	for (const instance of oldInstances.docs) {
		try {
			// Delete associated steps
			const steps = await stepsCrud.find(
				{
					where: { instanceId: instance.id },
					limit: 10_000,
				},
				{ accessMode: "system" },
			);
			for (const step of steps.docs) {
				try {
					await stepsCrud.deleteById?.(
						{ id: step.id },
						{ accessMode: "system" },
					);
				} catch {
					// deleteById may not exist
				}
			}

			// Delete associated logs
			if (logsCrud) {
				const logs = await logsCrud.find(
					{
						where: { instanceId: instance.id },
						limit: 10_000,
					},
					{ accessMode: "system" },
				);
				for (const log of logs.docs) {
					try {
						await logsCrud.deleteById?.(
							{ id: log.id },
							{ accessMode: "system" },
						);
					} catch {
						// deleteById may not exist
					}
				}
			}

			// Delete the instance
			try {
				await instancesCrud.deleteById?.(
					{ id: instance.id },
					{ accessMode: "system" },
				);
				count++;
			} catch {
				// deleteById may not exist
			}
		} catch (err) {
			logger?.warn?.(`Failed to clean up instance ${instance.id}`, {
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	return count;
}

export default wfMaintenanceJob;
