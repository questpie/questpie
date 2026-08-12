import assert from "node:assert/strict";

import {
	candidateInvariant,
	evaluateExpression,
	lowerPolicyExpression,
	membershipPolicyProgram,
	messageReadRows,
	updateRows,
} from "./p2-goldens.mjs";

const PROOF_SCHEMA = "questpie_p2_context_policy_proof";

function command(args, options = {}) {
	const result = Bun.spawnSync(args, {
		stdout: "pipe",
		stderr: "pipe",
		...options,
	});
	const stdout = result.stdout.toString();
	const stderr = result.stderr.toString();
	assert.equal(result.exitCode, 0, `${stdout}\n${stderr}`);
	return stdout;
}

function discoverPostgres() {
	const explicit = process.env.QUESTPIE_P2_POSTGRES_CONTAINER;
	const container =
		explicit ??
		command([
			"docker",
			"ps",
			"--filter",
			"ancestor=postgres:17",
			"--format",
			"{{.Names}}",
		])
			.trim()
			.split("\n")
			.find(Boolean);
	assert.ok(container, "A running PostgreSQL 17 Docker container is required");
	const environment = command([
		"docker",
		"inspect",
		"--format",
		"{{range .Config.Env}}{{println .}}{{end}}",
		container,
	]);
	const value = (name) =>
		environment
			.split("\n")
			.find((line) => line.startsWith(`${name}=`))
			?.slice(name.length + 1);
	const user = value("POSTGRES_USER");
	const database = value("POSTGRES_DB");
	assert.ok(user);
	assert.ok(database);
	return { container, user, database };
}

function psqlArgs(postgres, ...extra) {
	return [
		"docker",
		"exec",
		"-i",
		postgres.container,
		"psql",
		"-U",
		postgres.user,
		"-d",
		postgres.database,
		"-X",
		"-v",
		"ON_ERROR_STOP=1",
		...extra,
	];
}

function psql(postgres, sql, tuplesOnly = true) {
	const args = psqlArgs(postgres);
	if (tuplesOnly) args.push("-A", "-t", "-q");
	return command(args, { stdin: new Blob([sql]) }).trim();
}

