CREATE SCHEMA IF NOT EXISTS questpie_internal AUTHORIZATION CURRENT_USER;
REVOKE ALL ON SCHEMA questpie_internal FROM PUBLIC;

CREATE TABLE IF NOT EXISTS questpie_internal.protocol (
  singleton boolean PRIMARY KEY,
  version integer NOT NULL,
  checksum text NOT NULL,
  CONSTRAINT protocol_singleton_true CHECK (singleton),
  CONSTRAINT protocol_checksum_sha256 CHECK (checksum ~ '^[0-9a-f]{64}$')
);

CREATE TABLE IF NOT EXISTS questpie_internal.application_bindings (
  application_name text PRIMARY KEY,
  postgres_schema text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS questpie_internal.schema_migration_receipts (
  application_name text NOT NULL,
  migration_identity text NOT NULL,
  sequence integer NOT NULL,
  parent_identity text,
  checksum text NOT NULL,
  base_schema_digest text NOT NULL,
  target_schema_digest text NOT NULL,
  applied_at timestamptz NOT NULL,
  PRIMARY KEY (application_name, migration_identity),
  UNIQUE (application_name, sequence),
  CONSTRAINT migration_sequence_positive CHECK (sequence > 0),
  CONSTRAINT migration_checksum_sha256 CHECK (checksum ~ '^[0-9a-f]{64}$'),
  CONSTRAINT migration_base_digest_sha256 CHECK (base_schema_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT migration_target_digest_sha256 CHECK (target_schema_digest ~ '^[0-9a-f]{64}$')
);

CREATE TABLE IF NOT EXISTS questpie_internal.seed_receipts (
  application_name text NOT NULL,
  seed_identity text NOT NULL,
  checksum text NOT NULL,
  applied_schema_digest text NOT NULL,
  committed_at timestamptz NOT NULL,
  attempt_id uuid NOT NULL,
  PRIMARY KEY (application_name, seed_identity),
  CONSTRAINT seed_checksum_sha256 CHECK (checksum ~ '^[0-9a-f]{64}$'),
  CONSTRAINT seed_applied_digest_sha256 CHECK (applied_schema_digest ~ '^[0-9a-f]{64}$')
);

CREATE TABLE IF NOT EXISTS questpie_internal.seed_attempt_events (
  application_name text NOT NULL,
  attempt_id uuid NOT NULL,
  sequence smallint NOT NULL,
  seed_identity text NOT NULL,
  checksum text NOT NULL,
  event text NOT NULL,
  occurred_at timestamptz NOT NULL,
  error_code text,
  PRIMARY KEY (application_name, attempt_id, sequence),
  CONSTRAINT seed_attempt_sequence_nonnegative CHECK (sequence >= 0),
  CONSTRAINT seed_attempt_checksum_sha256 CHECK (checksum ~ '^[0-9a-f]{64}$'),
  CONSTRAINT seed_attempt_event_known CHECK (
    event IN ('started', 'succeeded', 'failed', 'interrupted', 'alreadyApplied', 'blocked')
  )
);

REVOKE ALL ON ALL TABLES IN SCHEMA questpie_internal FROM PUBLIC;
