import {
	internalProtocolV3RealtimeColumns,
	internalProtocolV3RealtimeTables,
} from "./internal-protocol-v3-realtime-catalog";

const internalProtocolV3RealtimeSql = `CREATE TABLE questpie_internal.realtime_scope_attachments (
  application_name text NOT NULL,
  scope_identity text NOT NULL,
  deployment_digest text NOT NULL,
  authority_partition_digest text,
  principal_kind text NOT NULL,
  principal_id text NOT NULL,
  holder_generation bigint NOT NULL DEFAULT 1,
  opened_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  renewed_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  expires_at timestamptz NOT NULL DEFAULT transaction_timestamp() + interval '30 seconds',
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
  CONSTRAINT realtime_scope_holder_generation_positive CHECK (holder_generation > 0),
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
  input_digest text NOT NULL,
  context_input_bytes bytea NOT NULL,
  wire_version integer NOT NULL,
  resume_requested boolean NOT NULL,
  requested_resume_token text,
  opened_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  state text NOT NULL,
  withdrawn_at timestamptz,
  invalidation_generation bigint NOT NULL DEFAULT 1,
  evaluated_invalidation_generation bigint NOT NULL DEFAULT 0,
  invalidated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (application_name, scope_identity, binding_identity),
  CONSTRAINT realtime_watch_binding_authority_key UNIQUE (
    application_name, scope_identity, binding_identity, deployment_digest,
    authority_partition_digest, query_identity, input_digest, wire_version
  ),
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
  CONSTRAINT realtime_watch_binding_input_digest_sha256 CHECK (input_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT realtime_watch_binding_wire_version_positive CHECK (wire_version > 0),
  CONSTRAINT realtime_watch_binding_resume_shape CHECK (
    (NOT resume_requested AND requested_resume_token IS NULL)
    OR (
      resume_requested AND requested_resume_token IS NOT NULL
      AND length(requested_resume_token) >= 1
      AND octet_length(requested_resume_token) <= 4096
    )
  ),
  CONSTRAINT realtime_watch_binding_payload_bounded CHECK (
    octet_length(query_bytes) + octet_length(input_bytes) + octet_length(context_input_bytes) <= 1048576
  ),
  CONSTRAINT realtime_watch_binding_state_known CHECK (state IN ('open', 'withdrawn')),
  CONSTRAINT realtime_watch_binding_lifecycle_shape CHECK (
    (state = 'open' AND active_slot IS NOT NULL AND withdrawn_at IS NULL)
    OR (state = 'withdrawn' AND active_slot IS NULL AND withdrawn_at IS NOT NULL AND withdrawn_at >= opened_at)
  ),
  CONSTRAINT realtime_watch_binding_invalidation_order CHECK (
    evaluated_invalidation_generation >= 0
    AND evaluated_invalidation_generation <= invalidation_generation
  )
);
CREATE UNIQUE INDEX realtime_watch_bindings_principal_slot_key
  ON questpie_internal.realtime_watch_bindings
  (application_name, deployment_digest, principal_kind, principal_id, active_slot);
CREATE INDEX realtime_watch_bindings_scope_scan_idx
  ON questpie_internal.realtime_watch_bindings
  (application_name, scope_identity, state, binding_identity);

CREATE TABLE questpie_internal.observed_dependency_plans (
  application_name text NOT NULL,
  scope_identity text NOT NULL,
  binding_identity text NOT NULL,
  deployment_digest text NOT NULL,
  authority_partition_digest text NOT NULL,
  query_identity text NOT NULL,
  input_digest text NOT NULL,
  wire_version integer NOT NULL,
  retained_generation bigint NOT NULL,
  plan_digest text NOT NULL,
  plan_bytes bytea NOT NULL,
  replaced_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (application_name, scope_identity, binding_identity),
  FOREIGN KEY (
    application_name, scope_identity, binding_identity, deployment_digest,
    authority_partition_digest, query_identity, input_digest, wire_version
  ) REFERENCES questpie_internal.realtime_watch_bindings (
    application_name, scope_identity, binding_identity, deployment_digest,
    authority_partition_digest, query_identity, input_digest, wire_version
  ) ON DELETE CASCADE,
  CONSTRAINT dependency_generation_positive CHECK (retained_generation > 0),
  CONSTRAINT dependency_plan_digest_sha256 CHECK (plan_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT dependency_plan_bytes_bounded CHECK (octet_length(plan_bytes) <= 262144)
);

CREATE TABLE questpie_internal.realtime_binding_generations (
  application_name text NOT NULL,
  scope_identity text NOT NULL,
  binding_identity text NOT NULL,
  deployment_digest text NOT NULL,
  authority_partition_digest text NOT NULL,
  query_identity text NOT NULL,
  input_digest text NOT NULL,
  wire_version integer NOT NULL,
  generation bigint NOT NULL,
  token_digest text NOT NULL,
  result_bytes bytea NOT NULL,
  dependency_plan_bytes bytea NOT NULL,
  delivery_kind text NOT NULL,
  reset_reason text,
  latest_slot smallint,
  ack_slot smallint,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  acknowledged_at timestamptz,
  PRIMARY KEY (application_name, scope_identity, binding_identity, generation),
  FOREIGN KEY (
    application_name, scope_identity, binding_identity, deployment_digest,
    authority_partition_digest, query_identity, input_digest, wire_version
  ) REFERENCES questpie_internal.realtime_watch_bindings (
    application_name, scope_identity, binding_identity, deployment_digest,
    authority_partition_digest, query_identity, input_digest, wire_version
  ) ON DELETE CASCADE,
  CONSTRAINT realtime_binding_generation_positive CHECK (generation > 0),
  CONSTRAINT realtime_binding_generation_token_digest_sha256 CHECK (token_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT realtime_binding_generation_deployment_sha256 CHECK (deployment_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT realtime_binding_generation_authority_sha256 CHECK (authority_partition_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT realtime_binding_generation_input_sha256 CHECK (input_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT realtime_binding_generation_wire_positive CHECK (wire_version > 0),
  CONSTRAINT realtime_binding_generation_result_bounded CHECK (octet_length(result_bytes) <= 1048576),
  CONSTRAINT realtime_binding_generation_dependency_bounded CHECK (octet_length(dependency_plan_bytes) <= 262144),
  CONSTRAINT realtime_binding_generation_delivery_known CHECK (delivery_kind IN ('initial', 'reset', 'update')),
  CONSTRAINT realtime_binding_generation_reset_shape CHECK (
    (delivery_kind = 'reset' AND reset_reason IN ('authority-changed', 'deployment-changed', 'resume-unavailable'))
    OR (delivery_kind <> 'reset' AND reset_reason IS NULL)
  ),
  CONSTRAINT realtime_binding_generation_latest_slot CHECK (latest_slot IS NULL OR latest_slot = 1),
  CONSTRAINT realtime_binding_generation_ack_shape CHECK (
    (ack_slot IS NULL AND acknowledged_at IS NULL)
    OR (ack_slot = 1 AND acknowledged_at IS NOT NULL)
  )
);
CREATE UNIQUE INDEX realtime_binding_generations_latest_key
  ON questpie_internal.realtime_binding_generations
  (application_name, scope_identity, binding_identity, latest_slot);
CREATE UNIQUE INDEX realtime_binding_generations_ack_key
  ON questpie_internal.realtime_binding_generations
  (application_name, scope_identity, binding_identity, ack_slot);

CREATE FUNCTION questpie_internal.stamp_realtime_scope_attachment()
RETURNS trigger LANGUAGE plpgsql
SECURITY DEFINER SET search_path = pg_catalog, questpie_internal AS $$
DECLARE
  clock_time timestamptz := transaction_timestamp();
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.holder_generation := 1;
    NEW.opened_at := clock_time;
    NEW.renewed_at := clock_time;
  ELSE
    IF ROW(NEW.application_name, NEW.scope_identity, NEW.deployment_digest, NEW.principal_kind, NEW.principal_id)
       IS DISTINCT FROM ROW(OLD.application_name, OLD.scope_identity, OLD.deployment_digest, OLD.principal_kind, OLD.principal_id) THEN
      RAISE EXCEPTION 'realtime scope identity is immutable';
    END IF;
    IF NEW.holder_generation < OLD.holder_generation
       OR NEW.holder_generation > OLD.holder_generation + 1 THEN
      RAISE EXCEPTION 'realtime scope holder generation is not a valid fence';
    END IF;
    IF OLD.state = 'withdrawn' AND NEW.state <> 'withdrawn' THEN
      IF NEW.state <> 'attached'
         OR NEW.authority_partition_digest IS NOT NULL
         OR NEW.holder_generation <> OLD.holder_generation + 1 THEN
        RAISE EXCEPTION 'withdrawn realtime scope requires a fresh fenced attachment';
      END IF;
      NEW.opened_at := clock_time;
    ELSE
      IF OLD.authority_partition_digest IS NOT NULL
         AND NEW.authority_partition_digest IS DISTINCT FROM OLD.authority_partition_digest THEN
        RAISE EXCEPTION 'realtime scope authority is immutable';
      END IF;
      NEW.opened_at := OLD.opened_at;
    END IF;
    IF NEW.renewed_at IS DISTINCT FROM OLD.renewed_at THEN
      NEW.renewed_at := clock_time;
    END IF;
  END IF;
  NEW.expires_at := NEW.renewed_at + interval '30 seconds';
  IF NEW.state = 'withdrawn' THEN
    DELETE FROM questpie_internal.realtime_watch_bindings
    WHERE application_name = NEW.application_name AND scope_identity = NEW.scope_identity;
    NEW.withdrawn_at := clock_time;
  ELSE
    NEW.withdrawn_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION questpie_internal.stamp_realtime_watch_binding()
RETURNS trigger LANGUAGE plpgsql
SECURITY DEFINER SET search_path = pg_catalog, questpie_internal AS $$
DECLARE
  clock_time timestamptz := transaction_timestamp();
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.opened_at := clock_time;
    NEW.invalidated_at := clock_time;
  ELSE
    IF ROW(NEW.application_name, NEW.scope_identity, NEW.binding_identity, NEW.deployment_digest,
           NEW.authority_partition_digest, NEW.principal_kind, NEW.principal_id, NEW.query_identity,
           NEW.query_bytes, NEW.input_bytes, NEW.input_digest, NEW.context_input_bytes, NEW.wire_version,
           NEW.resume_requested, NEW.requested_resume_token)
       IS DISTINCT FROM ROW(OLD.application_name, OLD.scope_identity, OLD.binding_identity, OLD.deployment_digest,
           OLD.authority_partition_digest, OLD.principal_kind, OLD.principal_id, OLD.query_identity,
           OLD.query_bytes, OLD.input_bytes, OLD.input_digest, OLD.context_input_bytes, OLD.wire_version,
           OLD.resume_requested, OLD.requested_resume_token) THEN
      RAISE EXCEPTION 'realtime binding authority is immutable';
    END IF;
    NEW.opened_at := OLD.opened_at;
    IF NEW.invalidation_generation < OLD.invalidation_generation
       OR NEW.evaluated_invalidation_generation < OLD.evaluated_invalidation_generation THEN
      RAISE EXCEPTION 'realtime binding generations are monotonic';
    END IF;
    IF NEW.invalidation_generation > OLD.invalidation_generation THEN
      NEW.invalidated_at := clock_time;
    ELSE
      NEW.invalidated_at := OLD.invalidated_at;
    END IF;
  END IF;
  IF NEW.state = 'withdrawn' THEN
    NEW.active_slot := NULL;
    NEW.withdrawn_at := clock_time;
  ELSE
    NEW.withdrawn_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION questpie_internal.stamp_realtime_binding_generation()
RETURNS trigger LANGUAGE plpgsql
SECURITY DEFINER SET search_path = pg_catalog, questpie_internal AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := transaction_timestamp();
  ELSE
    IF ROW(NEW.application_name, NEW.scope_identity, NEW.binding_identity, NEW.deployment_digest,
           NEW.authority_partition_digest, NEW.query_identity, NEW.input_digest, NEW.wire_version,
           NEW.generation, NEW.token_digest, NEW.result_bytes, NEW.dependency_plan_bytes, NEW.delivery_kind, NEW.reset_reason)
       IS DISTINCT FROM ROW(OLD.application_name, OLD.scope_identity, OLD.binding_identity, OLD.deployment_digest,
           OLD.authority_partition_digest, OLD.query_identity, OLD.input_digest, OLD.wire_version,
           OLD.generation, OLD.token_digest, OLD.result_bytes, OLD.dependency_plan_bytes, OLD.delivery_kind, OLD.reset_reason) THEN
      RAISE EXCEPTION 'realtime complete generation is immutable';
    END IF;
    NEW.created_at := OLD.created_at;
  END IF;
  IF NEW.ack_slot = 1 AND (TG_OP = 'INSERT' OR OLD.ack_slot IS DISTINCT FROM 1) THEN
    NEW.acknowledged_at := transaction_timestamp();
  ELSIF NEW.ack_slot IS NULL THEN
    NEW.acknowledged_at := NULL;
  ELSE
    NEW.acknowledged_at := OLD.acknowledged_at;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION questpie_internal.stamp_observed_dependency_plan()
RETURNS trigger LANGUAGE plpgsql
SECURITY DEFINER SET search_path = pg_catalog, questpie_internal AS $$
BEGIN
  NEW.replaced_at := transaction_timestamp();
  RETURN NEW;
END;
$$;

CREATE TRIGGER realtime_scope_attachment_clock BEFORE INSERT OR UPDATE
ON questpie_internal.realtime_scope_attachments FOR EACH ROW
EXECUTE FUNCTION questpie_internal.stamp_realtime_scope_attachment();
CREATE TRIGGER realtime_watch_binding_clock BEFORE INSERT OR UPDATE
ON questpie_internal.realtime_watch_bindings FOR EACH ROW
EXECUTE FUNCTION questpie_internal.stamp_realtime_watch_binding();
CREATE TRIGGER realtime_binding_generation_clock BEFORE INSERT OR UPDATE
ON questpie_internal.realtime_binding_generations FOR EACH ROW
EXECUTE FUNCTION questpie_internal.stamp_realtime_binding_generation();
CREATE TRIGGER observed_dependency_plan_clock BEFORE INSERT OR UPDATE
ON questpie_internal.observed_dependency_plans FOR EACH ROW
EXECUTE FUNCTION questpie_internal.stamp_observed_dependency_plan();
`;

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
		"realtime_scope_holder_generation_positive",
		"c",
		"CHECK (holder_generation > 0)",
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
		"realtime_watch_binding_authority_key",
		"u",
		"UNIQUE (application_name, scope_identity, binding_identity, deployment_digest, authority_partition_digest, query_identity, input_digest, wire_version)",
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
		"realtime_watch_binding_input_digest_sha256",
		"c",
		"CHECK (input_digest ~ '^[0-9a-f]{64}$'::text)",
	],
	[
		"realtime_watch_bindings",
		"realtime_watch_binding_invalidation_order",
		"c",
		"CHECK (evaluated_invalidation_generation >= 0 AND evaluated_invalidation_generation <= invalidation_generation)",
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
		"realtime_watch_binding_resume_shape",
		"c",
		"CHECK (NOT resume_requested AND requested_resume_token IS NULL OR resume_requested AND requested_resume_token IS NOT NULL AND length(requested_resume_token) >= 1 AND octet_length(requested_resume_token) <= 4096)",
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
		"realtime_watch_binding_wire_version_positive",
		"c",
		"CHECK (wire_version > 0)",
	],
	[
		"realtime_watch_bindings",
		"realtime_watch_bindings_pkey",
		"p",
		"PRIMARY KEY (application_name, scope_identity, binding_identity)",
	],
	[
		"observed_dependency_plans",
		"dependency_generation_positive",
		"c",
		"CHECK (retained_generation > 0)",
	],
	[
		"observed_dependency_plans",
		"dependency_plan_bytes_bounded",
		"c",
		"CHECK (octet_length(plan_bytes) <= 262144)",
	],
	[
		"observed_dependency_plans",
		"dependency_plan_digest_sha256",
		"c",
		"CHECK (plan_digest ~ '^[0-9a-f]{64}$'::text)",
	],
	[
		"observed_dependency_plans",
		"observed_dependency_plans_application_name_scope_identity__fkey",
		"f",
		"FOREIGN KEY (application_name, scope_identity, binding_identity, deployment_digest, authority_partition_digest, query_identity, input_digest, wire_version) REFERENCES questpie_internal.realtime_watch_bindings(application_name, scope_identity, binding_identity, deployment_digest, authority_partition_digest, query_identity, input_digest, wire_version) ON DELETE CASCADE",
	],
	[
		"observed_dependency_plans",
		"observed_dependency_plans_pkey",
		"p",
		"PRIMARY KEY (application_name, scope_identity, binding_identity)",
	],
	[
		"realtime_binding_generations",
		"realtime_binding_generation_ack_shape",
		"c",
		"CHECK (ack_slot IS NULL AND acknowledged_at IS NULL OR ack_slot = 1 AND acknowledged_at IS NOT NULL)",
	],
	[
		"realtime_binding_generations",
		"realtime_binding_generation_authority_sha256",
		"c",
		"CHECK (authority_partition_digest ~ '^[0-9a-f]{64}$'::text)",
	],
	[
		"realtime_binding_generations",
		"realtime_binding_generation_delivery_known",
		"c",
		"CHECK (delivery_kind = ANY (ARRAY['initial'::text, 'reset'::text, 'update'::text]))",
	],
	[
		"realtime_binding_generations",
		"realtime_binding_generation_dependency_bounded",
		"c",
		"CHECK (octet_length(dependency_plan_bytes) <= 262144)",
	],
	[
		"realtime_binding_generations",
		"realtime_binding_generation_deployment_sha256",
		"c",
		"CHECK (deployment_digest ~ '^[0-9a-f]{64}$'::text)",
	],
	[
		"realtime_binding_generations",
		"realtime_binding_generation_input_sha256",
		"c",
		"CHECK (input_digest ~ '^[0-9a-f]{64}$'::text)",
	],
	[
		"realtime_binding_generations",
		"realtime_binding_generation_latest_slot",
		"c",
		"CHECK (latest_slot IS NULL OR latest_slot = 1)",
	],
	[
		"realtime_binding_generations",
		"realtime_binding_generation_positive",
		"c",
		"CHECK (generation > 0)",
	],
	[
		"realtime_binding_generations",
		"realtime_binding_generation_reset_shape",
		"c",
		"CHECK (delivery_kind = 'reset'::text AND (reset_reason = ANY (ARRAY['authority-changed'::text, 'deployment-changed'::text, 'resume-unavailable'::text])) OR delivery_kind <> 'reset'::text AND reset_reason IS NULL)",
	],
	[
		"realtime_binding_generations",
		"realtime_binding_generation_result_bounded",
		"c",
		"CHECK (octet_length(result_bytes) <= 1048576)",
	],
	[
		"realtime_binding_generations",
		"realtime_binding_generation_token_digest_sha256",
		"c",
		"CHECK (token_digest ~ '^[0-9a-f]{64}$'::text)",
	],
	[
		"realtime_binding_generations",
		"realtime_binding_generation_wire_positive",
		"c",
		"CHECK (wire_version > 0)",
	],
	[
		"realtime_binding_generations",
		"realtime_binding_generations_application_name_scope_identi_fkey",
		"f",
		"FOREIGN KEY (application_name, scope_identity, binding_identity, deployment_digest, authority_partition_digest, query_identity, input_digest, wire_version) REFERENCES questpie_internal.realtime_watch_bindings(application_name, scope_identity, binding_identity, deployment_digest, authority_partition_digest, query_identity, input_digest, wire_version) ON DELETE CASCADE",
	],
	[
		"realtime_binding_generations",
		"realtime_binding_generations_pkey",
		"p",
		"PRIMARY KEY (application_name, scope_identity, binding_identity, generation)",
	],
] as const;

