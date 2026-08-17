import { createHash } from "node:crypto";

import type { SQL } from "bun";

import { canonicalBytes, compareAscii } from "../../canonical";
import {
	acquireSessionLock,
	assertBackendPid,
	lockKey,
	withPinnedTransaction,
} from "../../postgres-session";
import type { PostgresControl } from "../../postgres-session";
import type { InternalProtocolCatalog } from "./bootstrap";
import { verifyInternalProtocolCatalog } from "./bootstrap";
import {
	ensureInternalProtocolV2,
	internalProtocolV2Catalog,
	internalProtocolV2Checksum,
} from "./internal-protocol-v2";
import {
	internalProtocolV3RealtimeColumns,
	internalProtocolV3RealtimeConstraints,
	internalProtocolV3RealtimeIndexes,
	internalProtocolV3RealtimeSql,
	internalProtocolV3RealtimeTables,
} from "./internal-protocol-v3-realtime";
import { fail } from "./shared";

const internalProtocolV3Sql = `CREATE TABLE questpie_internal.change_ledger (
  application_name text NOT NULL,
  fact_identity uuid NOT NULL DEFAULT gen_random_uuid(),
  fact_id bigint GENERATED ALWAYS AS IDENTITY,
  transaction_id xid8 NOT NULL,
  collection_identity text NOT NULL,
  change_kind text NOT NULL,
  old_key jsonb,
  new_key jsonb,
  conservative boolean NOT NULL DEFAULT false,
  captured_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (application_name, fact_identity),
  CONSTRAINT change_ledger_fact_shape CHECK (
    (conservative AND change_kind IN ('collection', 'truncate') AND old_key IS NULL AND new_key IS NULL)
    OR (NOT conservative AND change_kind IN ('insert', 'update', 'delete'))
  )
);
CREATE INDEX change_ledger_reconcile_idx ON questpie_internal.change_ledger
  (application_name, transaction_id, collection_identity, fact_id);

CREATE TABLE questpie_internal.reconciliation_consumers (
  application_name text NOT NULL,
  consumer_id text NOT NULL,
  xid_horizon xid8 NOT NULL,
  acknowledged_at timestamptz NOT NULL,
  PRIMARY KEY (application_name, consumer_id)
);

CREATE TABLE questpie_internal.processed_change_facts (
  application_name text NOT NULL,
  consumer_id text NOT NULL,
  fact_identity uuid NOT NULL,
  processed_at timestamptz NOT NULL,
  PRIMARY KEY (application_name, consumer_id, fact_identity),
  FOREIGN KEY (application_name, consumer_id)
    REFERENCES questpie_internal.reconciliation_consumers (application_name, consumer_id)
    ON DELETE CASCADE,
  FOREIGN KEY (application_name, fact_identity)
    REFERENCES questpie_internal.change_ledger (application_name, fact_identity)
    ON DELETE CASCADE
);

CREATE TABLE questpie_internal.retained_live_query_results (
  application_name text NOT NULL,
  token_digest text NOT NULL,
  authority_partition_digest text NOT NULL,
  deployment_digest text NOT NULL,
  query_identity text NOT NULL,
  input_digest text NOT NULL,
  wire_version integer NOT NULL,
  retained_generation bigint NOT NULL,
  result_bytes bytea NOT NULL,
  dependency_plan_bytes bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  expires_at timestamptz NOT NULL DEFAULT transaction_timestamp() + interval '24 hours',
  PRIMARY KEY (application_name, token_digest),
  CONSTRAINT retained_token_digest_sha256 CHECK (token_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT retained_authority_digest_sha256 CHECK (authority_partition_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT retained_deployment_digest_sha256 CHECK (deployment_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT retained_input_digest_sha256 CHECK (input_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT retained_wire_version_positive CHECK (wire_version > 0),
  CONSTRAINT retained_generation_positive CHECK (retained_generation > 0),
  CONSTRAINT retained_result_bytes_bounded CHECK (octet_length(result_bytes) <= 1048576),
  CONSTRAINT retained_dependency_bytes_bounded CHECK (octet_length(dependency_plan_bytes) <= 262144),
  CONSTRAINT retained_expiry_order CHECK (expires_at > created_at),
  CONSTRAINT retained_age_exact CHECK (expires_at = created_at + interval '24 hours')
);
CREATE INDEX retained_live_query_results_expiry_idx
  ON questpie_internal.retained_live_query_results (application_name, expires_at);
${internalProtocolV3RealtimeSql}

CREATE FUNCTION questpie_internal.capture_reactive_row()
RETURNS trigger LANGUAGE plpgsql
SECURITY DEFINER SET search_path = pg_catalog, questpie_internal AS $$
DECLARE
  old_doc jsonb := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END;
  new_doc jsonb := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END;
  old_key_doc jsonb := '{}'::jsonb;
  new_key_doc jsonb := '{}'::jsonb;
  key_name text;
  tx xid8 := pg_current_xact_id();
  existing_count integer;
BEGIN
  IF TG_NARGS < 3 THEN
    RAISE EXCEPTION 'invalid QUESTPIE row capture arguments';
  END IF;
  IF EXISTS (
    SELECT 1 FROM questpie_internal.change_ledger
    WHERE application_name = TG_ARGV[0]
      AND transaction_id = tx
      AND collection_identity = TG_ARGV[1]
      AND conservative
  ) THEN
    RETURN NULL;
  END IF;
  SELECT count(*) INTO existing_count
  FROM questpie_internal.change_ledger
  WHERE application_name = TG_ARGV[0]
    AND transaction_id = tx
    AND collection_identity = TG_ARGV[1];
  IF existing_count >= 16 THEN
    DELETE FROM questpie_internal.change_ledger
    WHERE application_name = TG_ARGV[0]
      AND transaction_id = tx
      AND collection_identity = TG_ARGV[1];
    INSERT INTO questpie_internal.change_ledger
      (application_name, transaction_id, collection_identity, change_kind, conservative)
    VALUES (TG_ARGV[0], tx, TG_ARGV[1], 'collection', true);
    PERFORM pg_notify('questpie_change', TG_ARGV[0]);
    RETURN NULL;
  END IF;
  FOREACH key_name IN ARRAY TG_ARGV[2:] LOOP
    IF old_doc IS NOT NULL THEN
      old_key_doc := old_key_doc || jsonb_build_object(key_name, old_doc -> key_name);
    END IF;
    IF new_doc IS NOT NULL THEN
      new_key_doc := new_key_doc || jsonb_build_object(key_name, new_doc -> key_name);
    END IF;
  END LOOP;
  INSERT INTO questpie_internal.change_ledger
    (application_name, transaction_id, collection_identity, change_kind, old_key, new_key)
  VALUES (
    TG_ARGV[0], tx, TG_ARGV[1], lower(TG_OP),
    CASE WHEN old_doc IS NULL THEN NULL ELSE old_key_doc END,
    CASE WHEN new_doc IS NULL THEN NULL ELSE new_key_doc END
  );
  PERFORM pg_notify('questpie_change', TG_ARGV[0]);
  RETURN NULL;
END;
$$;

CREATE FUNCTION questpie_internal.capture_reactive_truncate()
RETURNS trigger LANGUAGE plpgsql
SECURITY DEFINER SET search_path = pg_catalog, questpie_internal AS $$
DECLARE
  tx xid8 := pg_current_xact_id();
BEGIN
  IF TG_NARGS <> 2 THEN
    RAISE EXCEPTION 'invalid QUESTPIE truncate capture arguments';
  END IF;
  DELETE FROM questpie_internal.change_ledger
  WHERE application_name = TG_ARGV[0]
    AND transaction_id = tx
    AND collection_identity = TG_ARGV[1];
  INSERT INTO questpie_internal.change_ledger
    (application_name, transaction_id, collection_identity, change_kind, conservative)
  VALUES (TG_ARGV[0], tx, TG_ARGV[1], 'truncate', true);
  PERFORM pg_notify('questpie_change', TG_ARGV[0]);
  RETURN NULL;
END;
$$;

CREATE FUNCTION questpie_internal.stamp_retained_live_query_result()
RETURNS trigger LANGUAGE plpgsql
SECURITY DEFINER SET search_path = pg_catalog, questpie_internal AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := transaction_timestamp();
  ELSE
    NEW.created_at := OLD.created_at;
  END IF;
  NEW.expires_at := NEW.created_at + interval '24 hours';
  RETURN NEW;
END;
$$;

CREATE TRIGGER retained_live_query_result_clock
BEFORE INSERT OR UPDATE ON questpie_internal.retained_live_query_results
FOR EACH ROW EXECUTE FUNCTION questpie_internal.stamp_retained_live_query_result();

REVOKE ALL ON ALL TABLES IN SCHEMA questpie_internal FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA questpie_internal FROM PUBLIC;
REVOKE ALL ON FUNCTION questpie_internal.capture_reactive_row() FROM PUBLIC;
REVOKE ALL ON FUNCTION questpie_internal.capture_reactive_truncate() FROM PUBLIC;
REVOKE ALL ON FUNCTION questpie_internal.stamp_observed_dependency_plan() FROM PUBLIC;
REVOKE ALL ON FUNCTION questpie_internal.stamp_realtime_scope_attachment() FROM PUBLIC;
REVOKE ALL ON FUNCTION questpie_internal.stamp_realtime_watch_binding() FROM PUBLIC;
REVOKE ALL ON FUNCTION questpie_internal.stamp_realtime_binding_generation() FROM PUBLIC;
REVOKE ALL ON FUNCTION questpie_internal.stamp_retained_live_query_result() FROM PUBLIC;
`;

