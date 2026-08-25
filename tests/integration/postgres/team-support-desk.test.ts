import { afterAll, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { SQL } from "bun";

import {
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
const sessionSecret = "team-support-desk-local-session-signing-key-v1";

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

type TicketSummary = Readonly<{
	id: string;
	organizationId: string;
	teamId: string;
	requesterMembershipId: string;
	assigneeMembershipId: string | null;
	reference: string;
	priority: string;
	status: string;
	summary: string;
	updatedAt: Date;
	team: Readonly<{ id: string; name: string; routingStatus: string }> | null;
	assignee: Readonly<{ id: string; principalId: string; role: string }> | null;
}>;
type TicketDetail = TicketSummary &
	Readonly<{
		description: string;
		createdAt: Date;
		closedAt: Date | null;
		lastSlaFollowUpAt: Date | null;
		requester: Readonly<{
			id: string;
			principalId: string;
			role: string;
		}> | null;
	}>;
type TicketPage = Readonly<{
	nodes: readonly TicketSummary[];
	pageInfo: Readonly<{ endCursor: string | null; hasNextPage: boolean }>;
}>;
type JobReceipt = Readonly<{ runId: string; resource: string }>;
type JobInput = Readonly<{
	organizationId: string;
	ticketId: string;
	reference: string;
	summary: string;
	dueAt: Date;
}>;
type RunView = Readonly<{
	runId: string;
	state: "cancelled" | "delayed" | "failed" | "ready" | "running" | "succeeded";
	attemptCount: number;
	currentAttemptId: string | null;
	resultBytes: Uint8Array | null;
	version: number;
}>;
type RunEvent = Readonly<{
	sequence: number;
	kind: string;
	attemptId: string | null;
	leaseTokenDigest: string | null;
}>;
type Scope = Readonly<{
	queries: Readonly<{
		tickets: Readonly<{
			list(
				input: Readonly<{ first: number; after: string | null }>,
			): Promise<TicketPage>;
			listByStatus(
				input: Readonly<{
					first: number;
					after: string | null;
					status: string;
				}>,
			): Promise<TicketPage>;
			listByTeam(
				input: Readonly<{
					first: number;
					after: string | null;
					teamId: string;
				}>,
			): Promise<TicketPage>;
			listByStatusAndTeam(
				input: Readonly<{
					first: number;
					after: string | null;
					status: string;
					teamId: string;
				}>,
			): Promise<TicketPage>;
			detail(input: Readonly<{ id: string }>): Promise<TicketDetail>;
			searchByReference(
				input: Readonly<{ reference: string }>,
			): Promise<TicketSummary | null>;
		}>;
	}>;
	mutations: Readonly<{
		ticket: Readonly<{
			create(
				input: Readonly<{
					teamId: string;
					reference: string;
					priority: string;
					summary: string;
					description: string;
				}>,
				options: Readonly<{ callId: string }>,
			): Promise<TicketDetail>;
			edit(
				input: Readonly<{
					ticketId: string;
					teamId?: string;
					priority?: string;
					summary?: string;
					description?: string;
				}>,
				options: Readonly<{ callId: string }>,
			): Promise<TicketDetail>;
			assign(
				input: Readonly<{
					ticketId: string;
					assigneeMembershipId: string | null;
				}>,
				options: Readonly<{ callId: string }>,
			): Promise<TicketDetail>;
			close(
				input: Readonly<{ ticketId: string }>,
				options: Readonly<{ callId: string }>,
			): Promise<TicketDetail>;
			reopen(
				input: Readonly<{ ticketId: string }>,
				options: Readonly<{ callId: string }>,
			): Promise<TicketDetail>;
			addComment(
				input: Readonly<{ ticketId: string; body: string }>,
				options: Readonly<{ callId: string }>,
			): Promise<Readonly<{ comment: unknown; job: JobReceipt }>>;
		}>;
	}>;
	actions: Readonly<{
		notification: Readonly<{
			sendTicketSummary(
				input: Readonly<{ ticketId: string }>,
				options: Readonly<{
					effectKey: string;
					callId?: string;
					timeoutMilliseconds?: number;
				}>,
			): Promise<
				Readonly<{
					effectId: string;
					ticketReference: string;
					providerReceipt: string;
				}>
			>;
		}>;
	}>;
	jobs: Readonly<{
		ticket: Readonly<{
			slaFollowUp: Readonly<{
				accept(
					input: JobInput,
					options: Readonly<{ idempotencyKey: string; notBefore?: Date }>,
				): Promise<JobReceipt>;
			}>;
		}>;
	}>;
}>;
type Durable = Readonly<{
	worker(
		options: Readonly<{
			workerId: string;
			claimBatch?: number;
			leaseMilliseconds: number;
			heartbeatMilliseconds: number;
			attemptDeadlineMilliseconds: number;
		}>,
	): Readonly<{ poll(): Promise<unknown>; beginDrain(): void }>;
	inspect(runId: string): Promise<RunView | null>;
	events(runId: string): Promise<readonly RunEvent[]>;
	cancelRun(
		input: Readonly<{
			runId: string;
			reason: string;
			actor: unknown;
			expectedVersion?: number;
		}>,
	): Promise<Readonly<{ outcome: string; stateAfter: string }>>;
}>;
type GeneratedApp = Readonly<{
	execution<Result>(
		input: Readonly<{
			principal: unknown;
			context: Readonly<{ organizationId: string; membershipId: string }>;
		}>,
		use: (scope: Scope) => Result | Promise<Result>,
	): Promise<Awaited<Result>>;
	fetch(request: Request): Promise<Response>;
	durable: Durable;
	close(): Promise<void>;
}>;

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

async function sessionToken(principalId: string): Promise<string> {
	const unsigned = `v1.${principalId}.2000000000`;
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(sessionSecret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign(
		"HMAC",
		key,
		new TextEncoder().encode(unsigned),
	);
	return `${unsigned}.${Buffer.from(signature).toString("base64url")}`;
}

function executionInput(
	principal: unknown,
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
	worker: ReturnType<Durable["worker"]>,
	timeoutMilliseconds = 30_000,
): Promise<RunView> {
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
			accept: (run): run is RunView =>
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
		const temporary = await mkdtemp(join(tmpdir(), "questpie-team-support-"));
		cleanup.defer(() => rm(temporary, { force: true, recursive: true }));
		try {
			// Repository PostgreSQL setup/cleanup only. No application assertion below
			// reads framework or application tables.
			await database!.unsafe(
				'DROP SCHEMA IF EXISTS "team_support_desk" CASCADE; DROP SCHEMA IF EXISTS questpie_internal CASCADE;',
			);
			await cp(fixtureRoot, temporary, { recursive: true });
			const questpieEntry = await installQuestpieForTracer(temporary);
			runCli(temporary, ["build"]);
			runCli(temporary, ["migration", "apply"]);
			runCli(temporary, ["migration", "apply"]);
			expect(runCli(temporary, ["seed", "apply"])).toContain("new");
			expect(runCli(temporary, ["seed", "apply"])).toContain("0 new");

			const [{ createApp }, { createClient }, { principal }] =
				await Promise.all([
					import(
						`${pathToFileURL(join(temporary, ".questpie/generated/app.ts")).href}?app=${crypto.randomUUID()}`
					) as Promise<
						Readonly<{ createApp(input: unknown): Promise<GeneratedApp> }>
					>,
					import(
						`${pathToFileURL(join(temporary, ".questpie/generated/client.ts")).href}?client=${crypto.randomUUID()}`
					) as Promise<
						Readonly<{
							createClient(
								input: Readonly<{ baseUrl: string; fetch?: typeof fetch }>,
							): Readonly<{
								withContext(
									input: Readonly<{
										organizationId: string;
										membershipId: string;
									}>,
								): Readonly<{
									queries: Readonly<{
										"tickets.list": (
											input: Readonly<{ first: number; after: string | null }>,
										) => Promise<TicketPage>;
									}>;
								}>;
							}>;
						}>
					>,
					import(
						`${pathToFileURL(questpieEntry).href}?principal=${crypto.randomUUID()}`
					) as Promise<
						Readonly<{
							principal: Readonly<{
								user(input: Readonly<{ id: string }>): unknown;
							}>;
						}>
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
					const first = await queries.tickets.list({ after: null, first: 1 });
					const open = await queries.tickets.listByStatus({
						after: null,
						first: 10,
						status: "open",
					});
					const team = await queries.tickets.listByTeam({
						after: null,
						first: 10,
						teamId: supportTracerIds.teamPlatform,
					});
					const combined = await queries.tickets.listByStatusAndTeam({
						after: null,
						first: 10,
						status: "open",
						teamId: supportTracerIds.teamPlatform,
					});
					const searched = await queries.tickets.searchByReference({
						reference: supportTracerIds.referenceOpen,
					});
					const detail = await queries.tickets.detail({
						id: supportTracerIds.ticketOpen,
					});
					return { first, open, team, combined, searched, detail };
				},
			);
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
						reference: `SUP-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
						summary: "Production login intermittently fails",
						teamId: supportTracerIds.teamPlatform,
					},
					{ callId: `direct:create:${crypto.randomUUID()}` },
				),
			);
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
					({ queries }) => queries.tickets.list({ after: null, first: 10 }),
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

			const cookie = `questpie_team_support_session=${await sessionToken(supportTracerIds.principalAgent)}`;
			const browserClient = createClient({
				baseUrl: "https://team-support.test",
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
					await browserClient.queries["tickets.list"]({
						after: null,
						first: 20,
					})
				).nodes.some(({ id }) => id === created.id),
			).toBe(true);

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
				attemptDeadlineMilliseconds: 500,
			});
			const immediateTerminal = await driveUntilTerminal(
				app,
				comment.job.runId,
				worker,
			);
			expect(immediateTerminal.state).toBe("succeeded");

			const acceptJob = (
				input: JobInput,
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
			browserUrl.searchParams.set("persona", "agent");
			browserUrl.searchParams.set("tracerComment", firefoxComment);
			browserUrl.searchParams.set(
				"tracerReference",
				supportTracerIds.referenceOpen,
			);
			const browser = Bun.spawn(
				[
					"/usr/bin/firefox",
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
				commentBody: firefoxComment,
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
				'DROP SCHEMA IF EXISTS "team_support_desk" CASCADE; DROP SCHEMA IF EXISTS questpie_internal CASCADE;',
			);
		}
	},
	180_000,
);
