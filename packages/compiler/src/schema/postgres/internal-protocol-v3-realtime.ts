const internalProtocolV3RealtimeSql = `CREATE TABLE questpie_internal.realtime_scope_attachments (
  application_name text NOT NULL,
  scope_identity text NOT NULL,
  deployment_digest text NOT NULL,
  authority_partition_digest text,
  principal_kind text NOT NULL,
  principal_id text NOT NULL,
  opened_at timestamptz NOT NULL,
  renewed_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  state text NOT NULL,
  withdrawn_at timestamptz,
  PRIMARY KEY (application_name, scope_identity),
  CONSTRAINT realtime_scope_attachment_binding_key UNIQUE (
    application_name, scope_identity, deployment_digest,
    authority_partition_digest, principal_kind, principal_id
  ),
  CONSTRAINT realtime_scope_identity_bounded CHECK (
    length(scope_identity) BETWEEN 1 AND 256 AND octet_length(scope_identity) <= 1024
  ),
  CONSTRAINT realtime_scope_deployment_digest_sha256 CHECK (deployment_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT realtime_scope_authority_digest_sha256 CHECK (authority_partition_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT realtime_scope_principal_kind_known CHECK (principal_kind IN ('anonymous', 'service', 'user')),
  CONSTRAINT realtime_scope_principal_id_bounded CHECK (
    length(principal_id) BETWEEN 1 AND 1024 AND octet_length(principal_id) <= 4096
  ),
  CONSTRAINT realtime_scope_state_known CHECK (state IN ('attached', 'open', 'withdrawn')),
  CONSTRAINT realtime_scope_lifecycle_shape CHECK (
    renewed_at >= opened_at
    AND (
      (state = 'attached' AND authority_partition_digest IS NULL AND withdrawn_at IS NULL)
      OR (state = 'open' AND authority_partition_digest IS NOT NULL AND withdrawn_at IS NULL)
      OR (state = 'withdrawn' AND withdrawn_at IS NOT NULL AND withdrawn_at >= opened_at)
    )
  ),
  CONSTRAINT realtime_scope_expiry_exact CHECK (expires_at = renewed_at + interval '30 seconds')
);
CREATE INDEX realtime_scope_attachments_expiry_idx
  ON questpie_internal.realtime_scope_attachments
  (application_name, deployment_digest, state, expires_at);

CREATE TABLE questpie_internal.realtime_watch_bindings (
  application_name text NOT NULL,
  scope_identity text NOT NULL,
  binding_identity text NOT NULL,
  deployment_digest text NOT NULL,
  authority_partition_digest text NOT NULL,
  principal_kind text NOT NULL,
  principal_id text NOT NULL,
  active_slot smallint,
  query_identity text NOT NULL,
  query_bytes bytea NOT NULL,
  input_bytes bytea NOT NULL,
  context_input_bytes bytea NOT NULL,
  opened_at timestamptz NOT NULL,
  state text NOT NULL,
  withdrawn_at timestamptz,
  acknowledged_generation bigint,
  acknowledged_token_digest text,
  acknowledged_at timestamptz,
  PRIMARY KEY (application_name, scope_identity, binding_identity),
  CONSTRAINT realtime_watch_binding_scope_fkey FOREIGN KEY (
    application_name, scope_identity, deployment_digest,
    authority_partition_digest, principal_kind, principal_id
  ) REFERENCES questpie_internal.realtime_scope_attachments (
    application_name, scope_identity, deployment_digest,
    authority_partition_digest, principal_kind, principal_id
  ) ON DELETE CASCADE,
  CONSTRAINT realtime_watch_binding_identity_bounded CHECK (
    length(binding_identity) BETWEEN 1 AND 256 AND octet_length(binding_identity) <= 1024
  ),
  CONSTRAINT realtime_watch_binding_deployment_digest_sha256 CHECK (deployment_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT realtime_watch_binding_authority_digest_sha256 CHECK (authority_partition_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT realtime_watch_binding_principal_kind_known CHECK (principal_kind IN ('anonymous', 'service', 'user')),
  CONSTRAINT realtime_watch_binding_principal_id_bounded CHECK (
    length(principal_id) BETWEEN 1 AND 1024 AND octet_length(principal_id) <= 4096
  ),
  CONSTRAINT realtime_watch_binding_active_slot_bounded CHECK (
    active_slot IS NULL OR active_slot BETWEEN 1 AND 64
  ),
  CONSTRAINT realtime_watch_binding_query_identity_bounded CHECK (
    length(query_identity) BETWEEN 1 AND 256 AND octet_length(query_identity) <= 1024
  ),
  CONSTRAINT realtime_watch_binding_payload_bounded CHECK (
    octet_length(query_bytes) + octet_length(input_bytes) + octet_length(context_input_bytes) <= 1048576
  ),
  CONSTRAINT realtime_watch_binding_state_known CHECK (state IN ('open', 'withdrawn')),
  CONSTRAINT realtime_watch_binding_lifecycle_shape CHECK (
    (state = 'open' AND active_slot IS NOT NULL AND withdrawn_at IS NULL)
    OR (state = 'withdrawn' AND active_slot IS NULL AND withdrawn_at IS NOT NULL AND withdrawn_at >= opened_at)
  ),
  CONSTRAINT realtime_watch_binding_ack_shape CHECK (
    (acknowledged_generation IS NULL AND acknowledged_token_digest IS NULL AND acknowledged_at IS NULL)
    OR (acknowledged_generation > 0 AND acknowledged_token_digest IS NOT NULL AND acknowledged_at IS NOT NULL)
  ),
  CONSTRAINT realtime_watch_binding_ack_digest_sha256 CHECK (
    acknowledged_token_digest IS NULL OR acknowledged_token_digest ~ '^[0-9a-f]{64}$'
  )
);
CREATE UNIQUE INDEX realtime_watch_bindings_principal_slot_key
  ON questpie_internal.realtime_watch_bindings
  (application_name, deployment_digest, principal_kind, principal_id, active_slot);
CREATE INDEX realtime_watch_bindings_scope_scan_idx
  ON questpie_internal.realtime_watch_bindings
  (application_name, scope_identity, state, binding_identity);
`;

