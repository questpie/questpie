import {
	definePostgresStatement,
	type PostgresParameter,
} from "../../postgres/contract";
import { StaticScheduleFailure } from "./contract";

// Fixed SQL is compiler/runtime-owned; callers supply only parameters.
function statement(
	name: string,
	operation: "SELECT" | "INSERT" | "UPDATE" | "DELETE",
	text: string,
	parameterCount: number,
	maximum: number,
) {
	return definePostgresStatement<
		readonly PostgresParameter[],
		readonly (readonly unknown[])[],
		"SELECT" | "INSERT" | "UPDATE" | "DELETE"
	>({
		name: `durable.schedule.${name}`,
		operation,
		text,
		parameterCount,
		parameters: (parameters) => parameters,
		decode(result) {
			if (
				result.command !== operation ||
				result.rowCount === null ||
				result.rowCount < 0 ||
				result.rows.length > maximum ||
				(operation === "SELECT" && result.rowCount !== result.rows.length)
			)
				throw new StaticScheduleFailure("SCHEDULE_STATE_INVALID");
			return result.rows;
		},
	});
}

export const headCreate = statement(
	"head.create",
	"INSERT",
	`INSERT INTO questpie_internal.schedule_heads(application_name, revision) VALUES ($1, 0) ON CONFLICT DO NOTHING`,
	1,
	0,
);
export const headLock = statement(
	"head.lock",
	"SELECT",
	`SELECT revision::text, target_digest, activated_at FROM questpie_internal.schedule_heads WHERE application_name = $1 FOR UPDATE`,
	1,
	1,
);
export const clockRead = statement(
	"clock",
	"SELECT",
	`SELECT pg_catalog.clock_timestamp()`,
	0,
	1,
);
export const activationRead = statement(
	"activation.read",
	"SELECT",
	`SELECT expected_revision::text, target_digest, accepted_revision::text, activated_at FROM questpie_internal.schedule_activations WHERE application_name = $1 AND request_identity = $2`,
	2,
	1,
);
export const catalogRead = statement(
	"catalog.read",
	"SELECT",
	`SELECT canonical_json FROM questpie_internal.schedule_catalogs WHERE application_name = $1 AND target_digest = $2`,
	2,
	1,
);
export const catalogInsert = statement(
	"catalog.insert",
	"INSERT",
	`INSERT INTO questpie_internal.schedule_catalogs(application_name, target_digest, canonical_json) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
	3,
	0,
);
export const frontierRead = statement(
	"frontier.read",
	"SELECT",
	`SELECT job_identity, program_digest, frontier_minute FROM questpie_internal.schedule_frontiers WHERE application_name = $1 ORDER BY job_identity`,
	1,
	64,
);
export const frontiersDelete = statement(
	"frontier.delete",
	"DELETE",
	`DELETE FROM questpie_internal.schedule_frontiers WHERE application_name = $1`,
	1,
	0,
);
export const frontierInsert = statement(
	"frontier.insert",
	"INSERT",
	`INSERT INTO questpie_internal.schedule_frontiers(application_name, job_identity, program_digest, frontier_minute) VALUES ($1, $2, $3, $4)`,
	4,
	0,
);
export const headUpdate = statement(
	"head.update",
	"UPDATE",
	`UPDATE questpie_internal.schedule_heads SET revision = $2, target_digest = $3, activated_at = $4 WHERE application_name = $1`,
	4,
	0,
);
export const activationInsert = statement(
	"activation.insert",
	"INSERT",
	`INSERT INTO questpie_internal.schedule_activations(application_name, request_identity, expected_revision, target_digest, accepted_revision, activated_at) VALUES ($1, $2, $3, $4, $5, $6)`,
	6,
	0,
);
export const tickRead = statement(
	"tick.read",
	"SELECT",
	`SELECT run_id::text FROM questpie_internal.schedule_ticks WHERE application_name = $1 AND job_identity = $2 AND scheduled_minute = $3`,
	3,
	1,
);
export const tickInsert = statement(
	"tick.insert",
	"INSERT",
	`INSERT INTO questpie_internal.schedule_ticks(application_name, job_identity, scheduled_minute, accepted_revision, program_digest, run_id, accepted_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
	7,
	0,
);
export const frontierUpdate = statement(
	"frontier.update",
	"UPDATE",
	`UPDATE questpie_internal.schedule_frontiers SET frontier_minute = GREATEST(frontier_minute, $3) WHERE application_name = $1 AND job_identity = $2`,
	3,
	0,
);