const internalProtocolV3Checksum = createHash("sha256")
	.update("questpie-internal-protocol-v3\0")
	.update(internalProtocolV2Checksum)
	.update("\0")
	.update(internalProtocolV3Sql)
	.digest("hex");

const tables = [
	"change_ledger",
	"processed_change_facts",
	"reconciliation_consumers",
	"retained_live_query_results",
	...internalProtocolV3RealtimeTables,
] as const;

const columns = [
	["change_ledger", "application_name", "text", true],
	["change_ledger", "fact_identity", "uuid", true],
	["change_ledger", "fact_id", "bigint", true],
	["change_ledger", "transaction_id", "xid8", true],
	["change_ledger", "collection_identity", "text", true],
	["change_ledger", "change_kind", "text", true],
	["change_ledger", "old_key", "jsonb", false],
	["change_ledger", "new_key", "jsonb", false],
	["change_ledger", "conservative", "boolean", true],
	["change_ledger", "captured_at", "timestamp with time zone", true],
	["processed_change_facts", "application_name", "text", true],
	["processed_change_facts", "consumer_id", "text", true],
	["processed_change_facts", "fact_identity", "uuid", true],
	["processed_change_facts", "processed_at", "timestamp with time zone", true],
	["reconciliation_consumers", "application_name", "text", true],
	["reconciliation_consumers", "consumer_id", "text", true],
	["reconciliation_consumers", "xid_horizon", "xid8", true],
	[
		"reconciliation_consumers",
		"acknowledged_at",
		"timestamp with time zone",
		true,
	],
	...internalProtocolV3RealtimeColumns,
	["retained_live_query_results", "application_name", "text", true],
	["retained_live_query_results", "token_digest", "text", true],
	["retained_live_query_results", "authority_partition_digest", "text", true],
	["retained_live_query_results", "deployment_digest", "text", true],
	["retained_live_query_results", "query_identity", "text", true],
	["retained_live_query_results", "input_digest", "text", true],
	["retained_live_query_results", "wire_version", "integer", true],
	["retained_live_query_results", "retained_generation", "bigint", true],
	["retained_live_query_results", "result_bytes", "bytea", true],
	["retained_live_query_results", "dependency_plan_bytes", "bytea", true],
	[
		"retained_live_query_results",
		"created_at",
		"timestamp with time zone",
		true,
	],
	[
		"retained_live_query_results",
		"expires_at",
		"timestamp with time zone",
		true,
	],
] as const;

