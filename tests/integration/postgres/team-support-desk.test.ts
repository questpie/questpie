import { afterAll, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { SQL } from "bun";

import type {
	DurableRunView,
	GeneratedApp,
	GeneratedDurable,
	GeneratedJobs,
} from "../../../fixtures/team-support-desk/.questpie/generated/app";
import {
	supportAuthCredentials,
	supportPersonas,
	supportTracerIds,
} from "../../../fixtures/team-support-desk/tracer/constants";
import {
	CleanupStack,
	eventually,
	waitForOutputLine,
} from "../../../packages/testkit/src";
import {
	installOpenTelemetryForTracer,
	installQuestpieForTracer,
	installReactForTracer,
} from "../../support/beta12-packed-questpie";
import {
	callCurrentProtocolMcp,
	currentProtocolMcpRequest,
	type CurrentProtocolMcpCall,
} from "../../support/mcp-2026-07-28-client";
import { normalizeOtlpSpanGraph } from "../../support/otel-protobuf";

const repositoryRoot = resolve(import.meta.dir, "../../..");
const fixtureRoot = resolve(repositoryRoot, "fixtures/team-support-desk");
const cli = resolve(repositoryRoot, "packages/questpie/dist/cli.js");
const database = process.env.PGHOST ? new SQL({ max: 2 }) : undefined;
const postgresTest = process.env.PGHOST ? test : test.skip;
const receiverOrigin = "http://127.0.0.1:43121";
const integrationKey = "team-support-desk-local-integration-key-v1";
const webhookSecret = "team-support-local-webhook-signing-key-v1";
const firefoxBinary = process.env.FIREFOX_BIN ?? "/usr/bin/firefox";

function postgresUrl(): string {
	const url = new URL("postgres://localhost/");
	url.hostname = process.env.PGHOST ?? "127.0.0.1";
	url.port = process.env.PGPORT ?? "5432";
	url.username = process.env.PGUSER ?? "postgres";
	url.pathname = `/${process.env.PGDATABASE ?? "postgres"}`;
	if (process.env.PGPASSWORD) url.password = process.env.PGPASSWORD;
	return url.toString();
}

function postgresIdentifier(value: string): string {
	return `"${value.replaceAll('"', '""')}"`;
}

function runCli(root: string, arguments_: readonly string[]): string {
	const result = Bun.spawnSync(["bun", cli, ...arguments_], {
		cwd: root,
		env: { ...process.env, DATABASE_URL: postgresUrl() },
		stdout: "pipe",
		stderr: "pipe",
	});
	expect(
		result.exitCode,
		`${arguments_.join(" ")}\n${result.stdout.toString()}${result.stderr.toString()}`,
	).toBe(0);
	return result.stdout.toString();
}

function runFixtureScript(root: string, name: string): string {
	const result = Bun.spawnSync(["bun", "run", name], {
		cwd: root,
		env: { ...process.env, DATABASE_URL: postgresUrl() },
		stdout: "pipe",
		stderr: "pipe",
	});
	expect(
		result.exitCode,
		`${name}\n${result.stdout.toString()}${result.stderr.toString()}`,
	).toBe(0);
	return result.stdout.toString();
}

type Child = Bun.Subprocess<"ignore", "pipe", "pipe">;
async function stop(child: Child, signal: NodeJS.Signals): Promise<void> {
	if (child.exitCode !== null) return;
	child.kill(signal);
	await child.exited;
}

type Host = Readonly<{
	child: Child;
	port: number;
	receiverPort: number;
	stderr: Promise<string>;
}>;

async function startHost(
	root: string,
	port: number,
	worker: Readonly<{
		attemptDeadlineMilliseconds: number;
		heartbeatMilliseconds: number;
		leaseMilliseconds: number;
		pause?: boolean;
	}>,
	telemetryEndpoint?: string,
): Promise<Host> {
	const child = Bun.spawn(["bun", "tracer/host.ts", `--port=${port}`], {
		cwd: root,
		env: {
			...process.env,
			DATABASE_URL: postgresUrl(),
			QUESTPIE_TRACER_WORKER_ATTEMPT_DEADLINE_MILLISECONDS: String(
				worker.attemptDeadlineMilliseconds,
			),
			QUESTPIE_TRACER_WORKER_HEARTBEAT_MILLISECONDS: String(
				worker.heartbeatMilliseconds,
			),
			QUESTPIE_TRACER_WORKER_LEASE_MILLISECONDS: String(
				worker.leaseMilliseconds,
			),
			...(worker.pause === true ? { QUESTPIE_TRACER_PAUSE_WORKER: "1" } : {}),
			...(telemetryEndpoint === undefined
				? {}
				: {
						QUESTPIE_TRACER_OPENTELEMETRY: "1",
						OTEL_EXPORTER_OTLP_ENDPOINT: telemetryEndpoint,
						OTEL_METRICS_EXPORTER: "none",
						OTEL_TRACES_EXPORTER: "otlp",
					}),
		},
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});
	const stderr = new Response(child.stderr).text();
	let line: string;
	try {
		line = await waitForOutputLine(child.stdout, {
			accept: (candidate) => candidate.includes('"event":"ready"'),
			description: "Team Support Desk host readiness",
			timeoutMilliseconds: 30_000,
		});
	} catch (error) {
		throw new Error(
			`Team Support Desk host failed readiness: ${(await stderr).trim()}`,
			{
				cause: error,
			},
		);
	}
	const ready = JSON.parse(line) as Readonly<{
		port?: unknown;
		receiverPort?: unknown;
	}>;
	if (
		!Number.isSafeInteger(ready.port) ||
		!Number.isSafeInteger(ready.receiverPort)
	)
		throw new TypeError("Team Support Desk host returned invalid ports");
	return Object.freeze({
		child,
		port: Number(ready.port),
		receiverPort: Number(ready.receiverPort),
		stderr,
	});
}

async function hmacHex(secret: string, body: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const value = await crypto.subtle.sign(
		"HMAC",
		key,
		new TextEncoder().encode(body),
	);
	return Buffer.from(value).toString("hex");
}

function responseCookie(response: Response): string {
	const value = response.headers.get("set-cookie")?.split(";", 1)[0];
	if (!value) throw new TypeError("Better Auth response did not set a cookie");
	return value;
}

type FixtureMcpInput = Readonly<{
	arguments: Readonly<Record<string, unknown>>;
	cookie?: string;
	name: string;
	signal?: AbortSignal;
}>;
type FixtureMcpCall = FixtureMcpInput &
	Readonly<{
		fetch: (request: Request) => Promise<Response>;
		origin: string;
	}>;

function currentProtocolCall(input: FixtureMcpInput): CurrentProtocolMcpCall {
	return {
		arguments: input.arguments,
		name: input.name,
		...(input.signal === undefined ? {} : { signal: input.signal }),
		headers: input.cookie === undefined ? undefined : { cookie: input.cookie },
	};
}

async function callMcp(input: FixtureMcpCall) {
	return callCurrentProtocolMcp(
		input.fetch,
		input.origin,
		currentProtocolCall(input),
	);
}

function mcpRequest(
	input: FixtureMcpInput & Readonly<{ origin: string }>,
): Readonly<{ id: string; request: Request }> {
	return currentProtocolMcpRequest(input.origin, currentProtocolCall(input));
}

async function databaseHasBlockedWork(): Promise<boolean> {
	const [result] = await database!.unsafe<
		Readonly<Array<{ blocked: boolean }>>
	>(
		`SELECT EXISTS (
  SELECT 1
  FROM pg_catalog.pg_stat_activity
  WHERE pid <> pg_catalog.pg_backend_pid()
    AND pg_catalog.cardinality(pg_catalog.pg_blocking_pids(pid)) > 0
) AS blocked`,
	);
	return result?.blocked === true;
}

function executionInput(
	principal: Parameters<GeneratedApp["execution"]>[0]["principal"],
	persona: (typeof supportPersonas)[keyof typeof supportPersonas],
) {
	return {
		principal,
		context: {
			organizationId: supportTracerIds.organization,
			membershipId: persona.membershipId,
		},
	};
}

async function driveUntilTerminal(
	app: GeneratedApp,
	runId: string,
	worker: ReturnType<GeneratedDurable["worker"]>,
	timeoutMilliseconds = 30_000,
): Promise<DurableRunView> {
	return eventually(
		async () => {
			const before = await app.durable.inspect(runId);
			if (
				before?.state === "succeeded" ||
				before?.state === "failed" ||
				before?.state === "cancelled"
			)
				return before;
			await worker.poll();
			return app.durable.inspect(runId);
		},
		{
			accept: (run): run is DurableRunView =>
				run?.state === "succeeded" ||
				run?.state === "failed" ||
				run?.state === "cancelled",
			description: `Durable Run ${runId} reaches a terminal state`,
			intervalMilliseconds: 40,
			timeoutMilliseconds,
		},
	);
}

async function tracerReport(
	port: number,
): Promise<Readonly<Record<string, unknown>> | null> {
	try {
		const response = await fetch(
			`http://127.0.0.1:${port}/__team_support/report`,
		);
		return response.ok
			? ((await response.json()) as Readonly<Record<string, unknown>>)
			: null;
	} catch {
		return null;
	}
}

async function startFirefoxJourney(input: {
	commentBody: string;
	persona: "customer" | "agent";
	port: number;
	profile: string;
	reference: string;
}): Promise<Child> {
	await mkdir(input.profile);
	const browserUrl = new URL(`http://127.0.0.1:${input.port}/`);
	browserUrl.searchParams.set("tracerPersona", input.persona);
	browserUrl.searchParams.set("tracerComment", input.commentBody);
	browserUrl.searchParams.set("tracerReference", input.reference);
	return Bun.spawn(
		[
			firefoxBinary,
			"--headless",
			"--no-remote",
			"--profile",
			input.profile,
			browserUrl.toString(),
		],
		{
			env: { ...process.env, MOZ_HEADLESS: "1" },
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
		},
	);
}

afterAll(async () => {
	await database?.close({ timeout: 0 });
});

postgresTest(
	"runs the production-like Team Support Desk through direct, generated, durable, webhook, and Firefox seams",
	async () => {
		const cleanup = new CleanupStack();
		const previousDatabaseUrl = process.env.DATABASE_URL;
		process.env.DATABASE_URL = postgresUrl();
		cleanup.defer(() => {
			if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
			else process.env.DATABASE_URL = previousDatabaseUrl;
		});
		const temporary = await mkdtemp(join(tmpdir(), "questpie-team-support-"));
		cleanup.defer(() => rm(temporary, { force: true, recursive: true }));
		const traceBodies: Uint8Array[] = [];
		const telemetryReceiver = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			async fetch(request) {
				if (new URL(request.url).pathname === "/v1/traces")
					traceBodies.push(new Uint8Array(await request.arrayBuffer()));
				return new Response(null, { status: 200 });
			},
		});
		cleanup.defer(() => telemetryReceiver.stop(true));
		try {
			const versionRows = (await database!.unsafe(
				"SHOW server_version_num",
			)) as Array<Readonly<{ server_version_num: string }>>;
			expect(
				Math.trunc(Number(versionRows[0]?.server_version_num) / 10_000),
			).toBe(17);
			// Repository PostgreSQL setup/cleanup only. No application assertion below
			// reads framework or application tables.
			await database!.unsafe(
				'DROP SCHEMA IF EXISTS "team_support_desk" CASCADE; DROP SCHEMA IF EXISTS questpie_internal CASCADE; DROP TABLE IF EXISTS support_auth_verification, support_auth_account, support_auth_session, support_auth_user CASCADE;',
			);
			await cp(fixtureRoot, temporary, { recursive: true });
			const questpieEntry = await installQuestpieForTracer(temporary);
			await installOpenTelemetryForTracer(temporary);
			await installReactForTracer(temporary);
			runCli(temporary, ["build"]);
			runCli(temporary, ["migration", "apply"]);
			runCli(temporary, ["migration", "apply"]);
			expect(runCli(temporary, ["seed", "apply"])).toContain("new");
			expect(runCli(temporary, ["seed", "apply"])).toContain("0 new");
			await database!.unsafe(`DROP ROLE IF EXISTS questpie_tsd_managed_writer;
CREATE ROLE questpie_tsd_managed_writer NOLOGIN;
GRANT USAGE ON SCHEMA team_support_desk TO questpie_tsd_managed_writer;
GRANT SELECT (id, summary, updated_at), UPDATE (summary, updated_at)
ON team_support_desk.tickets TO questpie_tsd_managed_writer;`);
			const [beforeManagedWriter] = await database!<
				Readonly<{ updatedAt: Date }>[]
			>`SELECT updated_at AS "updatedAt"
      FROM team_support_desk.tickets
      WHERE id = ${supportTracerIds.ticketOpen}`;
			const [afterManagedWriter] = await database!.begin(async (writer) => {
				await writer.unsafe("SET LOCAL ROLE questpie_tsd_managed_writer");
				return writer<
					Readonly<{ updatedAt: Date }>[]
				>`UPDATE team_support_desk.tickets
      SET updated_at = '2000-01-01T00:00:00Z'::timestamptz,
          summary = summary
      WHERE id = ${supportTracerIds.ticketOpen}
      RETURNING updated_at AS "updatedAt"`;
			});
			expect(afterManagedWriter!.updatedAt.getTime()).toBeGreaterThan(
				beforeManagedWriter!.updatedAt.getTime(),
			);
			expect(afterManagedWriter!.updatedAt.getUTCFullYear()).not.toBe(2000);
			const managedWriterLedger = await database!<
				Readonly<{ capturedAt: Date; changeKind: string }>[]
			>`SELECT captured_at AS "capturedAt", change_kind AS "changeKind"
FROM questpie_internal.change_ledger
WHERE collection_identity = 'collection:tickets'
  AND new_key->>'id' = ${supportTracerIds.ticketOpen}
ORDER BY fact_id DESC
LIMIT 1`;
			expect(managedWriterLedger).toEqual([
				{
					capturedAt: afterManagedWriter!.updatedAt,
					changeKind: "update",
				},
			]);
			runFixtureScript(temporary, "auth:migrate");
			expect(runFixtureScript(temporary, "auth:seed")).toContain(
				"Better Auth demo identities ready: 3",
			);
			expect(runFixtureScript(temporary, "auth:seed")).toContain(
				"Better Auth demo identities ready: 3",
			);

			const [
				{ createApp },
				{ createClient },
				{ principal },
				{ ticketEditInput },
			] = await Promise.all([
				import(
					`${pathToFileURL(join(temporary, ".questpie/generated/app.ts")).href}?app=${crypto.randomUUID()}`
				) as Promise<
					typeof import("../../../fixtures/team-support-desk/.questpie/generated/app")
				>,
				import(
					`${pathToFileURL(join(temporary, ".questpie/generated/client.ts")).href}?client=${crypto.randomUUID()}`
				) as Promise<
					typeof import("../../../fixtures/team-support-desk/.questpie/generated/client")
				>,
				import(
					`${pathToFileURL(questpieEntry).href}?principal=${crypto.randomUUID()}`
				) as Promise<typeof import("../../../packages/questpie/src/index")>,
				import(
					`${pathToFileURL(join(temporary, "tracer/browser/tickets/edit-input.ts")).href}?editInput=${crypto.randomUUID()}`
				) as Promise<
					typeof import("../../../fixtures/team-support-desk/tracer/browser/tickets/edit-input")
				>,
			]);
			const schemaProjection = (await Bun.file(
				join(temporary, ".questpie/generated/schema-projection.json"),
			).json()) as Readonly<{
				application: Readonly<{ postgresSchema: string }>;
				databaseOwnedUpdates: Readonly<{
					fields: readonly Readonly<{
						column: string;
						functionName: string;
						table: string;
						triggerName: string;
					}>[];
				}>;
			}>;
			const databaseOwnedUpdate =
				schemaProjection.databaseOwnedUpdates.fields[0];
			if (!databaseOwnedUpdate)
				throw new Error("database-owned update projection is missing");
			const schemaName = postgresIdentifier(
				schemaProjection.application.postgresSchema,
			);
			const tableName = postgresIdentifier(databaseOwnedUpdate.table);
			const triggerName = postgresIdentifier(databaseOwnedUpdate.triggerName);
			const functionName = postgresIdentifier(databaseOwnedUpdate.functionName);
			const columnName = postgresIdentifier(databaseOwnedUpdate.column);
			const appOptions = {
				postgres: {
					connectionUrl: postgresUrl(),
					directConnectionUrl: postgresUrl(),
				},
				realtime: { hmacKey: new Uint8Array(32).fill(41) },
				maintenance: { authorize: () => true },
			} as const;
			const expectReadinessFailure = async (): Promise<void> => {
				await expect(createApp(appOptions)).rejects.toMatchObject({
					code: "QP-SCHEMA-028",
				});
			};
			await database!.unsafe(
				`DROP TRIGGER ${triggerName} ON ${schemaName}.${tableName}`,
			);
			await expectReadinessFailure();
			await database!.unsafe(
				`CREATE TRIGGER ${triggerName} BEFORE UPDATE ON ${schemaName}.${tableName} FOR EACH ROW EXECUTE FUNCTION ${schemaName}.${functionName}()`,
			);
			await database!.unsafe(
				`ALTER TABLE ${schemaName}.${tableName} DISABLE TRIGGER ${triggerName}`,
			);
			await expectReadinessFailure();
			await database!.unsafe(
				`ALTER TABLE ${schemaName}.${tableName} ENABLE TRIGGER ${triggerName}`,
			);
			await database!
				.unsafe(`CREATE OR REPLACE FUNCTION ${schemaName}.${functionName}() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $questpie$
BEGIN
  RETURN NEW;
END
$questpie$`);
			await expectReadinessFailure();
			await database!
				.unsafe(`CREATE OR REPLACE FUNCTION ${schemaName}.${functionName}() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $questpie$
BEGIN
  NEW.${columnName} := pg_catalog.transaction_timestamp();
  RETURN NEW;
END
$questpie$`);
			await database!.unsafe(
				`GRANT EXECUTE ON FUNCTION ${schemaName}.${functionName}() TO PUBLIC`,
			);
			await expectReadinessFailure();
			await database!.unsafe(
				`REVOKE ALL ON FUNCTION ${schemaName}.${functionName}() FROM PUBLIC`,
			);
			const additionalTrigger = postgresIdentifier(
				"tickets_extra_questpie_on_update",
			);
			await database!.unsafe(
				`CREATE TRIGGER ${additionalTrigger} BEFORE UPDATE ON ${schemaName}.${tableName} FOR EACH ROW EXECUTE FUNCTION ${schemaName}.${functionName}()`,
			);
			await expectReadinessFailure();
			await database!.unsafe(
				`DROP TRIGGER ${additionalTrigger} ON ${schemaName}.${tableName}`,
			);

			let rejectNext = false;
			const directReceipts: Array<
				Readonly<{
					body: unknown;
					effectId: string | null;
					idempotencyKey: string | null;
				}>
			> = [];
			const directReceiver = Bun.serve({
				hostname: "127.0.0.1",
				port: 43_121,
				async fetch(request) {
					if (rejectNext) {
						rejectNext = false;
						return new Response(null, { status: 503 });
					}
					directReceipts.push(
						Object.freeze({
							body: await request.json(),
							effectId: request.headers.get("x-questpie-effect-id"),
							idempotencyKey: request.headers.get("idempotency-key"),
						}),
					);
					return new Response(null, {
						status: 202,
						headers: {
							"x-team-support-receipt": `direct:${directReceipts.length}`,
						},
					});
				},
			});
			cleanup.defer(() => directReceiver.stop(false));

			const app = await createApp(appOptions);
			cleanup.defer(() => app.close());
			const agentPrincipal = principal.user({
				id: supportTracerIds.principalAgent,
			});
			const customerPrincipal = principal.user({
				id: supportTracerIds.principalCustomer,
			});
			const agentInput = executionInput(agentPrincipal, supportPersonas.agent);
			const customerInput = executionInput(
				customerPrincipal,
				supportPersonas.customer,
			);

			const listEvidence = await app.execution(
				agentInput,
				async ({ queries }) => {
					const queue = await queries.tickets.queue({
						after: null,
						first: 10,
						statuses: ["open"],
						teamIds: null,
					});
					const emptyQueue = await queries.tickets.queue({
						after: null,
						first: 10,
						statuses: [],
						teamIds: null,
					});
					const first = await queries.tickets.queue({
						after: null,
						first: 1,
						statuses: null,
						teamIds: null,
					});
					const open = await queries.tickets.queue({
						after: null,
						first: 10,
						statuses: ["open"],
						teamIds: null,
					});
					const team = await queries.tickets.queue({
						after: null,
						first: 10,
						statuses: null,
						teamIds: [supportTracerIds.teamPlatform],
					});
					const combined = await queries.tickets.queue({
						after: null,
						first: 10,
						statuses: ["open"],
						teamIds: [supportTracerIds.teamPlatform],
					});
					const searched = await queries.tickets.searchByReference({
						reference: supportTracerIds.referenceOpen,
					});
					const detail = await queries.tickets.detail({
						id: supportTracerIds.ticketOpen,
					});
					const emptyDetail = await queries.tickets.detail({
						id: supportTracerIds.ticketClosed,
					});
					return {
						queue,
						emptyQueue,
						first,
						open,
						team,
						combined,
						searched,
						detail,
						emptyDetail,
					};
				},
			);
			expect(
				listEvidence.queue.nodes.every(({ status }) => status === "open"),
			).toBe(true);
			expect(
				listEvidence.queue.nodes.every(
					({ team }) =>
						team?.routingStatus === "active" &&
						team.organization?.name === "Northwind Support",
				),
			).toBe(true);
			expect(listEvidence.emptyQueue.nodes).toEqual([]);
			expect(listEvidence.first.nodes).toHaveLength(1);
			expect(listEvidence.first.pageInfo.hasNextPage).toBe(true);
			expect(
				listEvidence.open.nodes.every(({ status }) => status === "open"),
			).toBe(true);
			expect(
				listEvidence.team.nodes.every(
					({ teamId }) => teamId === supportTracerIds.teamPlatform,
				),
			).toBe(true);
			expect(
				listEvidence.combined.nodes.every(
					({ status, teamId }) =>
						status === "open" && teamId === supportTracerIds.teamPlatform,
				),
			).toBe(true);
			expect(listEvidence.searched?.reference).toBe(
				supportTracerIds.referenceOpen,
			);
			expect(listEvidence.detail).toMatchObject({
				id: supportTracerIds.ticketOpen,
				organizationId: supportTracerIds.organization,
				team: { id: supportTracerIds.teamPlatform },
				requester: { id: supportTracerIds.membershipCustomer },
			});
			expect(listEvidence.detail?.comments.map(({ id }) => id)).toEqual([
				supportTracerIds.comments.internal,
				supportTracerIds.comments.customerTie,
				supportTracerIds.comments.agent,
				supportTracerIds.comments.customer,
			]);
			expect(
				listEvidence.detail?.comments.every(
					({ body }) => typeof body === "string",
				),
			).toBe(true);
			expect(listEvidence.emptyDetail?.comments).toEqual([]);

			const customerDetail = await app.execution(customerInput, ({ queries }) =>
				queries.tickets.detail({ id: supportTracerIds.ticketOpen }),
			);
			expect(customerDetail?.comments.map(({ id }) => id)).toEqual([
				supportTracerIds.comments.customerTie,
				supportTracerIds.comments.agent,
				supportTracerIds.comments.customer,
			]);
			expect(
				customerDetail?.comments.find(
					({ id }) => id === supportTracerIds.comments.agent,
				),
			).not.toHaveProperty("body");
			expect(
				customerDetail?.comments.find(
					({ id }) => id === supportTracerIds.comments.customer,
				)?.body,
			).toBe("I reproduced this twice after signing in again.");

			const created = await app.execution(agentInput, ({ mutations }) =>
				mutations.ticket.create(
					{
						description: "Created through the exact generated direct Mutation.",
						priority: "high",
						reference: `  SUP-${crypto.randomUUID().slice(0, 8).toUpperCase()}  `,
						summary: "Production login intermittently fails",
						teamId: supportTracerIds.teamPlatform,
					},
					{ callId: `direct:create:${crypto.randomUUID()}` },
				),
			);
			expect(created.reference).toMatch(/^SUP-/);
			expect(created.reference).not.toMatch(/^\s|\s$/);
			let directLifecycleError: unknown;
			try {
				await app.execution(agentInput, ({ mutations }) =>
					mutations.ticket.create(
						{
							description: "Rejected by Collection validation.",
							reference: "INVALID-REFERENCE",
							summary: "Invalid lifecycle reference",
							teamId: supportTracerIds.teamPlatform,
						},
						{ callId: `direct:invalid-create:${crypto.randomUUID()}` },
					),
				);
			} catch (error) {
				directLifecycleError = error;
			}
			expect(directLifecycleError).toMatchObject({
				code: "INVALID_TICKET",
				payload: null,
				status: 422,
			});
			await app.execution(agentInput, ({ mutations }) =>
				mutations.teams.update({
					key: { id: supportTracerIds.teamPlatform },
					patch: { routingStatus: "paused" },
				}),
			);
			let dependentCheckError: unknown;
			try {
				await app.execution(agentInput, ({ mutations }) =>
					mutations.ticket.create(
						{
							description: "Rejected by a Policy-aware Collection check.",
							reference: `SUP-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
							summary: "Paused routing team",
							teamId: supportTracerIds.teamPlatform,
						},
						{ callId: `direct:paused-team:${crypto.randomUUID()}` },
					),
				);
			} catch (error) {
				dependentCheckError = error;
			} finally {
				await app.execution(agentInput, ({ mutations }) =>
					mutations.teams.update({
						key: { id: supportTracerIds.teamPlatform },
						patch: { routingStatus: "active" },
					}),
				);
			}
			expect(dependentCheckError).toMatchObject({
				code: "INVALID_TICKET",
				payload: null,
				status: 422,
			});
			const directLifecycleErrorBytes = JSON.stringify({
				code: (directLifecycleError as { code: unknown }).code,
				status: (directLifecycleError as { status: unknown }).status,
				payload: (directLifecycleError as { payload: unknown }).payload,
			});
			const editCallId = `direct:edit:${crypto.randomUUID()}`;
			const editInput = {
				ticketId: created.id,
				priority: "urgent" as const,
				summary: "Production login consistently fails",
			};
			const edited = await app.execution(agentInput, ({ mutations }) =>
				mutations.ticket.edit(editInput, { callId: editCallId }),
			);
			expect(edited).toMatchObject({ id: created.id, priority: "urgent" });
			const receiptReplay = await app.execution(agentInput, ({ mutations }) =>
				mutations.ticket.edit(editInput, { callId: editCallId }),
			);
			expect(receiptReplay).toEqual(edited);
			const receiptEvidence = await database!<
				Readonly<{
					operationTime: Date;
				}>[]
			>`SELECT operation_time AS "operationTime"
FROM questpie_internal.mutation_call_receipts
WHERE call_id = ${editCallId}`;
			expect(receiptEvidence).toEqual([{ operationTime: edited.updatedAt }]);
			const assigned = await app.execution(agentInput, ({ mutations }) =>
				mutations.ticket.assign(
					{
						ticketId: created.id,
						assigneeMembershipId: supportTracerIds.membershipAgent,
					},
					{ callId: `direct:assign:${crypto.randomUUID()}` },
				),
			);
			expect(assigned.assigneeMembershipId).toBe(
				supportTracerIds.membershipAgent,
			);

			await expect(
				app.execution(customerInput, ({ mutations }) =>
					mutations.ticket.close(
						{ ticketId: created.id },
						{ callId: `customer:close:${crypto.randomUUID()}` },
					),
				),
			).rejects.toMatchObject({ code: "TICKET_UNAVAILABLE" });
			await expect(
				app.execution(
					{
						principal: agentPrincipal,
						context: {
							organizationId: crypto.randomUUID(),
							membershipId: supportTracerIds.membershipAgent,
						},
					},
					({ queries }) =>
						queries.tickets.queue({
							after: null,
							first: 10,
							statuses: null,
							teamIds: null,
						}),
				),
			).rejects.toMatchObject({ code: expect.any(String) });

			const race = await Promise.allSettled([
				app.execution(agentInput, ({ mutations }) =>
					mutations.ticket.close(
						{ ticketId: created.id },
						{ callId: `race:a:${crypto.randomUUID()}` },
					),
				),
				app.execution(agentInput, ({ mutations }) =>
					mutations.ticket.close(
						{ ticketId: created.id },
						{ callId: `race:b:${crypto.randomUUID()}` },
					),
				),
			]);
			expect(race.filter(({ status }) => status === "fulfilled")).toHaveLength(
				1,
			);
			expect(race.filter(({ status }) => status === "rejected")).toHaveLength(
				1,
			);
			const closed = race.find(({ status }) => status === "fulfilled");
			if (closed?.status !== "fulfilled")
				throw new Error("concurrent close winner is missing");
			expect(closed.value.updatedAt).toEqual(closed.value.closedAt);
			await app.execution(agentInput, ({ mutations }) =>
				mutations.ticket.reopen(
					{ ticketId: created.id },
					{ callId: `direct:reopen:${crypto.randomUUID()}` },
				),
			);

			const comment = await app.execution(agentInput, ({ mutations }) =>
				mutations.ticket.addComment(
					{
						ticketId: created.id,
						body: "Investigating the identity provider trace now.",
					},
					{ callId: `direct:comment:${crypto.randomUUID()}` },
				),
			);
			expect(comment.job.resource).toBe("job:ticket.slaFollowUp");
			expect(
				(
					await app.execution(agentInput, ({ queries }) =>
						queries.tickets.detail({ id: created.id }),
					)
				)?.comments.map(({ body }) => body),
			).toEqual([comment.comment.body]);

			const effectKey = `direct:summary:${crypto.randomUUID()}`;
			const action = await app.execution(agentInput, ({ actions }) =>
				actions.notification.sendTicketSummary(
					{ ticketId: created.id },
					{ effectKey, timeoutMilliseconds: 3_000 },
				),
			);
			expect(action).toMatchObject({
				providerReceipt: "direct:1",
				ticketReference: created.reference,
			});
			expect(action.effectId).toMatch(/^[0-9a-f-]{36}$/);
			expect(directReceipts[0]).toMatchObject({
				effectId: action.effectId,
				idempotencyKey: action.effectId,
			});
			rejectNext = true;
			await expect(
				app.execution(agentInput, ({ actions }) =>
					actions.notification.sendTicketSummary(
						{ ticketId: created.id },
						{ effectKey: `direct:rejected:${crypto.randomUUID()}` },
					),
				),
			).rejects.toMatchObject({ code: "NOTIFICATION_PROVIDER_REJECTED" });

			const authOrigin = "https://team-support.test";
			const signIn = await app.fetch(
				new Request(`${authOrigin}/api/auth/sign-in/email`, {
					method: "POST",
					headers: {
						"content-type": "application/json",
						origin: authOrigin,
					},
					body: JSON.stringify(supportAuthCredentials.agent),
				}),
			);
			expect(signIn.status).toBe(200);
			const cookie = responseCookie(signIn);
			expect(cookie).toStartWith("team-support.session_token=");
			let lifecycleWireErrorBytes: string | undefined;
			const browserClient = createClient({
				baseUrl: authOrigin,
				fetch: async (request) => {
					const headers = new Headers(request.headers);
					headers.set("cookie", cookie);
					const response = await app.fetch(new Request(request, { headers }));
					if (response.status === 422) {
						const frame = (await response.clone().json()) as Readonly<{
							callId?: unknown;
							error?: unknown;
						}>;
						if (
							typeof frame.callId === "string" &&
							typeof frame.error === "object" &&
							frame.error !== null
						) {
							const error = frame.error as Readonly<{
								code?: unknown;
								payload?: unknown;
							}>;
							lifecycleWireErrorBytes = JSON.stringify({
								code: error.code,
								status: response.status,
								payload: error.payload,
							});
						}
					}
					return response;
				},
			}).withContext({
				organizationId: supportTracerIds.organization,
				membershipId: supportTracerIds.membershipAgent,
			});
			expect(
				(
					await browserClient.queries["tickets.queue"]({
						after: null,
						first: 20,
						statuses: null,
						teamIds: null,
					})
				).nodes.some(({ id }) => id === created.id),
			).toBe(true);
			const browserDetail = await browserClient.queries["tickets.detail"]({
				id: supportTracerIds.ticketOpen,
			});
			expect(browserDetail?.comments.map(({ id }) => id)).toEqual([
				supportTracerIds.comments.internal,
				supportTracerIds.comments.customerTie,
				supportTracerIds.comments.agent,
				supportTracerIds.comments.customer,
			]);
			const mcpDetail = await callMcp({
				fetch: app.fetch,
				origin: authOrigin,
				cookie,
				name: "query.tickets.detail",
				arguments: {
					context: {
						organizationId: supportTracerIds.organization,
						membershipId: supportTracerIds.membershipAgent,
					},
					input: { id: supportTracerIds.ticketOpen },
				},
			});
			expect(mcpDetail.result).toEqual(
				JSON.parse(JSON.stringify(browserDetail)),
			);
			let anonymousHttpFailure: unknown;
			try {
				await createClient({
					baseUrl: authOrigin,
					fetch: (request) => app.fetch(request),
				})
					.withContext({
						organizationId: supportTracerIds.organization,
						membershipId: supportTracerIds.membershipAgent,
					})
					.queries["tickets.detail"]({ id: supportTracerIds.ticketOpen });
			} catch (error) {
				anonymousHttpFailure = error;
			}
			expect(anonymousHttpFailure).toMatchObject({
				code: "INTERNAL",
				retryable: false,
			});
			const anonymousMcp = await callMcp({
				fetch: app.fetch,
				origin: authOrigin,
				name: "query.tickets.detail",
				arguments: {
					context: {
						organizationId: supportTracerIds.organization,
						membershipId: supportTracerIds.membershipAgent,
					},
					input: { id: supportTracerIds.ticketOpen },
				},
			});
			expect(anonymousMcp.error).toEqual({
				code: "INTERNAL",
				retryable: false,
			});
			const invalidMcp = await callMcp({
				fetch: app.fetch,
				origin: authOrigin,
				cookie,
				name: "query.tickets.detail",
				arguments: {
					context: {
						organizationId: supportTracerIds.organization,
						membershipId: supportTracerIds.membershipAgent,
					},
					input: { id: "not-a-uuid" },
				},
			});
			expect(invalidMcp.error).toEqual({
				code: "PROTOCOL_UNSUPPORTED",
				retryable: false,
			});
			const mcpCancellationBlocker = await database!.reserve();
			try {
				await mcpCancellationBlocker.unsafe("BEGIN");
				await mcpCancellationBlocker.unsafe(
					"LOCK TABLE team_support_desk.tickets IN ACCESS EXCLUSIVE MODE",
				);
				const { request: blockedMcpRequest } = mcpRequest({
					origin: authOrigin,
					cookie,
					name: "query.tickets.detail",
					arguments: {
						context: {
							organizationId: supportTracerIds.organization,
							membershipId: supportTracerIds.membershipAgent,
						},
						input: { id: supportTracerIds.ticketOpen },
					},
				});
				const blockedMcpResponse = await app.fetch(blockedMcpRequest);
				const blockedMcpReader = blockedMcpResponse.body?.getReader();
				if (!blockedMcpReader)
					throw new TypeError("MCP cancellation response has no stream");
				await eventually(databaseHasBlockedWork, {
					accept: (blocked) => blocked,
					description: "MCP Query reaches blocked PostgreSQL work",
					intervalMilliseconds: 10,
					timeoutMilliseconds: 5_000,
				});
				await blockedMcpReader.cancel();
				await eventually(databaseHasBlockedWork, {
					accept: (blocked) => !blocked,
					description: "MCP stream close cancels blocked PostgreSQL work",
					intervalMilliseconds: 10,
					timeoutMilliseconds: 5_000,
				});
			} finally {
				await mcpCancellationBlocker.unsafe("ROLLBACK").catch(() => {});
				await mcpCancellationBlocker.release();
			}
			const browserCreated = await browserClient.mutations["ticket.create"](
				{
					description: "Created through the derived Collection input codec.",
					reference: `WEB-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
					summary: "Defaulted priority remains optional over Wire v3",
					teamId: supportTracerIds.teamPlatform,
				},
				{ callId: `browser:derived-create:${crypto.randomUUID()}` },
			);
			expect(browserCreated).toMatchObject({
				priority: "normal",
				requesterMembershipId: supportTracerIds.membershipAgent,
			});
			const mcpCreateCallId = `mcp:create:${crypto.randomUUID()}`;
			const mcpCreateArguments = {
				callId: mcpCreateCallId,
				context: {
					organizationId: supportTracerIds.organization,
					membershipId: supportTracerIds.membershipAgent,
				},
				input: {
					description: "Created through the MCP Operation projection.",
					reference: `  SUP-${crypto.randomUUID().slice(0, 8).toUpperCase()}  `,
					summary: "MCP uses the same Collection lifecycle",
					teamId: supportTracerIds.teamPlatform,
				},
			} as const;
			const mcpCreated = await callMcp({
				fetch: app.fetch,
				origin: authOrigin,
				cookie,
				name: "mutation.ticket.create",
				arguments: mcpCreateArguments,
			});
			expect(mcpCreated.result).toMatchObject({
				priority: "normal",
				reference: expect.stringMatching(/^SUP-/),
				requesterMembershipId: supportTracerIds.membershipAgent,
			});
			expect(
				await callMcp({
					fetch: app.fetch,
					origin: authOrigin,
					cookie,
					name: "mutation.ticket.create",
					arguments: mcpCreateArguments,
				}),
			).toEqual(mcpCreated);
			const mcpLifecycleFailure = await callMcp({
				fetch: app.fetch,
				origin: authOrigin,
				cookie,
				name: "mutation.ticket.create",
				arguments: {
					callId: `mcp:invalid-create:${crypto.randomUUID()}`,
					context: {
						organizationId: supportTracerIds.organization,
						membershipId: supportTracerIds.membershipAgent,
					},
					input: {
						description: "Rejected through the MCP projection.",
						reference: "INVALID-REFERENCE",
						summary: "MCP lifecycle mapping remains typed",
						teamId: supportTracerIds.teamPlatform,
					},
				},
			});
			expect(mcpLifecycleFailure.error).toEqual({
				code: "INVALID_TICKET",
				payload: null,
			});
			const mcpAction = await callMcp({
				fetch: app.fetch,
				origin: authOrigin,
				cookie,
				name: "action.notification.sendTicketSummary",
				arguments: {
					context: {
						organizationId: supportTracerIds.organization,
						membershipId: supportTracerIds.membershipAgent,
					},
					effectKey: `mcp:summary:${crypto.randomUUID()}`,
					input: { ticketId: created.id },
				},
			});
			expect(mcpAction.result).toMatchObject({
				providerReceipt: expect.stringMatching(/^direct:/),
				ticketReference: created.reference,
			});
			rejectNext = true;
			const mcpActionFailure = await callMcp({
				fetch: app.fetch,
				origin: authOrigin,
				cookie,
				name: "action.notification.sendTicketSummary",
				arguments: {
					context: {
						organizationId: supportTracerIds.organization,
						membershipId: supportTracerIds.membershipAgent,
					},
					effectKey: `mcp:rejected:${crypto.randomUUID()}`,
					input: { ticketId: created.id },
				},
			});
			expect(mcpActionFailure.error).toEqual({
				code: "NOTIFICATION_PROVIDER_REJECTED",
				payload: null,
			});
			let clientLifecycleError: unknown;
			try {
				await browserClient.mutations["ticket.create"](
					{
						description: "Rejected over the generated client.",
						reference: "INVALID-REFERENCE",
						summary: "Invalid network lifecycle reference",
						teamId: supportTracerIds.teamPlatform,
					},
					{ callId: `browser:invalid-create:${crypto.randomUUID()}` },
				);
			} catch (error) {
				clientLifecycleError = error;
			}
			expect(clientLifecycleError).toMatchObject({
				code: "INVALID_TICKET",
				payload: null,
				status: 422,
			});
			const clientLifecycleErrorBytes = JSON.stringify({
				code: (clientLifecycleError as { code: unknown }).code,
				status: (clientLifecycleError as { status: unknown }).status,
				payload: (clientLifecycleError as { payload: unknown }).payload,
			});
			expect(clientLifecycleErrorBytes).toBe(directLifecycleErrorBytes);
			expect(lifecycleWireErrorBytes).toBe(directLifecycleErrorBytes);

			const customerSignIn = await app.fetch(
				new Request(`${authOrigin}/api/auth/sign-in/email`, {
					method: "POST",
					headers: {
						"content-type": "application/json",
						origin: authOrigin,
					},
					body: JSON.stringify(supportAuthCredentials.customer),
				}),
			);
			expect(customerSignIn.status).toBe(200);
			const customerCookie = responseCookie(customerSignIn);
			const customerBrowserClient = createClient({
				baseUrl: authOrigin,
				fetch: (request) => {
					const headers = new Headers(request.headers);
					headers.set("cookie", customerCookie);
					return app.fetch(new Request(request, { headers }));
				},
			}).withContext({
				organizationId: supportTracerIds.organization,
				membershipId: supportTracerIds.membershipCustomer,
			});
			const customerMcpDetail = await callMcp({
				fetch: app.fetch,
				origin: authOrigin,
				cookie: customerCookie,
				name: "query.tickets.detail",
				arguments: {
					context: {
						organizationId: supportTracerIds.organization,
						membershipId: supportTracerIds.membershipCustomer,
					},
					input: { id: supportTracerIds.ticketOpen },
				},
			});
			const customerMcpResult = customerMcpDetail.result as Readonly<{
				comments: readonly Readonly<{ body?: string; id: string }>[];
			}>;
			expect(
				customerMcpResult.comments.find(
					({ id }) => id === supportTracerIds.comments.agent,
				),
			).not.toHaveProperty("body");
			const customerEditForm = new FormData();
			customerEditForm.set("summary", "Customer supplied updated summary");
			customerEditForm.set(
				"description",
				"Customer supplied updated description.",
			);
			customerEditForm.set("priority", "urgent");
			const customerEdited = await customerBrowserClient.mutations[
				"ticket.edit"
			](
				ticketEditInput(
					"customer",
					customerEditForm,
					supportTracerIds.ticketOpen,
				),
				{ callId: `browser:customer-edit:${crypto.randomUUID()}` },
			);
			expect(customerEdited).toMatchObject({
				description: "Customer supplied updated description.",
				id: supportTracerIds.ticketOpen,
				priority: "high",
				summary: "Customer supplied updated summary",
			});
			expect(Date.parse(customerEdited.updatedAt)).toBeGreaterThan(
				Date.parse(listEvidence.detail!.updatedAt),
			);

			const webhookBody = JSON.stringify({
				eventId: `webhook:${crypto.randomUUID()}`,
				organizationId: supportTracerIds.organization,
				membershipId: supportTracerIds.membershipIntegration,
				teamId: supportTracerIds.teamPlatform,
				reference: `WEB-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
				priority: "normal",
				summary: "Inbound customer support request",
				description: "Created by the signed webhook Route.",
			});
			const webhookRequest = async (signature: string) =>
				app.fetch(
					new Request("https://team-support.test/webhooks/support/inbound", {
						method: "POST",
						headers: {
							"content-type": "application/json",
							"x-team-support-integration-key": integrationKey,
							"x-team-support-signature": signature,
						},
						body: webhookBody,
					}),
				);
			expect((await webhookRequest("sha256=" + "0".repeat(64))).status).toBe(
				401,
			);
			const signature = `sha256=${await hmacHex(webhookSecret, webhookBody)}`;
			const validWebhook = await webhookRequest(signature);
			expect(validWebhook.ok).toBe(true);
			const validPayload = await validWebhook.json();
			const duplicateWebhook = await webhookRequest(signature);
			expect(duplicateWebhook.ok).toBe(true);
			expect(await duplicateWebhook.json()).toEqual(validPayload);

			const worker = app.durable.worker({
				workerId: "team-support-test:direct",
				claimBatch: 4,
				leaseMilliseconds: 1_000,
				heartbeatMilliseconds: 200,
				attemptDeadlineMilliseconds: 1_000,
			});
			const immediateTerminal = await driveUntilTerminal(
				app,
				comment.job.runId,
				worker,
			);
			expect(immediateTerminal.state).toBe("succeeded");

			const acceptJob = (
				input: GeneratedJobs["ticket.slaFollowUp"]["input"],
				idempotencyKey: string,
				notBefore?: Date,
			) =>
				app.execution(agentInput, ({ jobs }) =>
					jobs.ticket.slaFollowUp.accept(input, {
						idempotencyKey,
						...(notBefore === undefined ? {} : { notBefore }),
					}),
				);
			const now = Date.now();
			const delayedAt = new Date(now + 1_000);
			const delayed = await acceptJob(
				{
					organizationId: supportTracerIds.organization,
					ticketId: created.id,
					reference: created.reference,
					summary: created.summary,
					dueAt: delayedAt,
				},
				`direct:delayed:${crypto.randomUUID()}`,
				delayedAt,
			);
			expect(await app.durable.inspect(delayed.runId)).toMatchObject({
				attemptCount: 0,
				state: "delayed",
			});
			expect((await app.durable.events(delayed.runId)).length).toBeGreaterThan(
				0,
			);
			expect((await driveUntilTerminal(app, delayed.runId, worker)).state).toBe(
				"succeeded",
			);

			const retry = await acceptJob(
				{
					organizationId: supportTracerIds.organization,
					ticketId: created.id,
					reference: created.reference,
					summary: created.summary,
					dueAt: new Date(Date.now() + 1_400),
				},
				`direct:retry:${crypto.randomUUID()}`,
			);
			const retryTerminal = await driveUntilTerminal(app, retry.runId, worker);
			expect(retryTerminal).toMatchObject({ state: "succeeded" });
			expect(retryTerminal.attemptCount).toBeGreaterThanOrEqual(2);
			expect(
				(await app.durable.events(retry.runId)).some(({ kind }) =>
					kind.toLowerCase().includes("retry"),
				),
			).toBe(true);

			const cancelledAt = new Date(Date.now() + 60_000);
			const cancelled = await acceptJob(
				{
					organizationId: supportTracerIds.organization,
					ticketId: created.id,
					reference: created.reference,
					summary: created.summary,
					dueAt: cancelledAt,
				},
				`direct:cancelled:${crypto.randomUUID()}`,
				cancelledAt,
			);
			const beforeCancel = await app.durable.inspect(cancelled.runId);
			expect(
				await app.durable.cancelRun({
					runId: cancelled.runId,
					reason: "Team Support Desk tracer cancellation",
					actor: agentPrincipal,
					expectedVersion: beforeCancel!.version,
				}),
			).toMatchObject({ outcome: "applied", stateAfter: "cancelled" });

			const restart = await acceptJob(
				{
					organizationId: supportTracerIds.organization,
					ticketId: created.id,
					reference: created.reference,
					summary: created.summary,
					dueAt: new Date(Date.now() + 8_000),
				},
				`direct:restart:${crypto.randomUUID()}`,
			);
			worker.beginDrain();
			directReceiver.stop(false);

			const hostWorker = {
				attemptDeadlineMilliseconds: 30_000,
				heartbeatMilliseconds: 200,
				leaseMilliseconds: 1_000,
			};
			const firstHost = await startHost(temporary, 0, hostWorker);
			cleanup.defer(() => stop(firstHost.child, "SIGKILL"));
			const hostOrigin = `http://127.0.0.1:${firstHost.port}`;
			const hostSignIn = await fetch(`${hostOrigin}/api/auth/sign-in/email`, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					origin: hostOrigin,
				},
				body: JSON.stringify(supportAuthCredentials.agent),
			});
			expect(hostSignIn.status).toBe(200);
			const restartCookie = responseCookie(hostSignIn);
			expect(restartCookie).toStartWith("team-support.session_token=");
			const hostedMcpDetail = await callMcp({
				fetch,
				origin: hostOrigin,
				cookie: restartCookie,
				name: "query.tickets.detail",
				arguments: {
					context: {
						organizationId: supportTracerIds.organization,
						membershipId: supportTracerIds.membershipAgent,
					},
					input: { id: supportTracerIds.ticketOpen },
				},
			});
			expect(hostedMcpDetail.result).toMatchObject({
				id: supportTracerIds.ticketOpen,
				reference: supportTracerIds.referenceOpen,
			});
			const hostedMcpCancellationBlocker = await database!.reserve();
			try {
				await hostedMcpCancellationBlocker.unsafe("BEGIN");
				await hostedMcpCancellationBlocker.unsafe(
					"LOCK TABLE team_support_desk.tickets IN ACCESS EXCLUSIVE MODE",
				);
				const hostedMcpCancellation = new AbortController();
				const { request: blockedHostedMcpRequest } = mcpRequest({
					origin: hostOrigin,
					cookie: restartCookie,
					signal: hostedMcpCancellation.signal,
					name: "query.tickets.detail",
					arguments: {
						context: {
							organizationId: supportTracerIds.organization,
							membershipId: supportTracerIds.membershipAgent,
						},
						input: { id: supportTracerIds.ticketOpen },
					},
				});
				const blockedHostedMcpResponse = fetch(blockedHostedMcpRequest);
				await eventually(databaseHasBlockedWork, {
					accept: (blocked) => blocked,
					description: "hosted MCP Query reaches blocked PostgreSQL work",
					intervalMilliseconds: 10,
					timeoutMilliseconds: 5_000,
				});
				hostedMcpCancellation.abort();
				await expect(blockedHostedMcpResponse).rejects.toMatchObject({
					name: "AbortError",
				});
				await eventually(databaseHasBlockedWork, {
					accept: (blocked) => !blocked,
					description: "hosted MCP stream close cancels PostgreSQL work",
					intervalMilliseconds: 10,
					timeoutMilliseconds: 5_000,
				});
			} finally {
				await hostedMcpCancellationBlocker.unsafe("ROLLBACK").catch(() => {});
				await hostedMcpCancellationBlocker.release();
			}
			const running = await eventually(
				() => app.durable.inspect(restart.runId),
				{
					accept: (run) => run?.state === "running" && run.attemptCount === 1,
					description: "hard-restart Job first active attempt",
					intervalMilliseconds: 50,
					timeoutMilliseconds: 30_000,
				},
			);
			expect(running?.currentAttemptId).toMatch(/^[0-9a-f-]{36}$/);
			const beforeRestartEvents = await app.durable.events(restart.runId);
			expect(
				beforeRestartEvents.some(
					({ leaseTokenDigest }) => leaseTokenDigest !== null,
				),
			).toBe(true);
			await stop(firstHost.child, "SIGKILL");
			const recoveredHost = await startHost(
				temporary,
				firstHost.port,
				hostWorker,
			);
			cleanup.defer(() => stop(recoveredHost.child, "SIGTERM"));
			const recoveredSession = await fetch(
				`http://127.0.0.1:${recoveredHost.port}/api/auth/get-session`,
				{ headers: { cookie: restartCookie } },
			);
			expect(recoveredSession.status).toBe(200);
			expect(await recoveredSession.json()).toMatchObject({
				user: { id: supportTracerIds.principalAgent, roleHint: "agent" },
			});
			const recoveredRun = await eventually(
				() => app.durable.inspect(restart.runId),
				{
					accept: (run) => run?.state === "succeeded" && run.attemptCount >= 2,
					description: "hard-restart Job recovery",
					intervalMilliseconds: 100,
					timeoutMilliseconds: 40_000,
				},
			);
			expect(recoveredRun).toMatchObject({ state: "succeeded" });
			const recoveryEvents = await app.durable.events(restart.runId);
			expect(recoveryEvents.length).toBeGreaterThan(beforeRestartEvents.length);
			expect(
				new Set(
					recoveryEvents.map(({ attemptId }) => attemptId).filter(Boolean),
				).size,
			).toBeGreaterThanOrEqual(2);
			expect(await app.durable.inspect(cancelled.runId)).toMatchObject({
				attemptCount: 0,
				state: "cancelled",
			});

			const customerComment = `Firefox customer update ${crypto.randomUUID()}`;
			const customerBrowser = await startFirefoxJourney({
				commentBody: customerComment,
				persona: "customer",
				port: recoveredHost.port,
				profile: join(temporary, "firefox-customer-profile"),
				reference: supportTracerIds.referenceOpen,
			});
			cleanup.defer(() => stop(customerBrowser, "SIGKILL"));
			expect(
				await eventually(() => tracerReport(recoveredHost.port), {
					accept: (report) =>
						report?.phase === "firefox-comments-complete" &&
						report.commentBody === customerComment,
					description: "Firefox customer inverse-list journey",
					intervalMilliseconds: 100,
					timeoutMilliseconds: 40_000,
				}),
			).toMatchObject({
				authProvider: "better-auth",
				commentBody: customerComment,
				conditionalBodyOmitted: true,
				emptyCommentsObserved: true,
				hiddenCommentRemoved: true,
				phase: "firefox-comments-complete",
				reference: supportTracerIds.referenceOpen,
				role: "customer",
				seededCommentIds: [
					supportTracerIds.comments.customerTie,
					supportTracerIds.comments.agent,
					supportTracerIds.comments.customer,
				],
				watchedCommentObserved: true,
			});
			await stop(customerBrowser, "SIGTERM");
			await stop(recoveredHost.child, "SIGTERM");
			const observedHost = await startHost(
				temporary,
				firstHost.port,
				{ ...hostWorker, pause: true },
				telemetryReceiver.url.href,
			);
			cleanup.defer(() => stop(observedHost.child, "SIGTERM"));

			const firefoxComment = `Firefox operator update ${crypto.randomUUID()}`;
			const browser = await startFirefoxJourney({
				commentBody: firefoxComment,
				persona: "agent",
				port: observedHost.port,
				profile: join(temporary, "firefox-agent-profile"),
				reference: supportTracerIds.referenceOpen,
			});
			cleanup.defer(() => stop(browser, "SIGKILL"));
			let latestBrowserReport: Readonly<Record<string, unknown>> | null = null;
			let browserReport: Readonly<Record<string, unknown>>;
			try {
				browserReport = await eventually(
					async () =>
						(latestBrowserReport = await tracerReport(observedHost.port)),
					{
						accept: (report) =>
							report?.phase === "firefox-complete" &&
							report.commentBody === firefoxComment,
						description: "Firefox generated-client Operator App journey",
						intervalMilliseconds: 100,
						timeoutMilliseconds: 40_000,
					},
				);
			} catch (error) {
				const hostError =
					observedHost.child.exitCode === null
						? "host still running"
						: (await observedHost.stderr).trim();
				throw new Error(
					`Firefox journey failed; last report: ${JSON.stringify(latestBrowserReport)}; host: ${hostError}`,
					{ cause: error },
				);
			}
			const browserJobRunId = browserReport.jobRunId;
			if (
				typeof browserJobRunId !== "string" ||
				!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(browserJobRunId)
			)
				throw new TypeError(
					`Firefox report returned an invalid Job run ID: ${JSON.stringify(browserJobRunId)}`,
				);
			const browserOperationRequests =
				browserReport["browserOperationRequests"];
			expect(Array.isArray(browserOperationRequests)).toBe(true);
			expect(browserReport).toMatchObject({
				authProvider: "better-auth",
				browserOperationRequests: expect.arrayContaining([
					"GET /_questpie/query/tickets.searchByReference",
					"GET /_questpie/query/tickets.queue",
					"POST /_questpie/mutation/ticket.addComment",
					"POST /_questpie/action/notification.sendTicketSummary",
				]),
				commentBody: firefoxComment,
				databaseOwnedUpdateAdvanced: true,
				jobRunId: expect.stringMatching(/^[0-9a-f-]{36}$/),
				lifecycleError: { code: "INVALID_TICKET", status: 422 },
				phase: "firefox-complete",
				reference: supportTracerIds.referenceOpen,
				role: "agent",
				watchedCommentObserved: true,
			});
			expect(
				(browserOperationRequests as readonly unknown[]).some(
					(entry) =>
						typeof entry === "string" && entry.includes("/_questpie/operation"),
				),
			).toBe(false);
			const browserReceipts = (await (
				await fetch(`${receiverOrigin}/__receipts`)
			).json()) as Readonly<{ receipts: readonly unknown[] }>;
			expect(browserReceipts.receipts.length).toBeGreaterThanOrEqual(1);
			await stop(observedHost.child, "SIGTERM");
			await observedHost.stderr;
			await stop(browser, "SIGTERM");
			expect(await app.durable.inspect(browserJobRunId)).toMatchObject({
				attemptCount: 0,
			});
			const attemptHost = await startHost(
				temporary,
				firstHost.port,
				hostWorker,
				telemetryReceiver.url.href,
			);
			cleanup.defer(() => stop(attemptHost.child, "SIGTERM"));
			await eventually(() => app.durable.inspect(browserJobRunId), {
				accept: (run) => run?.state === "succeeded",
				description: "post-restart Firefox Mutation Job reaches terminal state",
				intervalMilliseconds: 100,
				timeoutMilliseconds: 40_000,
			});
			await stop(attemptHost.child, "SIGTERM");
			await eventually(() => traceBodies.length, {
				accept: (length) => length > 0,
				description: "recovered Team Support host exports OTLP traces",
			});
			const spans = traceBodies.flatMap((body) => normalizeOtlpSpanGraph(body));
			const accepted = spans.filter(
				(span) =>
					span.name === "job job:ticket.slaFollowUp accept" &&
					span.attributes["questpie.run.id"] === browserJobRunId,
			);
			const attempts = spans.filter(
				(span) =>
					span.name === "job job:ticket.slaFollowUp attempt" &&
					span.attributes["questpie.run.id"] === browserJobRunId,
			);
			expect(accepted).toHaveLength(1);
			expect(attempts).toHaveLength(1);
			expect(attempts[0]).toMatchObject({
				links: [
					{
						spanId: accepted[0]!.spanId,
						traceId: accepted[0]!.traceId,
					},
				],
				parentSpanId: null,
			});
			expect(attempts[0]!.traceId).not.toBe(accepted[0]!.traceId);
		} finally {
			try {
				await cleanup.dispose();
			} finally {
				await database!
					.unsafe(
						'DROP SCHEMA IF EXISTS "team_support_desk" CASCADE; DROP SCHEMA IF EXISTS questpie_internal CASCADE; DROP TABLE IF EXISTS support_auth_verification, support_auth_account, support_auth_session, support_auth_user CASCADE;',
					)
					.finally(() =>
						database!.unsafe("DROP ROLE IF EXISTS questpie_tsd_managed_writer"),
					);
			}
		}
	},
	180_000,
);
