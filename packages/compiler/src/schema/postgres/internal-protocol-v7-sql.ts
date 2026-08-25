/**
 * Protocol v7 gives Reaction and Job one physical durable-dispatch ledger while
 * preserving their distinct Resource identities. Existing Reaction rows become
 * version-1 Reaction dispatches during the upgrade.
 */
export const internalProtocolV7Sql = `
ALTER TABLE questpie_internal.pending_reaction_intents
  RENAME TO durable_dispatches;
ALTER TABLE questpie_internal.durable_dispatches
  RENAME COLUMN reaction_name TO resource_identity;

ALTER TABLE questpie_internal.durable_dispatches
  ADD COLUMN resource_kind text NOT NULL DEFAULT 'reaction';
ALTER TABLE questpie_internal.durable_dispatches
  ALTER COLUMN resource_kind DROP DEFAULT;
ALTER TABLE questpie_internal.durable_dispatches
  ADD CONSTRAINT durable_dispatch_resource_kind_known
  CHECK (resource_kind IN ('job', 'reaction'));

ALTER TABLE questpie_internal.durable_dispatches
  RENAME CONSTRAINT reaction_intent_origin_key TO durable_dispatch_origin_key;
ALTER TABLE questpie_internal.durable_dispatches
  RENAME CONSTRAINT reaction_intent_call_id_bounded TO durable_dispatch_call_id_bounded;
ALTER TABLE questpie_internal.durable_dispatches
  RENAME CONSTRAINT reaction_intent_principal_kind_known TO durable_dispatch_principal_kind_known;
ALTER TABLE questpie_internal.durable_dispatches
  RENAME CONSTRAINT pending_reaction_intents_pkey TO durable_dispatches_pkey;
ALTER TABLE questpie_internal.durable_dispatches
  RENAME CONSTRAINT reaction_intent_input_digest_sha256 TO durable_dispatch_input_digest_sha256;
ALTER TABLE questpie_internal.durable_dispatches
  RENAME CONSTRAINT reaction_intent_payload_bytes_bounded TO durable_dispatch_payload_bytes_bounded;
ALTER TABLE questpie_internal.durable_dispatches
  RENAME CONSTRAINT reaction_intent_state_known TO durable_dispatch_state_known;

ALTER TABLE questpie_internal.durable_runs
  ADD COLUMN semantic_version integer NOT NULL DEFAULT 1;
ALTER TABLE questpie_internal.durable_runs
  ALTER COLUMN semantic_version DROP DEFAULT;
ALTER TABLE questpie_internal.durable_runs
  ADD CONSTRAINT durable_run_semantic_version_positive
  CHECK (semantic_version > 0);
`;
