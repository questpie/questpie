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
import { installQuestpieForTracer } from "../../support/beta12-packed-questpie";

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
}>;

async function startHost(
	root: string,
	port: number,
	worker: Readonly<{
		attemptDeadlineMilliseconds: number;
		heartbeatMilliseconds: number;
		leaseMilliseconds: number;
	}>,
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
		},
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});
	const line = await waitForOutputLine(child.stdout, {
		accept: (candidate) => candidate.includes('"event":"ready"'),
		description: "Team Support Desk host readiness",
		timeoutMilliseconds: 30_000,
	});
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
			runCli(temporary, ["build"]);
			runCli(temporary, ["migration", "apply"]);
			runCli(temporary, ["migration", "apply"]);
			expect(runCli(temporary, ["seed", "apply"])).toContain("new");
			expect(runCli(temporary, ["seed", "apply"])).toContain("0 new");
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

			const app = await createApp({
				postgres: {
					connectionUrl: postgresUrl(),
					directConnectionUrl: postgresUrl(),
				},
				realtime: { hmacKey: new Uint8Array(32).fill(41) },
				maintenance: { authorize: () => true },
			});
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
					return {
						queue,
						emptyQueue,
						first,
						open,
						team,
						combined,
						searched,
						detail,
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
			await expect(
				app.execution(agentInput, ({ mutations }) =>
					mutations.ticket.create(
						{
							description: "Rejected by Collection validation.",
							reference: "INVALID-REFERENCE",
							summary: "Invalid lifecycle reference",
							teamId: supportTracerIds.teamPlatform,
						},
						{ callId: `direct:invalid-create:${crypto.randomUUID()}` },
					),
				),
			).rejects.toMatchObject({ code: "INVALID_TICKET", status: 422 });
			const edited = await app.execution(agentInput, ({ mutations }) =>
				mutations.ticket.edit(
					{
						ticketId: created.id,
						priority: "urgent",
						summary: "Production login consistently fails",
					},
					{ callId: `direct:edit:${crypto.randomUUID()}` },
				),
			);
			expect(edited).toMatchObject({ id: created.id, priority: "urgent" });
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
			const browserClient = createClient({
				baseUrl: authOrigin,
				fetch: (request) => {
					const headers = new Headers(request.headers);
					headers.set("cookie", cookie);
					return app.fetch(new Request(request, { headers }));
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
			await expect(
				browserClient.mutations["ticket.create"](
					{
						description: "Rejected over the generated client.",
						reference: "INVALID-REFERENCE",
						summary: "Invalid network lifecycle reference",
						teamId: supportTracerIds.teamPlatform,
					},
					{ callId: `browser:invalid-create:${crypto.randomUUID()}` },
				),
			).rejects.toMatchObject({ code: "INVALID_TICKET", status: 422 });

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

			const profile = join(temporary, "firefox-profile");
			await mkdir(profile);
			const firefoxComment = `Firefox operator update ${crypto.randomUUID()}`;
			const browserUrl = new URL(`http://127.0.0.1:${recoveredHost.port}/`);
			browserUrl.searchParams.set("tracerPersona", "agent");
			browserUrl.searchParams.set("tracerComment", firefoxComment);
			browserUrl.searchParams.set(
				"tracerReference",
				supportTracerIds.referenceOpen,
			);
			const browser = Bun.spawn(
				[
					firefoxBinary,
					"--headless",
					"--no-remote",
					"--profile",
					profile,
					browserUrl.toString(),
				],
				{
					env: { ...process.env, MOZ_HEADLESS: "1" },
					stdin: "ignore",
					stdout: "pipe",
					stderr: "pipe",
				},
			);
			cleanup.defer(() => stop(browser, "SIGKILL"));
			expect(
				await eventually(() => tracerReport(recoveredHost.port), {
					accept: (report) =>
						report?.phase === "firefox-complete" &&
						report.commentBody === firefoxComment,
					description: "Firefox generated-client Operator App journey",
					intervalMilliseconds: 100,
					timeoutMilliseconds: 40_000,
				}),
			).toMatchObject({
				authProvider: "better-auth",
				commentBody: firefoxComment,
				lifecycleError: { code: "INVALID_TICKET", status: 422 },
				phase: "firefox-complete",
				reference: supportTracerIds.referenceOpen,
				role: "agent",
			});
			const browserReceipts = (await (
				await fetch(`${receiverOrigin}/__receipts`)
			).json()) as Readonly<{ receipts: readonly unknown[] }>;
			expect(browserReceipts.receipts.length).toBeGreaterThanOrEqual(1);
			await stop(browser, "SIGTERM");
			await stop(recoveredHost.child, "SIGTERM");
		} finally {
			await cleanup.dispose();
			await database!.unsafe(
				'DROP SCHEMA IF EXISTS "team_support_desk" CASCADE; DROP SCHEMA IF EXISTS questpie_internal CASCADE; DROP TABLE IF EXISTS support_auth_verification, support_auth_account, support_auth_session, support_auth_user CASCADE;',
			);
		}
	},
	180_000,
);
