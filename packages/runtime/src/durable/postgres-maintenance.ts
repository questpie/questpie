import type { SQL } from "bun";
import { principal as principalKernel, type Principal } from "questpie";

import type { PostgresTransactionRunner } from "../postgres/contract";
import type {
	DurableMaintenance,
	DurableMaintenanceAuthority,
} from "./maintenance-contract";
import { createPostgresDatabaseDurableMaintenance } from "./postgres-database-maintenance";
import type { DurableActor } from "./rows";

export type {
	DurableMaintenance,
	DurableMaintenanceAuditEntry,
	DurableMaintenanceAuthority,
	DurableMaintenanceCommand,
	DurableMaintenanceOutcome,
	DurableMaintenanceRejection,
} from "./maintenance-contract";

export function createPostgresDurableMaintenance(
	input: Readonly<{
		sql: SQL;
		application: string;
		authorize: DurableMaintenanceAuthority;
	}>,
): DurableMaintenance {
	let compatibleDatabase: Promise<PostgresTransactionRunner> | undefined;
	const database = Object.freeze<PostgresTransactionRunner>({
		async transaction(request) {
			compatibleDatabase ??= import("./postgres-bun-compatibility").then(
				({ createBunDurablePostgresTransactionRunner }) =>
					createBunDurablePostgresTransactionRunner(input.sql),
			);
			return (await compatibleDatabase).transaction(request);
		},
	});
	const maintenance = createPostgresDatabaseDurableMaintenance({
		database,
		application: input.application,
		authorize: input.authorize,
	});
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
