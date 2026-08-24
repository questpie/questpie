import { principal as principalKernel, type Principal } from "questpie";

import type { PostgresTransactionRunner } from "../postgres";
import type {
	DurableMaintenance,
	DurableMaintenanceAuthority,
} from "./maintenance-contract";
import { createPostgresDatabaseDurableMaintenance } from "./postgres-database-maintenance";
import type { DurableActor } from "./rows";

export function createPostgresDatabaseDurablePrincipalMaintenance(
	input: Readonly<{
		database: PostgresTransactionRunner;
		application: string;
		authorize: DurableMaintenanceAuthority;
		randomUUID?: () => string;
	}>,
): DurableMaintenance {
	const maintenance = createPostgresDatabaseDurableMaintenance(input);
	const actorOf = (actor: Principal): DurableActor => {
		if (!principalKernel.is(actor))
			throw new TypeError("durable maintenance requires a trusted Principal");
		return Object.freeze({ kind: actor.kind, id: actor.id });
	};
	return Object.freeze<DurableMaintenance>({
		cancelRun: (request) =>
			maintenance.cancelRun({ ...request, actor: actorOf(request.actor) }),
		retryRun: (request) =>
			maintenance.retryRun({ ...request, actor: actorOf(request.actor) }),
		acknowledgeAmbiguity: (request) =>
			maintenance.acknowledgeAmbiguity({
				...request,
				actor: actorOf(request.actor),
			}),
		audit: maintenance.audit,
	});
}
