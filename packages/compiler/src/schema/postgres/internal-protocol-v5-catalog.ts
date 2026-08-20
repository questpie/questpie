/** Generated from a live PostgreSQL catalog after applying `internalProtocolV5Sql`. */

export const internalProtocolV5Tables = [] as const;

export const internalProtocolV5ReplacedConstraints = [
	[
		"durable_maintenance_commands",
		"durable_command_rejection_known",
		"c",
		"CHECK (rejection_code IS NULL OR (rejection_code = ANY (ARRAY['ALREADY_REQUESTED'::text, 'ATTEMPTS_EXHAUSTED'::text, 'NOT_AMBIGUOUS'::text, 'RUN_IS_TERMINAL'::text, 'RUN_NOT_FAILED'::text, 'VERSION_MISMATCH'::text])))",
	],
] as const;

export const internalProtocolV5Columns = [
	["durable_maintenance_commands", "reason", "text", false],
] as const;

export const internalProtocolV5Constraints = [
	[
		"durable_maintenance_commands",
		"durable_command_reason_bounded",
		"c",
		"CHECK (reason IS NULL OR length(reason) >= 1 AND length(reason) <= 256)",
	],
	[
		"durable_maintenance_commands",
		"durable_command_rejection_known",
		"c",
		"CHECK (rejection_code IS NULL OR (rejection_code = ANY (ARRAY['ALREADY_REQUESTED'::text, 'ATTEMPTS_EXHAUSTED'::text, 'AUTHORITY_DENIED'::text, 'NOT_AMBIGUOUS'::text, 'REASON_INVALID'::text, 'RUN_IS_TERMINAL'::text, 'RUN_NOT_FAILED'::text, 'VERSION_MISMATCH'::text])))",
	],
] as const;

export const internalProtocolV5Indexes = [] as const;