const constraints = [
	[
		"change_ledger",
		"change_ledger_fact_shape",
		"c",
		"CHECK (conservative AND (change_kind = ANY (ARRAY['collection'::text, 'truncate'::text])) AND old_key IS NULL AND new_key IS NULL OR NOT conservative AND (change_kind = ANY (ARRAY['insert'::text, 'update'::text, 'delete'::text])))",
	],
	[
		"change_ledger",
		"change_ledger_pkey",
		"p",
		"PRIMARY KEY (application_name, fact_identity)",
	],
	[
		"processed_change_facts",
		"processed_change_facts_application_name_consumer_id_fkey",
		"f",
		"FOREIGN KEY (application_name, consumer_id) REFERENCES questpie_internal.reconciliation_consumers(application_name, consumer_id) ON DELETE CASCADE",
	],
	[
		"processed_change_facts",
		"processed_change_facts_application_name_fact_identity_fkey",
		"f",
		"FOREIGN KEY (application_name, fact_identity) REFERENCES questpie_internal.change_ledger(application_name, fact_identity) ON DELETE CASCADE",
	],
	[
		"processed_change_facts",
		"processed_change_facts_pkey",
		"p",
		"PRIMARY KEY (application_name, consumer_id, fact_identity)",
	],
	[
		"reconciliation_consumers",
		"reconciliation_consumers_pkey",
		"p",
		"PRIMARY KEY (application_name, consumer_id)",
	],
	...internalProtocolV3RealtimeConstraints,
	[
		"retained_live_query_results",
		"retained_age_exact",
		"c",
		"CHECK (expires_at = (created_at + '24:00:00'::interval))",
	],
	[
		"retained_live_query_results",
		"retained_authority_digest_sha256",
		"c",
		"CHECK (authority_partition_digest ~ '^[0-9a-f]{64}$'::text)",
	],
	[
		"retained_live_query_results",
		"retained_dependency_bytes_bounded",
		"c",
		"CHECK (octet_length(dependency_plan_bytes) <= 262144)",
	],
	[
		"retained_live_query_results",
		"retained_deployment_digest_sha256",
		"c",
		"CHECK (deployment_digest ~ '^[0-9a-f]{64}$'::text)",
	],
	[
		"retained_live_query_results",
		"retained_expiry_order",
		"c",
		"CHECK (expires_at > created_at)",
	],
	[
		"retained_live_query_results",
		"retained_generation_positive",
		"c",
		"CHECK (retained_generation > 0)",
	],
	[
		"retained_live_query_results",
		"retained_input_digest_sha256",
		"c",
		"CHECK (input_digest ~ '^[0-9a-f]{64}$'::text)",
	],
	[
		"retained_live_query_results",
		"retained_live_query_results_pkey",
		"p",
		"PRIMARY KEY (application_name, token_digest)",
	],
	[
		"retained_live_query_results",
		"retained_result_bytes_bounded",
		"c",
		"CHECK (octet_length(result_bytes) <= 1048576)",
	],
	[
		"retained_live_query_results",
		"retained_token_digest_sha256",
		"c",
		"CHECK (token_digest ~ '^[0-9a-f]{64}$'::text)",
	],
	[
		"retained_live_query_results",
		"retained_wire_version_positive",
		"c",
		"CHECK (wire_version > 0)",
	],
] as const;