const setupSql = `
DROP SCHEMA IF EXISTS ${PROOF_SCHEMA} CASCADE;
CREATE SCHEMA ${PROOF_SCHEMA};

CREATE TABLE ${PROOF_SCHEMA}.companies (
  id text COLLATE "C" NOT NULL,
  name text COLLATE "C" NOT NULL,
  CONSTRAINT companies_primary PRIMARY KEY (id)
);
CREATE TABLE ${PROOF_SCHEMA}.spaces (
  id text COLLATE "C" NOT NULL,
  company_id text COLLATE "C" NOT NULL,
  name text COLLATE "C" NOT NULL,
  CONSTRAINT spaces_primary PRIMARY KEY (id),
  CONSTRAINT spaces_company_fk FOREIGN KEY (company_id)
    REFERENCES ${PROOF_SCHEMA}.companies (id)
);
CREATE TABLE ${PROOF_SCHEMA}.channels (
  id text COLLATE "C" NOT NULL,
  space_id text COLLATE "C" NOT NULL,
  visibility text COLLATE "C" NOT NULL,
  name text COLLATE "C" NOT NULL,
  CONSTRAINT channels_primary PRIMARY KEY (id),
  CONSTRAINT channels_space_fk FOREIGN KEY (space_id)
    REFERENCES ${PROOF_SCHEMA}.spaces (id)
);
CREATE TABLE ${PROOF_SCHEMA}.memberships (
  company_id text COLLATE "C" NOT NULL,
  principal_id text COLLATE "C" NOT NULL,
  scope_key text COLLATE "C" NOT NULL,
  status text COLLATE "C" NOT NULL,
  role text COLLATE "C" NOT NULL,
  can_post boolean NOT NULL,
  CONSTRAINT memberships_primary
    PRIMARY KEY (company_id, principal_id, scope_key)
);
CREATE TABLE ${PROOF_SCHEMA}.messages (
  id text COLLATE "C" NOT NULL,
  company_id text COLLATE "C" NOT NULL,
  channel_id text COLLATE "C" NOT NULL,
  author_id text COLLATE "C" NOT NULL,
  body text COLLATE "C" NOT NULL,
  moderation_note text COLLATE "C",
  created_at timestamptz NOT NULL,
  CONSTRAINT messages_primary PRIMARY KEY (id),
  CONSTRAINT messages_channel_fk FOREIGN KEY (channel_id)
    REFERENCES ${PROOF_SCHEMA}.channels (id)
);

CREATE INDEX spaces_company_id_idx
  ON ${PROOF_SCHEMA}.spaces (company_id, id);
CREATE INDEX channels_space_id_idx
  ON ${PROOF_SCHEMA}.channels (space_id, id);
CREATE INDEX memberships_evidence_idx
  ON ${PROOF_SCHEMA}.memberships
    (company_id, principal_id, scope_key, status, role);
CREATE INDEX messages_channel_created_idx
  ON ${PROOF_SCHEMA}.messages (channel_id, created_at DESC, id ASC);

CREATE TABLE ${PROOF_SCHEMA}.archives (
  code text COLLATE "C" NOT NULL,
  title text COLLATE "C" NOT NULL,
  CONSTRAINT archives_primary PRIMARY KEY (code)
);
CREATE TABLE ${PROOF_SCHEMA}.archive_records (
  archive_code text COLLATE "C" NOT NULL,
  catalogue_number text COLLATE "C" NOT NULL,
  visibility text COLLATE "C" NOT NULL,
  title text COLLATE "C" NOT NULL,
  sealed_note text COLLATE "C",
  CONSTRAINT archive_records_primary
    PRIMARY KEY (archive_code, catalogue_number),
  CONSTRAINT archive_records_archive_fk FOREIGN KEY (archive_code)
    REFERENCES ${PROOF_SCHEMA}.archives (code)
);
CREATE TABLE ${PROOF_SCHEMA}.research_permits (
  programme_code text COLLATE "C" NOT NULL,
  archive_code text COLLATE "C" NOT NULL,
  principal_id text COLLATE "C" NOT NULL,
  status text COLLATE "C" NOT NULL,
  may_view_sealed boolean NOT NULL,
  CONSTRAINT research_permits_primary
    PRIMARY KEY (programme_code, archive_code, principal_id)
);

INSERT INTO ${PROOF_SCHEMA}.companies (id, name) VALUES
  ('company-northwind', 'Northwind'),
  ('company-contoso', 'Contoso');
INSERT INTO ${PROOF_SCHEMA}.spaces (id, company_id, name) VALUES
  ('space-northwind', 'company-northwind', 'Northwind space'),
  ('space-contoso', 'company-contoso', 'Contoso space');
INSERT INTO ${PROOF_SCHEMA}.channels (id, space_id, visibility, name) VALUES
  ('channel-company', 'space-northwind', 'company', 'Company'),
  ('channel-private', 'space-northwind', 'private', 'Private'),
  ('channel-foreign', 'space-contoso', 'company', 'Foreign');
INSERT INTO ${PROOF_SCHEMA}.memberships
  (company_id, principal_id, scope_key, status, role, can_post) VALUES
  ('company-northwind', 'principal-alice', 'company', 'active', 'member', true),
  ('company-northwind', 'principal-alice', 'channel-private', 'active', 'member', true),
  ('company-northwind', 'principal-bob', 'company', 'active', 'member', true),
  ('company-northwind', 'principal-moderator', 'company', 'active', 'moderator', true),
  ('company-contoso', 'principal-carol', 'company', 'active', 'owner', true);
INSERT INTO ${PROOF_SCHEMA}.messages
  (id, company_id, channel_id, author_id, body, moderation_note, created_at) VALUES
  ('message-author', 'company-northwind', 'channel-private', 'principal-alice', 'author', 'own note', '2026-08-13T12:04:00Z'),
  ('message-other', 'company-northwind', 'channel-private', 'principal-bob', 'other', 'hidden note', '2026-08-13T12:03:00Z'),
  ('message-lock', 'company-northwind', 'channel-company', 'principal-bob', 'locked', 'lock note', '2026-08-13T12:02:00Z'),
  ('message-foreign', 'company-contoso', 'channel-foreign', 'principal-carol', 'foreign', 'foreign note', '2026-08-13T12:01:00Z');
INSERT INTO ${PROOF_SCHEMA}.messages
  (id, company_id, channel_id, author_id, body, moderation_note, created_at)
SELECT
  'bulk-private-' || value,
  'company-northwind',
  'channel-private',
  CASE WHEN value % 2 = 0 THEN 'principal-alice' ELSE 'principal-bob' END,
  'body-' || value,
  'note-' || value,
  '2026-01-01T00:00:00Z'::timestamptz - (value || ' seconds')::interval
FROM generate_series(1, 1000) AS value;
INSERT INTO ${PROOF_SCHEMA}.messages
  (id, company_id, channel_id, author_id, body, moderation_note, created_at)
SELECT
  'bulk-foreign-' || value,
  'company-contoso',
  'channel-foreign',
  'principal-carol',
  'foreign-' || value,
  'foreign-note-' || value,
  '2026-01-01T00:00:00Z'::timestamptz - (value || ' seconds')::interval
FROM generate_series(1, 19000) AS value;

INSERT INTO ${PROOF_SCHEMA}.archives (code, title) VALUES
  ('national', 'National Archive'),
  ('city', 'City Archive');
INSERT INTO ${PROOF_SCHEMA}.archive_records
  (archive_code, catalogue_number, visibility, title, sealed_note) VALUES
  ('national', 'N-001', 'public', 'Public charter', null),
  ('national', 'N-002', 'restricted', 'Restricted charter', 'sealed'),
  ('city', 'C-001', 'restricted', 'City record', 'city sealed');
INSERT INTO ${PROOF_SCHEMA}.research_permits
  (programme_code, archive_code, principal_id, status, may_view_sealed) VALUES
  ('programme-linguistics', 'national', 'principal-alice', 'active', true),
  ('programme-history', 'city', 'principal-bob', 'revoked', false);

ANALYZE ${PROOF_SCHEMA}.companies;
ANALYZE ${PROOF_SCHEMA}.spaces;
ANALYZE ${PROOF_SCHEMA}.channels;
ANALYZE ${PROOF_SCHEMA}.memberships;
ANALYZE ${PROOF_SCHEMA}.messages;
ANALYZE ${PROOF_SCHEMA}.archives;
ANALYZE ${PROOF_SCHEMA}.archive_records;
ANALYZE ${PROOF_SCHEMA}.research_permits;
`;