const internalProtocolV3RealtimeTables = [
	"realtime_scope_attachments",
	"realtime_watch_bindings",
] as const;

const internalProtocolV3RealtimeColumns = [
	["realtime_scope_attachments", "application_name", "text", true],
	["realtime_scope_attachments", "scope_identity", "text", true],
	["realtime_scope_attachments", "deployment_digest", "text", true],
	["realtime_scope_attachments", "authority_partition_digest", "text", false],
	["realtime_scope_attachments", "principal_kind", "text", true],
	["realtime_scope_attachments", "principal_id", "text", true],
	["realtime_scope_attachments", "opened_at", "timestamp with time zone", true],
	[
		"realtime_scope_attachments",
		"renewed_at",
		"timestamp with time zone",
		true,
	],
	[
		"realtime_scope_attachments",
		"expires_at",
		"timestamp with time zone",
		true,
	],
	["realtime_scope_attachments", "state", "text", true],
	[
		"realtime_scope_attachments",
		"withdrawn_at",
		"timestamp with time zone",
		false,
	],
	["realtime_watch_bindings", "application_name", "text", true],
	["realtime_watch_bindings", "scope_identity", "text", true],
	["realtime_watch_bindings", "binding_identity", "text", true],
	["realtime_watch_bindings", "deployment_digest", "text", true],
	["realtime_watch_bindings", "authority_partition_digest", "text", true],
	["realtime_watch_bindings", "principal_kind", "text", true],
	["realtime_watch_bindings", "principal_id", "text", true],
	["realtime_watch_bindings", "active_slot", "smallint", false],
	["realtime_watch_bindings", "query_identity", "text", true],
	["realtime_watch_bindings", "query_bytes", "bytea", true],
	["realtime_watch_bindings", "input_bytes", "bytea", true],
	["realtime_watch_bindings", "context_input_bytes", "bytea", true],
	["realtime_watch_bindings", "opened_at", "timestamp with time zone", true],
	["realtime_watch_bindings", "state", "text", true],
	[
		"realtime_watch_bindings",
		"withdrawn_at",
		"timestamp with time zone",
		false,
	],
	["realtime_watch_bindings", "acknowledged_generation", "bigint", false],
	["realtime_watch_bindings", "acknowledged_token_digest", "text", false],
	[
		"realtime_watch_bindings",
		"acknowledged_at",
		"timestamp with time zone",
		false,
	],
] as const;