const internalProtocolV3RealtimeIndexes = [
	[
		"realtime_watch_bindings",
		"realtime_watch_binding_authority_key",
		"btree",
		true,
		false,
		"CREATE UNIQUE INDEX realtime_watch_binding_authority_key ON questpie_internal.realtime_watch_bindings USING btree (application_name, scope_identity, binding_identity, deployment_digest, authority_partition_digest, query_identity, input_digest, wire_version)",
	],
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
	[
		"observed_dependency_plans",
		"observed_dependency_plans_pkey",
		"btree",
		true,
		true,
		"CREATE UNIQUE INDEX observed_dependency_plans_pkey ON questpie_internal.observed_dependency_plans USING btree (application_name, scope_identity, binding_identity)",
	],
	[
		"realtime_binding_generations",
		"realtime_binding_generations_ack_key",
		"btree",
		true,
		false,
		"CREATE UNIQUE INDEX realtime_binding_generations_ack_key ON questpie_internal.realtime_binding_generations USING btree (application_name, scope_identity, binding_identity, ack_slot)",
	],
	[
		"realtime_binding_generations",
		"realtime_binding_generations_latest_key",
		"btree",
		true,
		false,
		"CREATE UNIQUE INDEX realtime_binding_generations_latest_key ON questpie_internal.realtime_binding_generations USING btree (application_name, scope_identity, binding_identity, latest_slot)",
	],
	[
		"realtime_binding_generations",
		"realtime_binding_generations_pkey",
		"btree",
		true,
		true,
		"CREATE UNIQUE INDEX realtime_binding_generations_pkey ON questpie_internal.realtime_binding_generations USING btree (application_name, scope_identity, binding_identity, generation)",
	],
] as const;

export {
	internalProtocolV3RealtimeColumns,
	internalProtocolV3RealtimeConstraints,
	internalProtocolV3RealtimeIndexes,
	internalProtocolV3RealtimeSql,
	internalProtocolV3RealtimeTables,
};