function planNodes(plan, output = []) {
	output.push({
		nodeType: plan["Node Type"],
		indexName: plan["Index Name"] ?? null,
		actualRows: plan["Actual Rows"] ?? null,
	});
	for (const child of plan.Plans ?? []) planNodes(child, output);
	return output;
}

function parseJson(output) {
	return JSON.parse(output);
}

async function lockRecheck(postgres) {
	const principal = "principal-moderator";
	const tenant = "company-northwind";
	const currentScope = lowerPolicyExpression(updateRows, {
		schema: PROOF_SCHEMA,
		aliases: { current: "m" },
		facts: {
			principal: { id: principal, kind: "user" },
			tenant: { id: tenant },
			authority: { kind: "ordinary" },
		},
	});
	const lockerSql = `
SET search_path TO ${PROOF_SCHEMA}, public;
BEGIN;
UPDATE messages SET body = body WHERE id = 'message-lock';
UPDATE memberships
SET status = 'revoked'
WHERE company_id = 'company-northwind'
  AND principal_id = 'principal-moderator'
  AND scope_key = 'company';
SELECT pg_sleep(1.2);
COMMIT;
`;
	const contenderSql = `
SET statement_timeout = '5s';
SET search_path TO ${PROOF_SCHEMA}, public;
BEGIN;
SELECT 'locked=' || count(*)
FROM (
  SELECT m.id
  FROM messages AS m
  WHERE m.id = 'message-lock'
    AND ${currentScope}
  FOR UPDATE
) AS locked_rows;
WITH changed AS (
  UPDATE messages AS m
  SET body = 'must-not-commit'
  WHERE m.id = 'message-lock'
    AND ${currentScope}
  RETURNING m.id
)
SELECT 'changed=' || count(*) FROM changed;
ROLLBACK;
`;
	const locker = Bun.spawn(psqlArgs(postgres, "-A", "-t", "-q"), {
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
	});
	locker.stdin.write(lockerSql);
	locker.stdin.end();
	await Bun.sleep(250);
	const contenderStarted = performance.now();
	const contender = psql(postgres, contenderSql);
	const waitedMilliseconds = performance.now() - contenderStarted;
	const lockerExit = await locker.exited;
	const lockerOutput = await new Response(locker.stdout).text();
	const lockerError = await new Response(locker.stderr).text();
	assert.equal(lockerExit, 0, `${lockerOutput}\n${lockerError}`);
	const contenderLines = contender.split("\n");
	assert.ok(contenderLines.includes("locked=1"));
	assert.ok(contenderLines.includes("changed=0"));
	assert.ok(
		waitedMilliseconds >= 700,
		`lock wait was only ${waitedMilliseconds}ms`,
	);
	const body = psql(
		postgres,
		`SELECT body FROM ${PROOF_SCHEMA}.messages WHERE id = 'message-lock';`,
	);
	assert.equal(body, "locked");
	psql(
		postgres,
		`UPDATE ${PROOF_SCHEMA}.memberships SET status = 'active'
     WHERE company_id = 'company-northwind'
       AND principal_id = 'principal-moderator'
       AND scope_key = 'company';`,
	);
	return {
		waitedMilliseconds: Math.round(waitedMilliseconds),
		rowsChangedAfterRecheck: 0,
		bodyAfterAttempt: body,
		membershipRevocationWon: true,
	};
}