const internalProtocolV3RealtimeConstraints = [
	[
		"realtime_scope_attachments",
		"realtime_scope_attachment_binding_key",
		"u",
		"UNIQUE (application_name, scope_identity, deployment_digest, authority_partition_digest, principal_kind, principal_id)",
	],
	[
		"realtime_scope_attachments",
		"realtime_scope_attachments_pkey",
		"p",
		"PRIMARY KEY (application_name, scope_identity)",
	],
	[
		"realtime_scope_attachments",
		"realtime_scope_authority_digest_sha256",
		"c",
		"CHECK (authority_partition_digest ~ '^[0-9a-f]{64}$'::text)",
	],
	[
		"realtime_scope_attachments",
		"realtime_scope_deployment_digest_sha256",
		"c",
		"CHECK (deployment_digest ~ '^[0-9a-f]{64}$'::text)",
	],
	[
		"realtime_scope_attachments",
		"realtime_scope_expiry_exact",
		"c",
		"CHECK (expires_at = (renewed_at + '00:00:30'::interval))",
	],
	[
		"realtime_scope_attachments",
		"realtime_scope_identity_bounded",
		"c",
		"CHECK (length(scope_identity) >= 1 AND length(scope_identity) <= 256 AND octet_length(scope_identity) <= 1024)",
	],
	[
		"realtime_scope_attachments",
		"realtime_scope_lifecycle_shape",
		"c",
		"CHECK (renewed_at >= opened_at AND (state = 'attached'::text AND authority_partition_digest IS NULL AND withdrawn_at IS NULL OR state = 'open'::text AND authority_partition_digest IS NOT NULL AND withdrawn_at IS NULL OR state = 'withdrawn'::text AND withdrawn_at IS NOT NULL AND withdrawn_at >= opened_at))",
	],
	[
		"realtime_scope_attachments",
		"realtime_scope_principal_id_bounded",
		"c",
		"CHECK (length(principal_id) >= 1 AND length(principal_id) <= 1024 AND octet_length(principal_id) <= 4096)",
	],
	[
		"realtime_scope_attachments",
		"realtime_scope_principal_kind_known",
		"c",
		"CHECK (principal_kind = ANY (ARRAY['anonymous'::text, 'service'::text, 'user'::text]))",
	],
	[
		"realtime_scope_attachments",
		"realtime_scope_state_known",
		"c",
		"CHECK (state = ANY (ARRAY['attached'::text, 'open'::text, 'withdrawn'::text]))",
	],
	[
		"realtime_watch_bindings",
		"realtime_watch_binding_ack_digest_sha256",
		"c",
		"CHECK (acknowledged_token_digest IS NULL OR acknowledged_token_digest ~ '^[0-9a-f]{64}$'::text)",
	],
	[
		"realtime_watch_bindings",
		"realtime_watch_binding_ack_shape",
		"c",
		"CHECK (acknowledged_generation IS NULL AND acknowledged_token_digest IS NULL AND acknowledged_at IS NULL OR acknowledged_generation > 0 AND acknowledged_token_digest IS NOT NULL AND acknowledged_at IS NOT NULL)",
	],
	[
		"realtime_watch_bindings",
		"realtime_watch_binding_active_slot_bounded",
		"c",
		"CHECK (active_slot IS NULL OR active_slot >= 1 AND active_slot <= 64)",
	],
	[
		"realtime_watch_bindings",
		"realtime_watch_binding_authority_digest_sha256",
		"c",
		"CHECK (authority_partition_digest ~ '^[0-9a-f]{64}$'::text)",
	],
	[
		"realtime_watch_bindings",
		"realtime_watch_binding_deployment_digest_sha256",
		"c",
		"CHECK (deployment_digest ~ '^[0-9a-f]{64}$'::text)",
	],
	[
		"realtime_watch_bindings",
		"realtime_watch_binding_identity_bounded",
		"c",
		"CHECK (length(binding_identity) >= 1 AND length(binding_identity) <= 256 AND octet_length(binding_identity) <= 1024)",
	],
	[
		"realtime_watch_bindings",
		"realtime_watch_binding_lifecycle_shape",
		"c",
		"CHECK (state = 'open'::text AND active_slot IS NOT NULL AND withdrawn_at IS NULL OR state = 'withdrawn'::text AND active_slot IS NULL AND withdrawn_at IS NOT NULL AND withdrawn_at >= opened_at)",
	],
	[
		"realtime_watch_bindings",
		"realtime_watch_binding_payload_bounded",
		"c",
		"CHECK ((octet_length(query_bytes) + octet_length(input_bytes) + octet_length(context_input_bytes)) <= 1048576)",
	],
	[
		"realtime_watch_bindings",
		"realtime_watch_binding_principal_id_bounded",
		"c",
		"CHECK (length(principal_id) >= 1 AND length(principal_id) <= 1024 AND octet_length(principal_id) <= 4096)",
	],
	[
		"realtime_watch_bindings",
		"realtime_watch_binding_principal_kind_known",
		"c",
		"CHECK (principal_kind = ANY (ARRAY['anonymous'::text, 'service'::text, 'user'::text]))",
	],
	[
		"realtime_watch_bindings",
		"realtime_watch_binding_query_identity_bounded",
		"c",
		"CHECK (length(query_identity) >= 1 AND length(query_identity) <= 256 AND octet_length(query_identity) <= 1024)",
	],
	[
		"realtime_watch_bindings",
		"realtime_watch_binding_scope_fkey",
		"f",
		"FOREIGN KEY (application_name, scope_identity, deployment_digest, authority_partition_digest, principal_kind, principal_id) REFERENCES questpie_internal.realtime_scope_attachments(application_name, scope_identity, deployment_digest, authority_partition_digest, principal_kind, principal_id) ON DELETE CASCADE",
	],
	[
		"realtime_watch_bindings",
		"realtime_watch_binding_state_known",
		"c",
		"CHECK (state = ANY (ARRAY['open'::text, 'withdrawn'::text]))",
	],
	[
		"realtime_watch_bindings",
		"realtime_watch_bindings_pkey",
		"p",
		"PRIMARY KEY (application_name, scope_identity, binding_identity)",
	],
] as const;

