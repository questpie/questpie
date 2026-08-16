import {
	decodeObservedLiveQueryPlan,
	matchesObservedLiveQueryPlan,
} from "./dependency-plan";
import type { ChangeLedgerFactV1 } from "./postgres";

type Row = Readonly<Record<string, unknown>>;

export type PostgresLiveQueryInvalidationEffect = Readonly<{
	consumer: string;
	apply(
		input: Readonly<{
			application: string;
			facts: readonly ChangeLedgerFactV1[];
			execute(
				statement: string,
				parameters?: readonly unknown[],
			): Promise<readonly Row[]>;
		}>,
	): Promise<void>;
}>;

const digestPattern = /^[0-9a-f]{64}$/;

function rowText(value: unknown, path: string): string {
	if (typeof value !== "string" || value.length === 0)
		throw new TypeError(`${path} must be nonempty text`);
	return value;
}

function rowBytes(value: unknown): Uint8Array {
	if (!(value instanceof Uint8Array))
		throw new TypeError("observed Live Query plan bytes are invalid");
	return value;
}

export function createPostgresLiveQueryInvalidationEffect(
	input: Readonly<{
		deploymentDigest: string;
		fanoutPerBatch: number;
	}>,
): PostgresLiveQueryInvalidationEffect {
	if (!digestPattern.test(input.deploymentDigest))
		throw new TypeError("Live Query deployment digest must be SHA-256");
	if (!Number.isSafeInteger(input.fanoutPerBatch) || input.fanoutPerBatch <= 0)
		throw new TypeError("Live Query fanout batch limit must be positive");
	const consumer = `realtime:deployment:${input.deploymentDigest}`;
	return Object.freeze({
		consumer,
		async apply(reconciliation) {
			if (reconciliation.facts.length === 0) return;
			const rows = await reconciliation.execute(
				`SELECT plan.scope_identity AS "scopeIdentity",
       plan.binding_identity AS "bindingIdentity",
       plan.query_identity AS "queryIdentity",
       plan.plan_digest AS "planDigest",
       plan.plan_bytes AS "planBytes"
FROM questpie_internal.observed_dependency_plans AS plan
JOIN questpie_internal.realtime_watch_bindings AS watch
  ON watch.application_name = plan.application_name
 AND watch.scope_identity = plan.scope_identity
 AND watch.binding_identity = plan.binding_identity
 AND watch.deployment_digest = plan.deployment_digest
JOIN questpie_internal.realtime_scope_attachments AS scope
  ON scope.application_name = watch.application_name
 AND scope.scope_identity = watch.scope_identity
 AND scope.deployment_digest = watch.deployment_digest
WHERE plan.application_name = $1
  AND plan.deployment_digest = $2
  AND watch.state = 'open'
  AND scope.state = 'open'
  AND scope.expires_at > pg_catalog.transaction_timestamp()
ORDER BY plan.scope_identity, plan.binding_identity
FOR UPDATE OF watch`,
				[reconciliation.application, input.deploymentDigest],
			);
			const dirty: Array<
				Readonly<{
					scopeIdentity: string;
					bindingIdentity: string;
					increment: number;
				}>
			> = [];
			for (const [index, row] of rows.entries()) {
				const scopeIdentity = rowText(
					row.scopeIdentity,
					`observed Live Query plan ${index} scope identity`,
				);
				const bindingIdentity = rowText(
					row.bindingIdentity,
					`observed Live Query plan ${index} binding identity`,
				);
				const plan = decodeObservedLiveQueryPlan({
					bytes: rowBytes(row.planBytes),
					bytesDigest: rowText(
						row.planDigest,
						`observed Live Query plan ${index} bytes digest`,
					),
					queryIdentity: rowText(
						row.queryIdentity,
						`observed Live Query plan ${index} Query identity`,
					),
				});
				const increment = reconciliation.facts.reduce(
					(count, fact) =>
						count + (matchesObservedLiveQueryPlan(plan, fact) ? 1 : 0),
					0,
				);
				if (increment === 0) continue;
				dirty.push(
					Object.freeze({ scopeIdentity, bindingIdentity, increment }),
				);
			}
			for (
				let offset = 0;
				offset < dirty.length;
				offset += input.fanoutPerBatch
			) {
				const batch = dirty.slice(offset, offset + input.fanoutPerBatch);
				const values = batch
					.map((_, index) => {
						const parameter = 3 + index * 3;
						return `($${parameter}::text, $${parameter + 1}::text, $${parameter + 2}::bigint)`;
					})
					.join(", ");
				await reconciliation.execute(
					`UPDATE questpie_internal.realtime_watch_bindings AS watch
SET invalidation_generation = watch.invalidation_generation + dirty.increment,
    invalidated_at = pg_catalog.transaction_timestamp()
					FROM (VALUES ${values}) AS dirty(scope_identity, binding_identity, increment)
WHERE watch.application_name = $1
  AND watch.deployment_digest = $2
  AND watch.scope_identity = dirty.scope_identity
  AND watch.binding_identity = dirty.binding_identity
  AND watch.state = 'open'`,
					[
						reconciliation.application,
						input.deploymentDigest,
						...batch.flatMap((candidate) => [
							candidate.scopeIdentity,
							candidate.bindingIdentity,
							candidate.increment,
						]),
					],
				);
			}
		},
	});
}
