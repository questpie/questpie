CREATE SCHEMA questpie_internal;

CREATE TABLE questpie_internal.schema_protocol (
  singleton boolean PRIMARY KEY,
  version integer NOT NULL,
  checksum text NOT NULL,
  installed_at timestamptz NOT NULL,
  CONSTRAINT qp_schema_protocol_singleton CHECK (singleton)
);

CREATE TABLE questpie_internal.application_bindings (
  application_name text PRIMARY KEY,
  schema_name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL
);

CREATE TABLE questpie_internal.schema_migration_receipts (
  application_name text NOT NULL REFERENCES questpie_internal.application_bindings(application_name),
  identity text NOT NULL,
  sequence integer NOT NULL,
  checksum text NOT NULL,
  target_schema_digest text NOT NULL,
  applied_at timestamptz NOT NULL,
  PRIMARY KEY (application_name, identity),
  UNIQUE (application_name, sequence)
);

CREATE TABLE questpie_internal.seed_receipts (
  application_name text NOT NULL REFERENCES questpie_internal.application_bindings(application_name),
  identity text NOT NULL,
  checksum text NOT NULL,
  schema_digest text NOT NULL,
  applied_at timestamptz NOT NULL,
  PRIMARY KEY (application_name, identity)
);

CREATE TABLE questpie_internal.seed_attempts (
  attempt_id uuid NOT NULL,
  application_name text NOT NULL,
  seed_identity text NOT NULL,
  sequence integer NOT NULL,
  status text NOT NULL,
  diagnostic_code text,
  recorded_at timestamptz NOT NULL,
  PRIMARY KEY (attempt_id, sequence)
);

REVOKE ALL ON SCHEMA questpie_internal FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA questpie_internal FROM PUBLIC;
