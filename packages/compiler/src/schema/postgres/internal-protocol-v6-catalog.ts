/** Generated from a live PostgreSQL catalog after applying `internalProtocolV6Sql`. */

export const internalProtocolV6Tables = [] as const;

export const internalProtocolV6ReplacedConstraints = [
	[
		"durable_run_events",
		"durable_event_kind_known",
		"c",
		"CHECK (kind = ANY (ARRAY['accepted'::text, 'ambiguityAcknowledged'::text, 'attemptStarted'::text, 'cancellationRequested'::text, 'cancelled'::text, 'effectAmbiguous'::text, 'effectSettled'::text, 'failed'::text, 'leaseSuperseded'::text, 'retryScheduled'::text, 'succeeded'::text]))",
	],
] as const;

export const internalProtocolV6Columns = [] as const;

export const internalProtocolV6Constraints = [
	[
		"durable_run_events",
		"durable_event_kind_known",
		"c",
		"CHECK (kind = ANY (ARRAY['accepted'::text, 'ambiguityAcknowledged'::text, 'attemptStarted'::text, 'cancellationRequested'::text, 'cancelled'::text, 'effectAmbiguous'::text, 'effectSettled'::text, 'failed'::text, 'leaseSuperseded'::text, 'retryRequested'::text, 'retryScheduled'::text, 'succeeded'::text]))",
	],
] as const;

export const internalProtocolV6Indexes = [] as const;
