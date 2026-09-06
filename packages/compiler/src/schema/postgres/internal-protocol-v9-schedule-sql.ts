/** Candidate ADR-0043 protocol additions; installation is an explicit v9 cutover. */
export const internalProtocolV9ScheduleSql = `CREATE TABLE questpie_internal.schedule_heads (
  application_name text PRIMARY KEY,
  revision bigint NOT NULL CHECK (revision >= 0),
  target_digest text,
  activated_at timestamptz,
  CHECK ((revision = 0 AND target_digest IS NULL AND activated_at IS NULL) OR
    (revision > 0 AND target_digest ~ '^[0-9a-f]{64}$' AND activated_at IS NOT NULL))
);
CREATE TABLE questpie_internal.schedule_catalogs (
  application_name text NOT NULL,
  target_digest text NOT NULL CHECK (target_digest ~ '^[0-9a-f]{64}$'),
  canonical_json text NOT NULL CHECK (octet_length(canonical_json) <= 262144),
  PRIMARY KEY (application_name, target_digest)
);
CREATE TABLE questpie_internal.schedule_activations (
  application_name text NOT NULL,
  request_identity text NOT NULL CHECK (request_identity ~ '^[0-9a-f]{64}$'),
  expected_revision bigint NOT NULL CHECK (expected_revision >= 0),
  target_digest text NOT NULL,
  accepted_revision bigint NOT NULL CHECK (accepted_revision = expected_revision + 1),
  activated_at timestamptz NOT NULL,
  PRIMARY KEY (application_name, request_identity),
  UNIQUE (application_name, accepted_revision),
  FOREIGN KEY (application_name, target_digest) REFERENCES questpie_internal.schedule_catalogs
);
CREATE TABLE questpie_internal.schedule_frontiers (
  application_name text NOT NULL,
  job_identity text NOT NULL,
  program_digest text NOT NULL CHECK (program_digest ~ '^[0-9a-f]{64}$'),
  frontier_minute timestamptz NOT NULL,
  PRIMARY KEY (application_name, job_identity),
  FOREIGN KEY (application_name) REFERENCES questpie_internal.schedule_heads
);
CREATE TABLE questpie_internal.schedule_ticks (
  application_name text NOT NULL,
  job_identity text NOT NULL,
  scheduled_minute timestamptz NOT NULL,
  accepted_revision bigint NOT NULL,
  program_digest text NOT NULL CHECK (program_digest ~ '^[0-9a-f]{64}$'),
  run_id uuid NOT NULL,
  accepted_at timestamptz NOT NULL,
  PRIMARY KEY (application_name, job_identity, scheduled_minute),
  FOREIGN KEY (application_name, accepted_revision) REFERENCES questpie_internal.schedule_activations(application_name, accepted_revision),
  FOREIGN KEY (application_name, run_id) REFERENCES questpie_internal.durable_runs(application_name, run_id)
);
`;