const internalProtocolV3RealtimeIndexes = [
	[
		"realtime_scope_attachments",
		"realtime_scope_attachment_binding_key",
		"btree",
		true,
		false,
		"CREATE UNIQUE INDEX realtime_scope_attachment_binding_key ON questpie_internal.realtime_scope_attachments USING btree (application_name, scope_identity, deployment_digest, authority_partition_digest, principal_kind, principal_id)",
	],
	[
		"realtime_scope_attachments",
		"realtime_scope_attachments_expiry_idx",
		"btree",
		false,
		false,
		"CREATE INDEX realtime_scope_attachments_expiry_idx ON questpie_internal.realtime_scope_attachments USING btree (application_name, deployment_digest, state, expires_at)",
	],
	[
		"realtime_scope_attachments",
		"realtime_scope_attachments_pkey",
		"btree",
		true,
		true,
		"CREATE UNIQUE INDEX realtime_scope_attachments_pkey ON questpie_internal.realtime_scope_attachments USING btree (application_name, scope_identity)",
	],
	[
		"realtime_watch_bindings",
		"realtime_watch_bindings_pkey",
		"btree",
		true,
		true,
		"CREATE UNIQUE INDEX realtime_watch_bindings_pkey ON questpie_internal.realtime_watch_bindings USING btree (application_name, scope_identity, binding_identity)",
	],
	[
		"realtime_watch_bindings",
		"realtime_watch_bindings_principal_slot_key",
		"btree",
		true,
		false,
		"CREATE UNIQUE INDEX realtime_watch_bindings_principal_slot_key ON questpie_internal.realtime_watch_bindings USING btree (application_name, deployment_digest, principal_kind, principal_id, active_slot)",
	],
	[
		"realtime_watch_bindings",
		"realtime_watch_bindings_scope_scan_idx",
		"btree",
		false,
		false,
		"CREATE INDEX realtime_watch_bindings_scope_scan_idx ON questpie_internal.realtime_watch_bindings USING btree (application_name, scope_identity, state, binding_identity)",
	],
] as const;

export {
	internalProtocolV3RealtimeColumns,
	internalProtocolV3RealtimeConstraints,
	internalProtocolV3RealtimeIndexes,
	internalProtocolV3RealtimeSql,
	internalProtocolV3RealtimeTables,
};
