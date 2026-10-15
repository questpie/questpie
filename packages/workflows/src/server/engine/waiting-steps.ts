import type { CollectionCrud } from "../client.js";
import type { WorkflowStepRecord } from "../workflow/types.js";
import { getContainmentMatchHashes } from "./match-hash.js";

/** Shared forward lookup for client, HTTP and workflow-originated events. */
export async function findWaitingSteps(
	steps: Pick<CollectionCrud<WorkflowStepRecord>, "find">,
	eventName: string,
	matchData?: Record<string, unknown>,
) {
	const hashes = getContainmentMatchHashes(matchData);
	const where = {
		type: "waitForEvent",
		status: "waiting",
		eventName,
		...(hashes
			? {
					OR: [
						{ matchHash: { in: hashes } },
						// Pre-hash records remain eligible until they finish.
						{ matchHash: { isNull: true } },
					],
				}
			: {}),
	};
	const waiters: Array<{
		instanceId: string;
		stepName: string;
		matchCriteria: Record<string, unknown> | null;
	}> = [];
	let after: string | undefined;
	for (;;) {
		const result = await steps.find(
			{
				where: { ...where, ...(after ? { id: { gt: after } } : {}) },
				limit: 1000,
				orderBy: { id: "asc" },
			},
			{ accessMode: "system" },
		);
		waiters.push(
			...result.docs.map((step) => ({
				instanceId: step.instanceId,
				stepName: step.name,
				matchCriteria:
					typeof step.matchCriteria === "object" &&
					step.matchCriteria !== null &&
					!Array.isArray(step.matchCriteria)
						? (step.matchCriteria as Record<string, unknown>)
						: null,
			})),
		);
		if (result.docs.length < 1000) return waiters;
		after = result.docs[result.docs.length - 1]!.id;
	}
}