const indexes = [
	[
		"change_ledger",
		"change_ledger_pkey",
		"btree",
		true,
		true,
		"CREATE UNIQUE INDEX change_ledger_pkey ON questpie_internal.change_ledger USING btree (application_name, fact_identity)",
	],
	[
		"change_ledger",
		"change_ledger_reconcile_idx",
		"btree",
		false,
		false,
		"CREATE INDEX change_ledger_reconcile_idx ON questpie_internal.change_ledger USING btree (application_name, transaction_id, collection_identity, fact_id)",
	],
	[
		"processed_change_facts",
		"processed_change_facts_pkey",
		"btree",
		true,
		true,
		"CREATE UNIQUE INDEX processed_change_facts_pkey ON questpie_internal.processed_change_facts USING btree (application_name, consumer_id, fact_identity)",
	],
	[
		"reconciliation_consumers",
		"reconciliation_consumers_pkey",
		"btree",
		true,
		true,
		"CREATE UNIQUE INDEX reconciliation_consumers_pkey ON questpie_internal.reconciliation_consumers USING btree (application_name, consumer_id)",
	],
	...internalProtocolV3RealtimeIndexes,
	[
		"retained_live_query_results",
		"retained_live_query_results_expiry_idx",
		"btree",
		false,
		false,
		"CREATE INDEX retained_live_query_results_expiry_idx ON questpie_internal.retained_live_query_results USING btree (application_name, expires_at)",
	],
	[
		"retained_live_query_results",
		"retained_live_query_results_pkey",
		"btree",
		true,
		true,
		"CREATE UNIQUE INDEX retained_live_query_results_pkey ON questpie_internal.retained_live_query_results USING btree (application_name, token_digest)",
	],
] as const;

