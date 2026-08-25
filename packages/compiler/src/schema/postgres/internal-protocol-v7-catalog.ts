/** Generated from a live PostgreSQL catalog after applying `internalProtocolV7Sql`. */

import { internalProtocolV7ConstraintsA } from "./internal-protocol-v7-catalog-constraints-a";
import { internalProtocolV7ConstraintsB } from "./internal-protocol-v7-catalog-constraints-b";

export { internalProtocolV7Columns } from "./internal-protocol-v7-catalog-columns";
export { internalProtocolV7Indexes } from "./internal-protocol-v7-catalog-indexes";

export const internalProtocolV7Tables = [
	"application_bindings",
	"change_ledger",
	"durable_attempts",
	"durable_cancellations",
	"durable_dispatches",
	"durable_effects",
	"durable_maintenance_commands",
	"durable_run_events",
	"durable_runs",
	"mutation_call_receipts",
	"observed_dependency_plans",
	"processed_change_facts",
	"protocol",
	"realtime_binding_generations",
	"realtime_scope_attachments",
	"realtime_watch_bindings",
	"reconciliation_consumers",
	"retained_live_query_results",
	"schema_migration_receipts",
	"seed_attempt_events",
	"seed_receipts",
] as const;

export const internalProtocolV7ReplacedConstraints = [] as const;

export const internalProtocolV7Constraints = [
	...internalProtocolV7ConstraintsA,
	...internalProtocolV7ConstraintsB,
] as const;