export async function runPostgresProof() {
	const postgres = discoverPostgres();
	const version = psql(postgres, "SELECT version();");
	assert.match(version, /^PostgreSQL 17\./);
	assert.equal(/\bUSING\b/i.test(setupSql), false);
	assert.equal(/\b(?:GIN|GiST|SP-GiST|BRIN|HASH)\b/i.test(setupSql), false);
	try {
		psql(postgres, setupSql, false);
		const indexes = parseJson(
			psql(
				postgres,
				`SELECT coalesce(json_agg(item ORDER BY item->>'name'), '[]'::json)
         FROM (
           SELECT json_build_object(
             'name', index_class.relname,
             'accessMethod', access_method.amname,
             'expression', index_row.indexprs IS NOT NULL,
             'predicate', index_row.indpred IS NOT NULL
           ) AS item
           FROM pg_index AS index_row
           JOIN pg_class AS index_class ON index_class.oid = index_row.indexrelid
           JOIN pg_class AS table_class ON table_class.oid = index_row.indrelid
           JOIN pg_namespace AS namespace ON namespace.oid = table_class.relnamespace
           JOIN pg_am AS access_method ON access_method.oid = index_class.relam
           WHERE namespace.nspname = '${PROOF_SCHEMA}'
         ) AS indexes;`,
			),
		);
		assert.ok(indexes.length >= 10);
		assert.equal(
			indexes.every((item) => item.accessMethod === "btree"),
			true,
		);
		assert.equal(
			indexes.every((item) => item.expression === false),
			true,
		);
		assert.equal(
			indexes.every((item) => item.predicate === false),
			true,
		);

		const facts = {
			principal: { kind: "user", id: "principal-alice" },
			tenant: { id: "company-northwind" },
			authority: { kind: "ordinary" },
		};
		const predicate = lowerPolicyExpression(messageReadRows, {
			schema: PROOF_SCHEMA,
			aliases: { row: "m" },
			facts,
		});
		const pageRows = parseJson(
			psql(
				postgres,
				`SELECT coalesce(json_agg(row_to_json(page_row)), '[]'::json)
         FROM (
           SELECT
             m.id,
             m.body,
             m.author_id = 'principal-alice' COLLATE "C" AS allow_moderation_note,
             CASE WHEN m.author_id = 'principal-alice' COLLATE "C"
               THEN m.moderation_note ELSE NULL END AS guarded_moderation_note,
             m.created_at
           FROM ${PROOF_SCHEMA}.messages AS m
           WHERE ${predicate}
             AND m.channel_id = 'channel-private' COLLATE "C"
           ORDER BY m.created_at DESC NULLS LAST, m.id ASC
           LIMIT 3
         ) AS page_row;`,
			),
		);
		assert.deepEqual(
			pageRows.map((row) => row.id),
			["message-author", "message-other", "bulk-private-1"],
		);
		const encodedRows = pageRows.slice(0, 2).map((row) => {
			const output = { id: row.id, body: row.body };
			if (row.allow_moderation_note) {
				output.moderationNote = row.guarded_moderation_note;
			}
			return output;
		});
		assert.deepEqual(encodedRows, [
			{ id: "message-author", body: "author", moderationNote: "own note" },
			{ id: "message-other", body: "other" },
		]);

		const visibleCount = Number(
			psql(
				postgres,
				`SELECT count(*) FROM ${PROOF_SCHEMA}.messages AS m
         WHERE ${predicate}
           AND m.channel_id = 'channel-private' COLLATE "C";`,
			),
		);
		assert.equal(visibleCount, 1002);
		assert.equal(
			pageRows.length,
			3,
			"first + 1 sentinel used the same Policy scope",
		);
		const boundaryPage = parseJson(
			psql(
				postgres,
				`SELECT coalesce(json_agg(id ORDER BY created_at DESC, id ASC), '[]'::json)
	         FROM (
	           SELECT m.id, m.created_at
	           FROM ${PROOF_SCHEMA}.messages AS m
	           WHERE ${predicate}
	             AND m.channel_id = 'channel-private' COLLATE "C"
	             AND (
	               m.created_at < (
	                 SELECT created_at FROM ${PROOF_SCHEMA}.messages
	                 WHERE id = 'bulk-private-999' COLLATE "C"
	               )
	               OR (
	                 m.created_at = (
	                   SELECT created_at FROM ${PROOF_SCHEMA}.messages
	                   WHERE id = 'bulk-private-999' COLLATE "C"
	                 )
	                 AND m.id > 'bulk-private-999' COLLATE "C"
	               )
	             )
	           ORDER BY m.created_at DESC NULLS LAST, m.id ASC
	           LIMIT 3
	         ) AS boundary_page;`,
			),
		);
		assert.deepEqual(boundaryPage, ["bulk-private-1000"]);

		const keyed = (id) =>
			Number(
				psql(
					postgres,
					`SELECT count(*) FROM ${PROOF_SCHEMA}.messages AS m
           WHERE m.id = '${id}' COLLATE "C" AND ${predicate};`,
				),
			);
		assert.equal(keyed("message-missing"), 0);
		assert.equal(keyed("message-foreign"), 0);
		const differentialStore = {
			"collection:companies": [
				{ id: "company-northwind" },
				{ id: "company-contoso" },
			],
			"collection:spaces": [
				{ id: "space-northwind", companyId: "company-northwind" },
				{ id: "space-contoso", companyId: "company-contoso" },
			],
			"collection:channels": [
				{
					id: "channel-private",
					spaceId: "space-northwind",
					visibility: "private",
				},
				{
					id: "channel-foreign",
					spaceId: "space-contoso",
					visibility: "company",
				},
			],
			"collection:memberships": [
				{
					companyId: "company-northwind",
					principalId: "principal-alice",
					scopeKey: "company",
					status: "active",
				},
				{
					companyId: "company-northwind",
					principalId: "principal-alice",
					scopeKey: "channel-private",
					status: "active",
				},
			],
		};
		const differentialRows = [
			{
				id: "message-author",
				companyId: "company-northwind",
				channelId: "channel-private",
			},
			{
				id: "message-other",
				companyId: "company-northwind",
				channelId: "channel-private",
			},
			{
				id: "message-foreign",
				companyId: "company-contoso",
				channelId: "channel-foreign",
			},
		];
		const differential = Object.fromEntries(
			differentialRows.map((row) => {
				const interpreted = evaluateExpression(messageReadRows, {
					execution: facts,
					store: differentialStore,
					scopes: { row },
				});
				const sql = keyed(row.id) === 1;
				assert.equal(sql, interpreted, `Policy SQL mismatch for ${row.id}`);
				return [row.id, { interpreted, sql }];
			}),
		);

		const membershipDisclosurePredicate = lowerPolicyExpression(
			membershipPolicyProgram.operations.read.rows,
			{
				schema: PROOF_SCHEMA,
				aliases: { row: "membership_row" },
				facts,
			},
		);
		const membershipDisclosure = Number(
			psql(
				postgres,
				`SELECT count(*) FROM ${PROOF_SCHEMA}.memberships AS membership_row
	         WHERE ${membershipDisclosurePredicate};`,
			),
		);
		assert.equal(membershipDisclosure, 0);
		assert.ok(
			visibleCount > 0,
			"boolean evidence remained usable without disclosure",
		);

		const candidatePredicate = lowerPolicyExpression(candidateInvariant, {
			schema: PROOF_SCHEMA,
			aliases: { current: "current_row", candidate: "candidate_row" },
			facts,
		});
		const candidateRows = parseJson(
			psql(
				postgres,
				`SELECT json_build_object(
	           'allowed', count(*) FILTER (WHERE candidate_row.label = 'allowed'),
	           'denied', count(*) FILTER (WHERE candidate_row.label = 'denied')
	         )
	         FROM ${PROOF_SCHEMA}.messages AS current_row
	         CROSS JOIN (VALUES
	           ('allowed', 'company-northwind', 'channel-private', 'principal-alice'),
	           ('denied', 'company-contoso', 'channel-foreign', 'principal-alice')
	         ) AS candidate_row(label, company_id, channel_id, author_id)
	         WHERE current_row.id = 'message-author' COLLATE "C"
	           AND ${candidatePredicate};`,
			),
		);
		assert.deepEqual(candidateRows, { allowed: 1, denied: 0 });

		const plan = parseJson(
			psql(
				postgres,
				`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
         SELECT m.id, m.body
         FROM ${PROOF_SCHEMA}.messages AS m
         WHERE ${predicate}
           AND m.channel_id = 'channel-private' COLLATE "C"
         ORDER BY m.created_at DESC NULLS LAST, m.id ASC
         LIMIT 3;`,
			),
		)[0];
		const nodes = planNodes(plan.Plan);
		assert.ok(
			nodes.some((node) => node.indexName === "messages_channel_created_idx"),
			`expected messages_channel_created_idx in ${JSON.stringify(nodes)}`,
		);

		const archiveRowsForAlice = parseJson(
			psql(
				postgres,
				`SELECT coalesce(json_agg(catalogue_number ORDER BY catalogue_number), '[]'::json)
         FROM ${PROOF_SCHEMA}.archive_records AS record
         WHERE record.visibility = 'public' COLLATE "C"
            OR EXISTS (
              SELECT 1 FROM ${PROOF_SCHEMA}.research_permits AS permit
              WHERE permit.programme_code = 'programme-linguistics' COLLATE "C"
                AND permit.archive_code = record.archive_code
                AND permit.principal_id = 'principal-alice' COLLATE "C"
                AND permit.status = 'active' COLLATE "C"
            );`,
			),
		);
		assert.deepEqual(archiveRowsForAlice, ["N-001", "N-002"]);
		const archiveCompositeKey = Number(
			psql(
				postgres,
				`SELECT count(*) FROM ${PROOF_SCHEMA}.archive_records
         WHERE archive_code = 'national' COLLATE "C"
           AND catalogue_number = 'N-002' COLLATE "C";`,
			),
		);
		assert.equal(archiveCompositeKey, 1);

		const lock = await lockRecheck(postgres);

		const databaseSecurity = parseJson(
			psql(
				postgres,
				`SELECT json_build_object(
           'rlsEnabledTables', count(*) FILTER (WHERE table_class.relrowsecurity),
           'policyRows', (
             SELECT count(*) FROM pg_policy AS policy_row
             JOIN pg_class AS policy_table ON policy_table.oid = policy_row.polrelid
             JOIN pg_namespace AS policy_namespace ON policy_namespace.oid = policy_table.relnamespace
             WHERE policy_namespace.nspname = '${PROOF_SCHEMA}'
           )
         )
         FROM pg_class AS table_class
         JOIN pg_namespace AS namespace ON namespace.oid = table_class.relnamespace
         WHERE namespace.nspname = '${PROOF_SCHEMA}'
           AND table_class.relkind = 'r';`,
			),
		);
		assert.deepEqual(databaseSecurity, { rlsEnabledTables: 0, policyRows: 0 });

		return {
			postgres: {
				version,
				container: postgres.container,
			},
			indexes: {
				count: indexes.length,
				allBtree: true,
				noExpressions: true,
				noPredicates: true,
			},
			plan: {
				planningMilliseconds: plan["Planning Time"],
				executionMilliseconds: plan["Execution Time"],
				nodes,
			},
			rowScope: {
				visibleCount,
				pageRows: pageRows.length,
				first: 2,
				sentinel: pageRows[2].id,
				boundaryPage,
				boundaryHasSentinel: boundaryPage.length > 2,
				missingKeyRows: keyed("message-missing"),
				invisibleKeyRows: keyed("message-foreign"),
			},
			output: encodedRows,
			evidenceVsDisclosure: {
				evidenceAuthorizedMessageCount: visibleCount,
				disclosedMembershipCount: membershipDisclosure,
			},
			differential,
			candidate: {
				allowedSameScopeRows: candidateRows.allowed,
				unauthorizedMoveRows: candidateRows.denied,
			},
			lock,
			secondDomain: {
				fixture: "archive-record-permit",
				compositeKey: ["archiveCode", "catalogueNumber"],
				idField: false,
				aliceCatalogueNumbers: archiveRowsForAlice,
			},
			databaseSecurity: {
				...databaseSecurity,
				rlsClaimEmitted: false,
			},
		};
	} finally {
		psql(postgres, `DROP SCHEMA IF EXISTS ${PROOF_SCHEMA} CASCADE;`, false);
	}
}

if (import.meta.main) {
	console.log(JSON.stringify(await runPostgresProof(), null, 2));
	console.log("P2 PostgreSQL Policy pushdown proof: pass");
}