function catalogSort(
	left: readonly unknown[],
	right: readonly unknown[],
): number {
	return compareAscii(
		canonicalBytes(left.slice(0, 2)),
		canonicalBytes(right.slice(0, 2)),
	);
}

function columnSort(
	left: readonly unknown[],
	right: readonly unknown[],
): number {
	return compareAscii(String(left[0]), String(right[0]));
}

const internalProtocolV3Catalog: InternalProtocolCatalog = Object.freeze({
	tables: Object.freeze(
		[...internalProtocolV2Catalog.tables, ...tables].sort(),
	),
	columns: Object.freeze(
		[...internalProtocolV2Catalog.columns, ...columns].sort(columnSort),
	),
	constraints: Object.freeze(
		[...internalProtocolV2Catalog.constraints, ...constraints].sort(
			catalogSort,
		),
	),
	indexes: Object.freeze(
		[...internalProtocolV2Catalog.indexes, ...indexes].sort(catalogSort),
	),
});

async function protocolRow(
	sql: SQL,
): Promise<Readonly<{ version: number; checksum: string }> | undefined> {
	const [protocol] = await sql<{ version: number; checksum: string }[]>`
		select version, checksum from questpie_internal.protocol where singleton = true
	`;
	return protocol;
}

const captureFunctionNames = [
	"capture_reactive_row",
	"capture_reactive_truncate",
	"stamp_observed_dependency_plan",
	"stamp_realtime_binding_generation",
	"stamp_realtime_scope_attachment",
	"stamp_realtime_watch_binding",
	"stamp_retained_live_query_result",
] as const;

function captureFunctionBody(
	name: (typeof captureFunctionNames)[number],
): string {
	const declaration = `CREATE FUNCTION questpie_internal.${name}()`;
	const declarationStart = internalProtocolV3Sql.indexOf(declaration);
	const bodyStart =
		internalProtocolV3Sql.indexOf("AS $$", declarationStart) + 5;
	const bodyEnd = internalProtocolV3Sql.indexOf("\n$$;", bodyStart);
	if (declarationStart < 0 || bodyStart < 5 || bodyEnd < 0)
		throw new TypeError(`internal protocol v3 function ${name} is missing`);
	return internalProtocolV3Sql.slice(bodyStart, bodyEnd + 1);
}

async function verifyCaptureFunctionCatalog(sql: SQL): Promise<void> {
	const functions = await sql<
		{
			name: string;
			body: string;
			language: string;
			returnType: string;
			argumentTypes: string;
			kind: string;
			volatility: string;
			securityDefiner: boolean;
			configuration: string[] | null;
			publicExecute: boolean;
			ownerMatches: boolean;
		}[]
	>`
		select p.proname as name,
		       p.prosrc as body,
		       l.lanname as language,
		       pg_catalog.format_type(p.prorettype, null) as "returnType",
		       pg_catalog.pg_get_function_identity_arguments(p.oid) as "argumentTypes",
		       p.prokind as kind,
		       p.provolatile as volatility,
		       p.prosecdef as "securityDefiner",
		       p.proconfig as configuration,
		       pg_catalog.has_function_privilege('public', p.oid, 'execute') as "publicExecute",
		       p.proowner = n.nspowner as "ownerMatches"
		from pg_catalog.pg_proc p
		join pg_catalog.pg_namespace n on n.oid = p.pronamespace
		join pg_catalog.pg_language l on l.oid = p.prolang
		where n.nspname = 'questpie_internal'
		order by p.proname
	`;
	const [identity] = await sql<
		{ identity: string; publicSequencePrivileges: boolean }[]
	>`
		select a.attidentity as identity,
		       pg_catalog.has_sequence_privilege('public', s.oid, 'USAGE')
		         or pg_catalog.has_sequence_privilege('public', s.oid, 'SELECT')
		         or pg_catalog.has_sequence_privilege('public', s.oid, 'UPDATE')
		         as "publicSequencePrivileges"
		from pg_catalog.pg_class c
		join pg_catalog.pg_namespace n on n.oid = c.relnamespace
		join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attname = 'fact_id'
		join pg_catalog.pg_depend d on d.refobjid = c.oid and d.refobjsubid = a.attnum and d.deptype = 'i'
		join pg_catalog.pg_class s on s.oid = d.objid and s.relkind = 'S'
		where n.nspname = 'questpie_internal' and c.relname = 'change_ledger'
	`;
	const defaults = await sql<{ name: string; expression: string }[]>`
		select a.attname as name,
		       pg_catalog.pg_get_expr(d.adbin, d.adrelid) as expression
		from pg_catalog.pg_class c
		join pg_catalog.pg_namespace n on n.oid = c.relnamespace
		join pg_catalog.pg_attribute a on a.attrelid = c.oid
		join pg_catalog.pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
		where n.nspname = 'questpie_internal' and c.relname = 'change_ledger'
		order by a.attname
	`;
	const expectedFunctions = captureFunctionNames.map((name) => ({
		name,
		body: captureFunctionBody(name),
		language: "plpgsql",
		returnType: "trigger",
		argumentTypes: "",
		kind: "f",
		volatility: "v",
		securityDefiner: true,
		configuration: ["search_path=pg_catalog, questpie_internal"],
		publicExecute: false,
		ownerMatches: true,
	}));
	const expectedDefaults = [
		{ name: "captured_at", expression: "transaction_timestamp()" },
		{ name: "conservative", expression: "false" },
		{ name: "fact_identity", expression: "gen_random_uuid()" },
	];
	if (
		canonicalBytes(functions) !== canonicalBytes(expectedFunctions) ||
		canonicalBytes(defaults) !== canonicalBytes(expectedDefaults) ||
		identity?.identity !== "a" ||
		identity.publicSequencePrivileges
	)
		return fail(
			"QP-SCHEMA-023",
			"checksumMismatch",
			"questpie.internal.v3 capture function or identity catalog changed",
		);
}

