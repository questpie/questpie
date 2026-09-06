/** Candidate ADR-0043 history retains receipt identity and digest, never a second result. */
export const internalProtocolV9CheckpointSql = `CREATE TABLE questpie_internal.mutation_checkpoints (
  application_name text NOT NULL,
  run_id uuid NOT NULL,
  ordinal smallint NOT NULL,
  checkpoint_name text NOT NULL,
  operation_name text NOT NULL,
  call_id text NOT NULL,
  command_digest text NOT NULL,
  input_digest text NOT NULL,
  contract_digest text NOT NULL,
  runtime_graph_digest text NOT NULL,
  tenant_id text NOT NULL,
  principal_kind text NOT NULL,
  principal_id text NOT NULL,
  state text NOT NULL,
  receipt_transaction_id xid8,
  receipt_result_digest text,
  PRIMARY KEY (application_name, run_id, ordinal),
  UNIQUE (application_name, run_id, checkpoint_name),
  FOREIGN KEY (application_name, run_id) REFERENCES questpie_internal.durable_runs(application_name, run_id) ON DELETE CASCADE,
  CONSTRAINT checkpoint_ordinal_bounded CHECK (ordinal BETWEEN 1 AND 64),
  CONSTRAINT checkpoint_name_bounded CHECK (checkpoint_name ~ '^[A-Za-z0-9_-]{1,64}$'),
  CONSTRAINT checkpoint_call_bounded CHECK (length(call_id) BETWEEN 1 AND 256),
  CONSTRAINT checkpoint_command_digest CHECK (command_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT checkpoint_input_digest CHECK (input_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT checkpoint_contract_digest CHECK (contract_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT checkpoint_runtime_graph_digest CHECK (runtime_graph_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT checkpoint_result_digest CHECK (receipt_result_digest IS NULL OR receipt_result_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT checkpoint_principal_kind CHECK (principal_kind IN ('anonymous', 'service', 'user')),
  CONSTRAINT checkpoint_state CHECK (state IN ('reserved', 'completed')),
  CONSTRAINT checkpoint_receipt_shape CHECK (
    (state = 'reserved' AND receipt_transaction_id IS NULL AND receipt_result_digest IS NULL)
    OR (state = 'completed' AND receipt_transaction_id IS NOT NULL AND receipt_result_digest IS NOT NULL)
  )
);
ALTER TABLE questpie_internal.durable_runs DROP CONSTRAINT durable_run_failure_code_known;
ALTER TABLE questpie_internal.durable_runs ADD CONSTRAINT durable_run_failure_code_known CHECK (
  failure_code IS NULL OR failure_code IN (
    'CHECKPOINT_INVALID', 'EFFECT_AMBIGUOUS', 'EFFECT_CONFLICT', 'HANDLER_FAILED', 'REACTION_ERROR',
    'RESOURCE_LIMIT', 'RETRY_EXHAUSTED', 'RUN_AS_DENIED', 'VALIDATION_FAILED'
  )
);
ALTER TABLE questpie_internal.durable_run_events DROP CONSTRAINT durable_event_error_code_known;
ALTER TABLE questpie_internal.durable_run_events ADD CONSTRAINT durable_event_error_code_known CHECK (
  error_code IS NULL OR error_code IN (
    'CHECKPOINT_INVALID', 'EFFECT_AMBIGUOUS', 'EFFECT_CONFLICT', 'HANDLER_FAILED', 'REACTION_ERROR',
    'RESOURCE_LIMIT', 'RETRY_EXHAUSTED', 'RUN_AS_DENIED', 'VALIDATION_FAILED'
  )
);
`;
