/**
 * questpie.internal.v4 adds the shared durable kernel: one run state machine,
 * physical attempts with an opaque lease fence, an append-only run history,
 * a stable effect ledger, durable cancellation, and a maintenance audit.
 *
 * BETA-06 recorded an origin-unique dispatch whose state could only ever be
 * `pending`. v4 widens that state so the kernel can accept it, and makes one
 * run per dispatch structural through `durable_run_dispatch_unique`.
 */
export const internalProtocolV4Sql = `ALTER TABLE questpie_internal.pending_reaction_intents
  DROP CONSTRAINT reaction_intent_state_pending;
ALTER TABLE questpie_internal.pending_reaction_intents
  ADD CONSTRAINT reaction_intent_state_known CHECK (state IN ('accepted', 'pending'));

CREATE TABLE questpie_internal.durable_runs (
  application_name text NOT NULL,
  run_id uuid NOT NULL,
  dispatch_id uuid NOT NULL,
  resource_identity text NOT NULL,
  tenant_id text NOT NULL,
  principal_kind text NOT NULL,
  principal_id text NOT NULL,
  run_as text NOT NULL,
  context_input_bytes bytea NOT NULL,
  payload_bytes bytea NOT NULL,
  retry_bytes bytea NOT NULL,
  runtime_build_digest text NOT NULL,
  executable_digest text NOT NULL,
  causation_kind text NOT NULL,
  causation_id text NOT NULL,
  correlation_id text NOT NULL,
  state text NOT NULL,
  attempt_count integer NOT NULL,
  current_attempt_id uuid,
  lease_token_digest text,
  lease_expires_at timestamptz,
  available_at timestamptz NOT NULL,
  horizon_at timestamptz NOT NULL,
  cancellation_requested boolean NOT NULL,
  event_sequence integer NOT NULL,
  result_bytes bytea,
  failure_code text,
  dead_letter boolean NOT NULL,
  accepted_at timestamptz NOT NULL,
  terminal_at timestamptz,
  PRIMARY KEY (application_name, run_id),
  CONSTRAINT durable_run_dispatch_unique UNIQUE (application_name, dispatch_id),
  FOREIGN KEY (application_name, dispatch_id)
    REFERENCES questpie_internal.pending_reaction_intents (application_name, record_id),
  CONSTRAINT durable_run_state_known CHECK (
    state IN ('cancelled', 'delayed', 'failed', 'ready', 'running', 'succeeded')
  ),
  CONSTRAINT durable_run_principal_kind_known CHECK (
    principal_kind IN ('anonymous', 'service', 'user')
  ),
  CONSTRAINT durable_run_as_known CHECK (run_as = 'caller'),
  CONSTRAINT durable_run_causation_kind_known CHECK (causation_kind = 'mutationDispatch'),
  CONSTRAINT durable_run_attempt_count_bounded CHECK (attempt_count BETWEEN 0 AND 8),
  CONSTRAINT durable_run_event_sequence_bounded CHECK (event_sequence BETWEEN 0 AND 1024),
  CONSTRAINT durable_run_payload_bytes_bounded CHECK (octet_length(payload_bytes) <= 262144),
  CONSTRAINT durable_run_context_bytes_bounded CHECK (octet_length(context_input_bytes) <= 262144),
  CONSTRAINT durable_run_retry_bytes_bounded CHECK (octet_length(retry_bytes) <= 4096),
  CONSTRAINT durable_run_result_bytes_bounded CHECK (
    result_bytes IS NULL OR octet_length(result_bytes) <= 262144
  ),
  CONSTRAINT durable_run_lease_shape CHECK (
    (state = 'running'
      AND current_attempt_id IS NOT NULL
      AND lease_token_digest IS NOT NULL
      AND lease_expires_at IS NOT NULL)
    OR (state <> 'running'
      AND current_attempt_id IS NULL
      AND lease_token_digest IS NULL
      AND lease_expires_at IS NULL)
  ),
  CONSTRAINT durable_run_lease_digest_sha256 CHECK (
    lease_token_digest IS NULL OR lease_token_digest ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT durable_run_terminal_shape CHECK (
    (state IN ('cancelled', 'failed', 'succeeded') AND terminal_at IS NOT NULL)
    OR (state IN ('delayed', 'ready', 'running') AND terminal_at IS NULL)
  ),
  CONSTRAINT durable_run_result_shape CHECK (
    (state = 'succeeded' AND result_bytes IS NOT NULL AND failure_code IS NULL)
    OR (state <> 'succeeded' AND result_bytes IS NULL)
  ),
  CONSTRAINT durable_run_failure_shape CHECK (
    (state = 'failed' AND failure_code IS NOT NULL)
    OR (state <> 'failed' AND NOT dead_letter)
  ),
  CONSTRAINT durable_run_failure_code_known CHECK (
    failure_code IS NULL OR failure_code IN (
      'EFFECT_AMBIGUOUS', 'EFFECT_CONFLICT', 'HANDLER_FAILED', 'REACTION_ERROR',
      'RESOURCE_LIMIT', 'RETRY_EXHAUSTED', 'RUN_AS_DENIED', 'VALIDATION_FAILED'
    )
  )
);
CREATE INDEX durable_runs_claim_idx ON questpie_internal.durable_runs
  (application_name, state, available_at, run_id);
CREATE INDEX durable_runs_lease_idx ON questpie_internal.durable_runs
  (application_name, state, lease_expires_at);
CREATE INDEX durable_runs_resource_idx ON questpie_internal.durable_runs
  (application_name, resource_identity, state);

CREATE TABLE questpie_internal.durable_attempts (
  application_name text NOT NULL,
  attempt_id uuid NOT NULL,
  run_id uuid NOT NULL,
  attempt_number integer NOT NULL,
  worker_id text NOT NULL,
  lease_token_digest text NOT NULL,
  lease_expires_at timestamptz NOT NULL,
  deadline_at timestamptz NOT NULL,
  started_at timestamptz NOT NULL,
  heartbeat_at timestamptz NOT NULL,
  outcome text,
  failure_code text,
  PRIMARY KEY (application_name, attempt_id),
  CONSTRAINT durable_attempt_number_unique UNIQUE (application_name, run_id, attempt_number),
  FOREIGN KEY (application_name, run_id)
    REFERENCES questpie_internal.durable_runs (application_name, run_id) ON DELETE CASCADE,
  CONSTRAINT durable_attempt_number_bounded CHECK (attempt_number BETWEEN 1 AND 8),
  CONSTRAINT durable_attempt_worker_bounded CHECK (length(worker_id) BETWEEN 1 AND 128),
  CONSTRAINT durable_attempt_lease_digest_sha256 CHECK (lease_token_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT durable_attempt_outcome_known CHECK (
    outcome IS NULL OR outcome IN ('cancelled', 'failed', 'leaseSuperseded', 'succeeded')
  ),
  CONSTRAINT durable_attempt_failure_shape CHECK (
    failure_code IS NULL OR outcome = 'failed'
  )
);

CREATE TABLE questpie_internal.durable_run_events (
  application_name text NOT NULL,
  run_id uuid NOT NULL,
  sequence integer NOT NULL,
  occurred_at timestamptz NOT NULL,
  resource_identity text NOT NULL,
  dispatch_id uuid NOT NULL,
  attempt_id uuid,
  lease_token_digest text,
  causation_id text NOT NULL,
  correlation_id text NOT NULL,
  kind text NOT NULL,
  error_code text,
  PRIMARY KEY (application_name, run_id, sequence),
  FOREIGN KEY (application_name, run_id)
    REFERENCES questpie_internal.durable_runs (application_name, run_id),
  CONSTRAINT durable_event_sequence_bounded CHECK (sequence BETWEEN 1 AND 1024),
  CONSTRAINT durable_event_error_code_known CHECK (
    error_code IS NULL OR error_code IN (
      'EFFECT_AMBIGUOUS', 'EFFECT_CONFLICT', 'HANDLER_FAILED', 'REACTION_ERROR',
      'RESOURCE_LIMIT', 'RETRY_EXHAUSTED', 'RUN_AS_DENIED', 'VALIDATION_FAILED'
    )
  ),
  CONSTRAINT durable_event_lease_digest_sha256 CHECK (
    lease_token_digest IS NULL OR lease_token_digest ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT durable_event_kind_known CHECK (
    kind IN ('accepted', 'ambiguityAcknowledged', 'attemptStarted', 'cancellationRequested',
             'cancelled', 'effectAmbiguous', 'effectSettled', 'failed', 'leaseSuperseded',
             'retryScheduled', 'succeeded')
  )
);

CREATE TABLE questpie_internal.durable_effects (
  application_name text NOT NULL,
  run_id uuid NOT NULL,
  effect_name text NOT NULL,
  effect_id uuid NOT NULL,
  input_digest text NOT NULL,
  status text NOT NULL,
  receipt text,
  reserved_attempt_id uuid NOT NULL,
  settled_attempt_id uuid,
  reserved_at timestamptz NOT NULL,
  settled_at timestamptz,
  PRIMARY KEY (application_name, run_id, effect_name),
  CONSTRAINT durable_effect_identity_unique UNIQUE (application_name, effect_id),
  FOREIGN KEY (application_name, run_id)
    REFERENCES questpie_internal.durable_runs (application_name, run_id) ON DELETE CASCADE,
  CONSTRAINT durable_effect_name_bounded CHECK (length(effect_name) BETWEEN 1 AND 63),
  CONSTRAINT durable_effect_input_digest_sha256 CHECK (input_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT durable_effect_receipt_bounded CHECK (receipt IS NULL OR length(receipt) <= 256),
  CONSTRAINT durable_effect_status_known CHECK (
    status IN ('acknowledged', 'ambiguous', 'pending', 'succeeded')
  ),
  CONSTRAINT durable_effect_settled_shape CHECK (
    (status = 'succeeded' AND receipt IS NOT NULL AND settled_attempt_id IS NOT NULL AND settled_at IS NOT NULL)
    OR (status = 'acknowledged' AND receipt IS NULL AND settled_at IS NOT NULL)
    OR (status IN ('ambiguous', 'pending') AND receipt IS NULL AND settled_at IS NULL)
  )
);

CREATE TABLE questpie_internal.durable_cancellations (
  application_name text NOT NULL,
  cancellation_id uuid NOT NULL,
  run_id uuid NOT NULL,
  requested_by_kind text NOT NULL,
  requested_by_id text NOT NULL,
  reason text NOT NULL,
  requested_at timestamptz NOT NULL,
  PRIMARY KEY (application_name, cancellation_id),
  CONSTRAINT durable_cancellation_run_unique UNIQUE (application_name, run_id),
  FOREIGN KEY (application_name, run_id)
    REFERENCES questpie_internal.durable_runs (application_name, run_id) ON DELETE CASCADE,
  CONSTRAINT durable_cancellation_actor_kind_known CHECK (
    requested_by_kind IN ('anonymous', 'service', 'user')
  ),
  CONSTRAINT durable_cancellation_reason_bounded CHECK (length(reason) BETWEEN 1 AND 256)
);

CREATE TABLE questpie_internal.durable_maintenance_commands (
  application_name text NOT NULL,
  command_id uuid NOT NULL,
  run_id uuid NOT NULL,
  command text NOT NULL,
  outcome text NOT NULL,
  rejection_code text,
  actor_kind text NOT NULL,
  actor_id text NOT NULL,
  state_before text NOT NULL,
  state_after text NOT NULL,
  requested_at timestamptz NOT NULL,
  PRIMARY KEY (application_name, command_id),
  FOREIGN KEY (application_name, run_id)
    REFERENCES questpie_internal.durable_runs (application_name, run_id) ON DELETE CASCADE,
  CONSTRAINT durable_command_known CHECK (
    command IN ('acknowledgeAmbiguity', 'cancelRun', 'retryRun')
  ),
  CONSTRAINT durable_command_outcome_known CHECK (outcome IN ('applied', 'rejected')),
  CONSTRAINT durable_command_outcome_shape CHECK (
    (outcome = 'applied' AND rejection_code IS NULL)
    OR (outcome = 'rejected' AND rejection_code IS NOT NULL)
  ),
  CONSTRAINT durable_command_actor_kind_known CHECK (
    actor_kind IN ('anonymous', 'service', 'user')
  )
);
CREATE INDEX durable_maintenance_commands_run_idx ON questpie_internal.durable_maintenance_commands
  (application_name, run_id, requested_at);

CREATE FUNCTION questpie_internal.guard_durable_kernel_write()
RETURNS trigger LANGUAGE plpgsql
SECURITY DEFINER SET search_path = pg_catalog, questpie_internal AS $$
BEGIN
  IF current_setting('questpie.durable_kernel', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'questpie durable state is written only by the durable kernel'
      USING ERRCODE = '42501';
  END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION questpie_internal.guard_durable_append_only()
RETURNS trigger LANGUAGE plpgsql
SECURITY DEFINER SET search_path = pg_catalog, questpie_internal AS $$
BEGIN
  RAISE EXCEPTION 'questpie durable run history is append only'
    USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER durable_dispatch_kernel_guard
BEFORE INSERT OR UPDATE OR DELETE ON questpie_internal.pending_reaction_intents
FOR EACH STATEMENT EXECUTE FUNCTION questpie_internal.guard_durable_kernel_write();

CREATE TRIGGER durable_runs_kernel_guard
BEFORE INSERT OR UPDATE OR DELETE ON questpie_internal.durable_runs
FOR EACH STATEMENT EXECUTE FUNCTION questpie_internal.guard_durable_kernel_write();

CREATE TRIGGER durable_attempts_kernel_guard
BEFORE INSERT OR UPDATE OR DELETE ON questpie_internal.durable_attempts
FOR EACH STATEMENT EXECUTE FUNCTION questpie_internal.guard_durable_kernel_write();

CREATE TRIGGER durable_effects_kernel_guard
BEFORE INSERT OR UPDATE OR DELETE ON questpie_internal.durable_effects
FOR EACH STATEMENT EXECUTE FUNCTION questpie_internal.guard_durable_kernel_write();

CREATE TRIGGER durable_cancellations_kernel_guard
BEFORE INSERT OR UPDATE OR DELETE ON questpie_internal.durable_cancellations
FOR EACH STATEMENT EXECUTE FUNCTION questpie_internal.guard_durable_kernel_write();

CREATE TRIGGER durable_maintenance_commands_kernel_guard
BEFORE INSERT OR UPDATE OR DELETE ON questpie_internal.durable_maintenance_commands
FOR EACH STATEMENT EXECUTE FUNCTION questpie_internal.guard_durable_kernel_write();

CREATE TRIGGER durable_run_events_kernel_guard
BEFORE INSERT ON questpie_internal.durable_run_events
FOR EACH STATEMENT EXECUTE FUNCTION questpie_internal.guard_durable_kernel_write();

CREATE TRIGGER durable_run_events_append_only
BEFORE UPDATE OR DELETE OR TRUNCATE ON questpie_internal.durable_run_events
FOR EACH STATEMENT EXECUTE FUNCTION questpie_internal.guard_durable_append_only();

REVOKE ALL ON ALL TABLES IN SCHEMA questpie_internal FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA questpie_internal FROM PUBLIC;
REVOKE ALL ON FUNCTION questpie_internal.guard_durable_kernel_write() FROM PUBLIC;
REVOKE ALL ON FUNCTION questpie_internal.guard_durable_append_only() FROM PUBLIC;
`;