async function verifyRealtimeClockCatalog(sql: SQL): Promise<void> {
	const defaults = await sql<
		{ tableName: string; name: string; expression: string }[]
	>`
		select c.relname as "tableName", a.attname as name,
		       pg_catalog.pg_get_expr(d.adbin, d.adrelid) as expression
		from pg_catalog.pg_class c
		join pg_catalog.pg_namespace n on n.oid = c.relnamespace
		join pg_catalog.pg_attribute a on a.attrelid = c.oid
		join pg_catalog.pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
		where n.nspname = 'questpie_internal'
		  and c.relname in ('observed_dependency_plans', 'realtime_binding_generations',
		                    'realtime_scope_attachments', 'realtime_watch_bindings',
		                    'retained_live_query_results')
		order by c.relname, a.attname
	`;
	const triggers = await sql<
		{ tableName: string; name: string; enabled: string; definition: string }[]
	>`
		select c.relname as "tableName", t.tgname as name, t.tgenabled as enabled,
		       pg_catalog.pg_get_triggerdef(t.oid, true) as definition
		from pg_catalog.pg_trigger t
		join pg_catalog.pg_class c on c.oid = t.tgrelid
		join pg_catalog.pg_namespace n on n.oid = c.relnamespace
		where n.nspname = 'questpie_internal' and not t.tgisinternal
		order by c.relname, t.tgname
	`;
	const expectedDefaults = [
		["observed_dependency_plans", "replaced_at", "transaction_timestamp()"],
		["realtime_binding_generations", "created_at", "transaction_timestamp()"],
		[
			"realtime_scope_attachments",
			"expires_at",
			"(transaction_timestamp() + '00:00:30'::interval)",
		],
		["realtime_scope_attachments", "holder_generation", "1"],
		["realtime_scope_attachments", "opened_at", "transaction_timestamp()"],
		["realtime_scope_attachments", "renewed_at", "transaction_timestamp()"],
		["realtime_watch_bindings", "evaluated_invalidation_generation", "0"],
		["realtime_watch_bindings", "invalidated_at", "transaction_timestamp()"],
		["realtime_watch_bindings", "invalidation_generation", "1"],
		["realtime_watch_bindings", "opened_at", "transaction_timestamp()"],
		["retained_live_query_results", "created_at", "transaction_timestamp()"],
		[
			"retained_live_query_results",
			"expires_at",
			"(transaction_timestamp() + '24:00:00'::interval)",
		],
	].map(([tableName, name, expression]) => ({ tableName, name, expression }));
	const expectedTriggers = [
		[
			"observed_dependency_plans",
			"observed_dependency_plan_clock",
			"stamp_observed_dependency_plan",
		],
		[
			"realtime_binding_generations",
			"realtime_binding_generation_clock",
			"stamp_realtime_binding_generation",
		],
		[
			"realtime_scope_attachments",
			"realtime_scope_attachment_clock",
			"stamp_realtime_scope_attachment",
		],
		[
			"realtime_watch_bindings",
			"realtime_watch_binding_clock",
			"stamp_realtime_watch_binding",
		],
		[
			"retained_live_query_results",
			"retained_live_query_result_clock",
			"stamp_retained_live_query_result",
		],
	].map(([tableName, name, functionName]) => ({
		tableName,
		name,
		enabled: "O",
		definition: `CREATE TRIGGER ${name} BEFORE INSERT OR UPDATE ON questpie_internal.${tableName} FOR EACH ROW EXECUTE FUNCTION questpie_internal.${functionName}()`,
	}));
	if (
		canonicalBytes(defaults) !== canonicalBytes(expectedDefaults) ||
		canonicalBytes(triggers) !== canonicalBytes(expectedTriggers)
	)
		return fail(
			"QP-SCHEMA-023",
			"checksumMismatch",
			"questpie.internal.v3 realtime clock catalog changed",
		);
}

export async function verifyInternalProtocolV3(sql: SQL): Promise<void> {
	const protocol = await protocolRow(sql);
	if (
		protocol?.version !== 3 ||
		protocol.checksum !== internalProtocolV3Checksum
	)
		return fail(
			"QP-SCHEMA-023",
			"checksumMismatch",
			"questpie.internal protocol v3 is not installed",
		);
	await verifyInternalProtocolCatalog(sql, internalProtocolV3Catalog, protocol);
	await verifyCaptureFunctionCatalog(sql);
	await verifyRealtimeClockCatalog(sql);
}

export async function ensureInternalProtocolV3(
	sql: SQL,
	databaseName: string,
	expectedPid: number,
	control: PostgresControl,
	signal?: AbortSignal,
): Promise<void> {
	await assertBackendPid(sql, expectedPid, "before internal protocol v3");
	const [namespace] = await sql<{ exists: boolean }[]>`
		select exists(select 1 from pg_catalog.pg_namespace where nspname = 'questpie_internal') as exists
	`;
	if (!namespace?.exists)
		await ensureInternalProtocolV2(
			sql,
			databaseName,
			expectedPid,
			control,
			signal,
		);
	else {
		const protocol = await protocolRow(sql);
		if (protocol?.version === 1)
			await ensureInternalProtocolV2(
				sql,
				databaseName,
				expectedPid,
				control,
				signal,
			);
	}

	const key = lockKey("questpie-internal-protocol-lock-v3", databaseName);
	await acquireSessionLock(sql, key, control, signal);
	try {
		await assertBackendPid(sql, expectedPid, "internal protocol v3 lock");
		const protocol = await protocolRow(sql);
		if (
			protocol?.version === 3 &&
			protocol.checksum === internalProtocolV3Checksum
		) {
			await verifyInternalProtocolV3(sql);
			return;
		}
		if (
			protocol?.version !== 2 ||
			protocol.checksum !== internalProtocolV2Checksum
		)
			return fail(
				"QP-SCHEMA-023",
				"checksumMismatch",
				"questpie.internal protocol is missing, changed, or unsupported",
			);
		await withPinnedTransaction(
			sql,
			expectedPid,
			"internal protocol v3 upgrade",
			signal,
			async (transaction) => {
				await verifyInternalProtocolCatalog(
					transaction,
					internalProtocolV2Catalog,
					protocol,
				);
				await transaction.unsafe(internalProtocolV3Sql);
				await transaction`
				update questpie_internal.protocol set version = 3, checksum = ${internalProtocolV3Checksum}
				where singleton = true
			`;
				await verifyInternalProtocolV3(transaction);
			},
		);
	} finally {
		await assertBackendPid(sql, expectedPid, "internal protocol v3 unlock");
		await sql`select pg_catalog.pg_advisory_unlock(${key})`;
	}
}

export { internalProtocolV3Checksum, internalProtocolV3Sql };
