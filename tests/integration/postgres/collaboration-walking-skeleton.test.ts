import { afterAll, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { SQL } from "bun";

import { tracerIds } from "../../../fixtures/collaboration/tracer/constants";
import {
	CleanupStack,
	eventually,
	waitForOutputLine,
} from "../../../packages/testkit/src";
import { installQuestpieForTracer } from "../../support/beta12-packed-questpie";

const repositoryRoot = resolve(import.meta.dir, "../../..");
const fixtureRoot = resolve(repositoryRoot, "fixtures/collaboration");
const cli = resolve(repositoryRoot, "packages/questpie/dist/cli.js");
const database = process.env.PGHOST ? new SQL({ max: 4 }) : undefined;
const postgresTest = process.env.PGHOST ? test : test.skip;

function postgresUrl(): string {
	const url = new URL("postgres://localhost/");
	url.hostname = process.env.PGHOST ?? "127.0.0.1";
	url.port = process.env.PGPORT ?? "5432";
	url.username = process.env.PGUSER ?? "postgres";
	url.pathname = `/${process.env.PGDATABASE ?? "postgres"}`;
	if (process.env.PGPASSWORD) url.password = process.env.PGPASSWORD;
	return url.toString();
}

function ownErrorBytes(error: unknown): string {
	if (!error || typeof error !== "object") return JSON.stringify(error);
	return JSON.stringify(
		Object.fromEntries(
			Object.getOwnPropertyNames(error)
				.sort()
				.map((key) => [key, (error as Record<string, unknown>)[key]]),
		),
	);
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

async function startHost(
	root: string,
	port: number,
	options: Readonly<{
		pauseWorker?: boolean;
		leaseMilliseconds?: number;
		heartbeatMilliseconds?: number;
		attemptDeadlineMilliseconds?: number;
	}> = {},
): Promise<
	Readonly<{
		child: Child;
		output: ReadableStream<Uint8Array>;
		port: number;
	}>
> {
	const child = Bun.spawn(["bun", "tracer/host.ts", `--port=${port}`], {
		cwd: root,
		env: {
			...process.env,
			DATABASE_URL: postgresUrl(),
			...(options.pauseWorker ? { QUESTPIE_TRACER_PAUSE_WORKER: "1" } : {}),
			...(options.leaseMilliseconds === undefined
				? {}
				: {
						QUESTPIE_TRACER_WORKER_LEASE_MILLISECONDS: String(
							options.leaseMilliseconds,
						),
					}),
			...(options.heartbeatMilliseconds === undefined
				? {}
				: {
						QUESTPIE_TRACER_WORKER_HEARTBEAT_MILLISECONDS: String(
							options.heartbeatMilliseconds,
						),
					}),
			...(options.attemptDeadlineMilliseconds === undefined
				? {}
				: {
						QUESTPIE_TRACER_WORKER_ATTEMPT_DEADLINE_MILLISECONDS: String(
							options.attemptDeadlineMilliseconds,
						),
					}),
		},
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});
	const [readiness, output] = child.stdout.tee();
	const line = await waitForOutputLine(readiness, {
		accept: (candidate) => candidate.includes('"event":"ready"'),
		description: "collaboration tracer host readiness",
		timeoutMilliseconds: 30_000,
	});
	const ready = JSON.parse(line) as Readonly<{ port?: unknown }>;
	if (!Number.isSafeInteger(ready.port) || Number(ready.port) <= 0)
		throw new TypeError("collaboration tracer readiness port is invalid");
	return Object.freeze({ child, output, port: Number(ready.port) });
}

type JobAttemptProbe = Readonly<{
	attemptNumber: number;
	contextResolutionId: string;
	invocationId: string;
	role: string;
	runId: string;
}>;

type GeneratedDurableWorkerTrace = Readonly<{
	workerId: string;
	claimed: number;
	outcomes: readonly Readonly<{
		attemptNumber: number;
		failureCode: string | null;
		outcome: string;
		runId: string;
	}>[];
}>;

type GeneratedDurableWorker = Readonly<{
	poll(): Promise<GeneratedDurableWorkerTrace>;
	beginDrain(): void;
}>;

type TracerReport = Readonly<{
	phase?: unknown;
	whoami?: Readonly<{
		principal?: Readonly<{ id?: unknown; kind?: unknown }>;
	}>;
}>;

type DeliveryActionResult = Readonly<{
	attempt: number;
	disposals: number;
	receipt: string;
}>;

type DeliveryAction = (
	input: Readonly<{ effectKey: string; message: string }>,
	options: Readonly<{
		effectKey: string;
		callId?: string;
		timeoutMilliseconds?: number;
	}>,
) => Promise<DeliveryActionResult>;

type GeneratedExecutionScope = Readonly<{
	actions: Readonly<{
		delivery: Readonly<{ publish: DeliveryAction }>;
	}>;
	queries: Readonly<{
		messages: Readonly<{ page: unknown }>;
	}>;
	mutations: Readonly<{
		message: Readonly<{
			publish: unknown;
			requestDigest(
				input: Readonly<{ companyId: string }>,
				options: Readonly<{ callId: string }>,
			): Promise<Readonly<{ runId: string; resource: string }>>;
		}>;
	}>;
	jobs: Readonly<{
		reports: Readonly<{
			companyDigest: Readonly<{
				accept(
					input: Readonly<{
						companyId: string;
						restartProbe?: "hardRestart" | "staleSettlement";
					}>,
					options: Readonly<{
						idempotencyKey: string;
						notBefore?: Date;
					}>,
				): Promise<Readonly<{ runId: string; resource: string }>>;
			}>;
		}>;
	}>;
	services: Readonly<{
		"audit.execution": unknown;
		"collaboration.demo-auth": unknown;
	}>;
}>;

type GeneratedNetworkClient = Readonly<{
	withContext(input: Readonly<{ companyId: string }>): Readonly<{
		actions: Readonly<{ "delivery.publish": DeliveryAction }>;
	}>;
}>;

async function report(port: number): Promise<TracerReport | null> {
	try {
		const response = await fetch(
			`http://127.0.0.1:${port}/__questpie_tracer/report`,
		);
		if (!response.ok) return null;
		const body = (await response.json()) as unknown;
		return body && typeof body === "object" && !Array.isArray(body)
			? (body as TracerReport)
			: null;
	} catch {
		return null;
	}
}

async function waitForBlockedLifecycleChannelRead(): Promise<void> {
	for (let attempt = 0; attempt < 200; attempt += 1) {
		const [result] = await database!.unsafe<
			Readonly<Array<{ blocked: boolean }>>
		>(`SELECT EXISTS (
  SELECT 1
  FROM pg_catalog.pg_stat_activity
  WHERE pid <> pg_catalog.pg_backend_pid()
    AND query LIKE '%FROM "collaboration"."channels"%'
    AND pg_catalog.cardinality(pg_catalog.pg_blocking_pids(pid)) > 0
) AS blocked`);
		if (result?.blocked) return;
		await Bun.sleep(10);
	}
	throw new Error("Mutation did not reach the lifecycle Channel Policy read");
}

afterAll(async () => {
	await database?.close({ timeout: 0 });
});

postgresTest(
	"runs compile, migrate, seed, Query, Mutation, browser Live Query, and durable recovery",
	async () => {
		const cleanup = new CleanupStack();
		const temporary = await mkdtemp(
			join(tmpdir(), "questpie-walking-skeleton-"),
		);
		cleanup.defer(() => rm(temporary, { force: true, recursive: true }));
		try {
			await database!.unsafe(
				'DROP SCHEMA IF EXISTS "collaboration" CASCADE; DROP SCHEMA IF EXISTS questpie_internal CASCADE;',
			);
			await cp(fixtureRoot, temporary, { recursive: true });
			const questpieEntry = await installQuestpieForTracer(temporary);

			runCli(temporary, ["build"]);
			runCli(temporary, ["migration", "apply"]);
			expect(runCli(temporary, ["seed", "apply"])).toContain(
				"2 new, 0 already applied",
			);
			expect(runCli(temporary, ["seed", "apply"])).toContain(
				"0 new, 2 already applied",
			);

			const [{ createApp }, { createClient }, { principal }] =
				await Promise.all([
					import(
						`${pathToFileURL(join(temporary, ".questpie/generated/app.ts")).href}?direct=${crypto.randomUUID()}`
					) as Promise<
						Readonly<{
							createApp(input: unknown): Promise<{
								execution<Result>(
									input: Readonly<{
										principal: unknown;
										context: Readonly<{ companyId: string }>;
										signal?: AbortSignal;
										deadline?: number;
									}>,
									use: (
										scope: GeneratedExecutionScope,
									) => Result | Promise<Result>,
								): Promise<Awaited<Result>>;
								fetch(request: Request): Promise<Response>;
								durable: Readonly<{
									worker(
										options?: Readonly<{
											workerId?: string;
											claimBatch?: number;
											leaseMilliseconds?: number;
											heartbeatMilliseconds?: number;
											attemptDeadlineMilliseconds?: number;
										}>,
									): GeneratedDurableWorker;
									cancelRun(
										input: Readonly<{
											runId: string;
											reason: string;
											actor: unknown;
										}>,
									): Promise<unknown>;
								}>;
								routes: Readonly<
									Record<
										string,
										Readonly<{
											direct(input: unknown): Promise<Response>;
										}>
									>
								>;
								close(): Promise<void>;
							}>;
						}>
					>,
					import(
						`${pathToFileURL(join(temporary, ".questpie/generated/client.ts")).href}?network=${crypto.randomUUID()}`
					) as Promise<
						Readonly<{
							createClient(
								input: Readonly<{
									baseUrl: string;
									fetch(request: Request): Promise<Response>;
								}>,
							): GeneratedNetworkClient;
						}>
					>,
					import(
						`${pathToFileURL(questpieEntry).href}?principal=route`
					) as Promise<
						Readonly<{
							principal: Readonly<{
								anonymous(): unknown;
								user(input: Readonly<{ id: string }>): unknown;
							}>;
						}>
					>,
				]);
			const routeApplication = await createApp({
				postgres: {
					connectionUrl: postgresUrl(),
					directConnectionUrl: postgresUrl(),
				},
				realtime: { hmacKey: new Uint8Array(32).fill(23) },
				maintenance: { authorize: () => false },
			});
			type PostgresFacts = Readonly<{
				state: string;
				generation: number;
				pool: Readonly<{ max: number; total: number }>;
				listener: string | Readonly<{ state: string; generation: number }>;
			}>;
			const postgresFacts = () =>
				(
					routeApplication as unknown as Readonly<
						Record<symbol, () => PostgresFacts>
					>
				)[Symbol.for("questpie.internal.postgres-facts")]!();
			expect(postgresFacts()).toMatchObject({
				state: "ready",
				generation: 1,
				pool: { max: 10 },
				listener: { state: "healthy", generation: 1 },
			});
			try {
				const executionInput = {
					principal: principal.user({ id: tracerIds.principal }),
					context: { companyId: tracerIds.company },
				};
				let escapedAction: DeliveryAction | undefined;
				const invokeDelivery = (
					input: Readonly<{ effectKey: string; message: string }>,
					options: Parameters<DeliveryAction>[1],
				) =>
					routeApplication.execution(
						executionInput,
						({ actions, mutations, queries, services }) => {
							expect(Object.hasOwn(services, "delivery.provider")).toBe(false);
							expect(Object.hasOwn(services, "audit.execution")).toBe(true);
							expect(Object.hasOwn(services, "collaboration.demo-auth")).toBe(
								true,
							);
							expect(Object.getPrototypeOf(actions)).toBeNull();
							expect(Object.isFrozen(actions)).toBe(true);
							expect(Object.getPrototypeOf(actions.delivery)).toBeNull();
							expect(Object.isFrozen(actions.delivery)).toBe(true);
							expect(Object.getPrototypeOf(queries)).toBeNull();
							expect(Object.isFrozen(queries)).toBe(true);
							expect(Object.getPrototypeOf(queries.messages)).toBeNull();
							expect(Object.isFrozen(queries.messages)).toBe(true);
							expect(Object.getPrototypeOf(mutations)).toBeNull();
							expect(Object.isFrozen(mutations)).toBe(true);
							expect(Object.getPrototypeOf(mutations.message)).toBeNull();
							expect(Object.isFrozen(mutations.message)).toBe(true);
							escapedAction = actions.delivery.publish;
							return actions.delivery.publish(input, options);
						},
					);
				const generatedWire = JSON.parse(
					await Bun.file(
						join(temporary, ".questpie/generated/wire-contract.json"),
					).text(),
				) as Readonly<{
					clientContractDigest: string;
					compatibility: Readonly<{
						wireV1Digest: string;
						wireV2Digest: string;
					}>;
				}>;
				for (const legacyDigest of [
					generatedWire.compatibility.wireV1Digest,
					generatedWire.compatibility.wireV2Digest,
				]) {
					const outdated = await routeApplication.fetch(
						new Request("https://app.test/_questpie/operation", {
							method: "POST",
							headers: {
								"content-type":
									"application/vnd.questpie.operation+json;version=1",
							},
							body: JSON.stringify({
								protocol: { name: "questpie.operation", version: 1 },
								application: "application:collaboration",
								clientContractDigest: generatedWire.clientContractDigest,
								wireDigest: legacyDigest,
								operation: "action:delivery.publish",
								callId: "legacy-action-call",
								context: { companyId: tracerIds.company },
								input: { effectKey: "domain-legacy", message: "never-run" },
								timeoutMilliseconds: 500,
							}),
						}),
					);
					expect(outdated.status).toBe(409);
					expect(await outdated.json()).toEqual({
						kind: "failure",
						error: { code: "CLIENT_OUTDATED", retryable: false },
					});
				}

				await expect(
					routeApplication.execution(
						{
							principal: principal.anonymous(),
							context: { companyId: tracerIds.company },
						},
						({ actions }) =>
							actions.delivery.publish(
								{ effectKey: "domain-denied", message: "denied" },
								{ effectKey: "denied-provider-request" },
							),
					),
				).rejects.toMatchObject({ code: "unauthenticated" });

				const stableEffectKey = "provider-request-2026-08-24-0001";
				const effectId = "6a58264b-7e1b-58db-abfa-b46e3cd5cd7f";
				const firstDelivery = await invokeDelivery(
					{ effectKey: "domain-input-one", message: "delivery-first" },
					{
						effectKey: stableEffectKey,
						callId: "delivery-direct-1",
						timeoutMilliseconds: 900,
					},
				);
				expect(firstDelivery).toEqual({
					attempt: 1,
					disposals: 0,
					receipt: `delivery:${effectId}`,
				});
				const secondDelivery = await invokeDelivery(
					{ effectKey: "domain-input-two", message: "delivery-second" },
					{
						effectKey: stableEffectKey,
						callId: "delivery-direct-2",
						timeoutMilliseconds: 800,
					},
				);
				expect(secondDelivery).toEqual({
					attempt: 2,
					disposals: 1,
					receipt: `delivery:${effectId}`,
				});
				let transportCalls = 0;
				const wireErrorBytes = new Map<string, string>();
				const networkClient = createClient({
					baseUrl: "https://app.test",
					fetch: async (request) => {
						transportCalls += 1;
						const headers = new Headers(request.headers);
						headers.set(
							"cookie",
							"questpie_tracer_session=f18f8b8e0e1446079dc6e6d4755505f9",
						);
						const response = await routeApplication.fetch(
							new Request(request, { headers }),
						);
						if (response.status >= 400) {
							const frame = (await response.clone().json()) as Readonly<{
								kind?: unknown;
								error?: unknown;
							}>;
							if (
								(frame.kind === "declaredError" || frame.kind === "failure") &&
								frame.error &&
								typeof frame.error === "object" &&
								"code" in frame.error
							)
								wireErrorBytes.set(
									String(frame.error.code),
									ownErrorBytes(frame.error),
								);
						}
						return response;
					},
				}).withContext({ companyId: tracerIds.company });
				const missingChannelId = "00000000-0000-4000-8000-000000000071";
				const foreignCompanyId = "00000000-0000-4000-8000-000000000072";
				const foreignSpaceId = "00000000-0000-4000-8000-000000000073";
				const foreignChannelId = "00000000-0000-4000-8000-000000000074";
				await database!.unsafe(
					"INSERT INTO collaboration.companies (id, name) VALUES ($1, 'Foreign company')",
					[foreignCompanyId],
				);
				await database!.unsafe(
					"INSERT INTO collaboration.spaces (id, company_id, name) VALUES ($1, $2, 'Foreign space')",
					[foreignSpaceId, foreignCompanyId],
				);
				await database!.unsafe(
					"INSERT INTO collaboration.channels (id, space_id, name) VALUES ($1, $2, 'foreign-channel')",
					[foreignChannelId, foreignSpaceId],
				);
				const rejectedCheckCallIds: string[] = [];
				const assertChannelUnavailable = (error: unknown): string => {
					expect(error).toMatchObject({
						code: "CHANNEL_UNAVAILABLE",
						payload: null,
						status: 404,
					});
					expect(Object.keys(error as object).sort()).toEqual([
						"code",
						"payload",
						"status",
					]);
					return ownErrorBytes(error);
				};
				let stableChannelUnavailableBytes: string | undefined;
				for (const [label, channelId] of [
					["missing", missingChannelId],
					["policy-invisible", foreignChannelId],
				] as const) {
					const directCallId = `direct:check:${label}:${crypto.randomUUID()}`;
					const networkCallId = `network:check:${label}:${crypto.randomUUID()}`;
					rejectedCheckCallIds.push(directCallId, networkCallId);
					let directError: unknown;
					try {
						await routeApplication.execution(executionInput, ({ mutations }) =>
							mutations.message.publish(
								{ body: `check-${label}-direct`, channelId },
								{ callId: directCallId },
							),
						);
					} catch (error) {
						directError = error;
					}
					const directBytes = assertChannelUnavailable(directError);
					stableChannelUnavailableBytes ??= directBytes;
					expect(directBytes).toBe(stableChannelUnavailableBytes);

					let clientError: unknown;
					try {
						await networkClient.mutations["message.publish"](
							{ body: `check-${label}-network`, channelId },
							{ callId: networkCallId },
						);
					} catch (error) {
						clientError = error;
					}
					const clientBytes = assertChannelUnavailable(clientError);
					expect(clientBytes).toBe(directBytes);
					expect(wireErrorBytes.get("CHANNEL_UNAVAILABLE")).toBe(directBytes);
				}
				for (const secret of [
					"collection:messages",
					"issue:messages/channelUnavailable",
					foreignCompanyId,
					foreignSpaceId,
					foreignChannelId,
					missingChannelId,
					"candidate",
					"Policy",
					"PostgreSQL",
					"stack",
				])
					expect(stableChannelUnavailableBytes).not.toContain(secret);
				const [rejectedCheckWrites] = await database!.unsafe<
					Readonly<
						Array<{ dispatches: number; messages: number; receipts: number }>
					>
				>(
					`SELECT
  (SELECT count(*)::int FROM collaboration.messages WHERE body LIKE 'check-%') AS messages,
  (SELECT count(*)::int FROM questpie_internal.durable_dispatches WHERE call_id IN ($1, $2, $3, $4)) AS dispatches,
  (SELECT count(*)::int FROM questpie_internal.mutation_call_receipts WHERE call_id IN ($1, $2, $3, $4)) AS receipts`,
					rejectedCheckCallIds,
				);
				expect(rejectedCheckWrites).toEqual({
					dispatches: 0,
					messages: 0,
					receipts: 0,
				});
				const assertNoMutationRecords = async (
					callId: string,
					body: string,
				) => {
					const [counts] = await database!.unsafe<
						Readonly<
							Array<{ dispatches: number; messages: number; receipts: number }>
						>
					>(
						`SELECT
  (SELECT count(*)::int FROM collaboration.messages WHERE body = $2) AS messages,
  (SELECT count(*)::int FROM questpie_internal.durable_dispatches WHERE call_id = $1) AS dispatches,
  (SELECT count(*)::int FROM questpie_internal.mutation_call_receipts WHERE call_id = $1) AS receipts`,
						[callId, body],
					);
					expect(counts).toEqual({ dispatches: 0, messages: 0, receipts: 0 });
				};
				const blocker = await database!.reserve();
				try {
					await blocker.unsafe("BEGIN");
					await blocker.unsafe(
						"LOCK TABLE collaboration.channels IN ACCESS EXCLUSIVE MODE",
					);
					const raceCallId = `direct:check:race:${crypto.randomUUID()}`;
					const raceBody = "check-current-policy-race";
					const raced = routeApplication.execution(
						executionInput,
						({ mutations }) =>
							mutations.message.publish(
								{ body: raceBody, channelId: tracerIds.channel },
								{ callId: raceCallId },
							),
					);
					await waitForBlockedLifecycleChannelRead();
					await database!.unsafe(
						"UPDATE collaboration.memberships SET status = 'inactive' WHERE company_id = $1 AND principal_id = $2 AND scope_key = 'company'",
						[tracerIds.company, tracerIds.principal],
					);
					await blocker.unsafe("COMMIT");
					let raceError: unknown;
					try {
						await raced;
					} catch (error) {
						raceError = error;
					}
					expect(assertChannelUnavailable(raceError)).toBe(
						stableChannelUnavailableBytes,
					);
					await assertNoMutationRecords(raceCallId, raceBody);
					await database!.unsafe(
						"UPDATE collaboration.memberships SET status = 'active' WHERE company_id = $1 AND principal_id = $2 AND scope_key = 'company'",
						[tracerIds.company, tracerIds.principal],
					);

					await blocker.unsafe("BEGIN");
					await blocker.unsafe(
						"LOCK TABLE collaboration.channels IN ACCESS EXCLUSIVE MODE",
					);
					const cancelledCallId = `direct:check:cancel:${crypto.randomUUID()}`;
					const cancelledBody = "check-cancelled-read";
					const cancellation = new AbortController();
					const cancellationReason = new DOMException(
						"lifecycle caller cancelled",
						"AbortError",
					);
					const cancelled = routeApplication.execution(
						{ ...executionInput, signal: cancellation.signal },
						({ mutations }) =>
							mutations.message.publish(
								{ body: cancelledBody, channelId: tracerIds.channel },
								{ callId: cancelledCallId },
							),
					);
					await waitForBlockedLifecycleChannelRead();
					cancellation.abort(cancellationReason);
					await blocker.unsafe("COMMIT");
					await expect(cancelled).rejects.toBe(cancellationReason);
					await assertNoMutationRecords(cancelledCallId, cancelledBody);

					await blocker.unsafe("BEGIN");
					await blocker.unsafe(
						"LOCK TABLE collaboration.channels IN ACCESS EXCLUSIVE MODE",
					);
					const deadlineCallId = `direct:check:deadline:${crypto.randomUUID()}`;
					const deadlineBody = "check-deadline-read";
					const expired = routeApplication.execution(
						{ ...executionInput, deadline: Date.now() + 500 },
						({ mutations }) =>
							mutations.message.publish(
								{ body: deadlineBody, channelId: tracerIds.channel },
								{ callId: deadlineCallId },
							),
					);
					await waitForBlockedLifecycleChannelRead();
					await expect(expired).rejects.toMatchObject({
						code: "DEADLINE_EXCEEDED",
						retryable: true,
					});
					await blocker.unsafe("COMMIT");
					await assertNoMutationRecords(deadlineCallId, deadlineBody);
				} finally {
					await blocker.unsafe("ROLLBACK").catch(() => {});
					await blocker.release();
					await database!.unsafe(
						"UPDATE collaboration.memberships SET status = 'active' WHERE company_id = $1 AND principal_id = $2 AND scope_key = 'company'",
						[tracerIds.company, tracerIds.principal],
					);
				}
				const hostileBody = "__questpie_hostile_invalid_event__";
				const directLifecycleCallId = `direct:lifecycle:${crypto.randomUUID()}`;
				let directLifecycleError: unknown;
				try {
					await routeApplication.execution(executionInput, ({ mutations }) =>
						mutations.message.publish(
							{ body: hostileBody, channelId: tracerIds.channel },
							{ callId: directLifecycleCallId },
						),
					);
				} catch (error) {
					directLifecycleError = error;
				}
				expect(directLifecycleError).toMatchObject({
					code: "PUBLICATION_REJECTED",
					payload: null,
					status: 422,
				});
				expect(Object.keys(directLifecycleError as object).sort()).toEqual([
					"code",
					"payload",
					"status",
				]);
				const directLifecycleErrorBytes = ownErrorBytes(directLifecycleError);
				const networkLifecycleCallId = `network:lifecycle:${crypto.randomUUID()}`;
				let clientLifecycleError: unknown;
				try {
					await networkClient.mutations["message.publish"](
						{ body: hostileBody, channelId: tracerIds.channel },
						{ callId: networkLifecycleCallId },
					);
				} catch (error) {
					clientLifecycleError = error;
				}
				expect(clientLifecycleError).toMatchObject({
					code: "PUBLICATION_REJECTED",
					payload: null,
					status: 422,
				});
				expect(Object.keys(clientLifecycleError as object).sort()).toEqual([
					"code",
					"payload",
					"status",
				]);
				const clientLifecycleErrorBytes = ownErrorBytes(clientLifecycleError);
				expect(clientLifecycleErrorBytes).toBe(directLifecycleErrorBytes);
				expect(wireErrorBytes.get("PUBLICATION_REJECTED")).toBe(
					directLifecycleErrorBytes,
				);
				for (const secret of [
					"collection:messageEvents",
					"issue:messageEvents/invalidKind",
					hostileBody,
					"candidate",
					"Policy",
					"PostgreSQL",
					"stack",
					"sourceURL",
					"originalLine",
					"originalColumn",
					"line",
					"column",
				])
					for (const evidence of [
						ownErrorBytes(directLifecycleError),
						ownErrorBytes(clientLifecycleError),
						wireErrorBytes.get("PUBLICATION_REJECTED")!,
					])
						expect(evidence).not.toContain(secret);
				const afterRejectedLifecycle = await routeApplication.execution(
					executionInput,
					({ queries }) =>
						queries.messages.page({
							after: null,
							channelId: tracerIds.channel,
							first: 100,
						}),
				);
				expect(
					afterRejectedLifecycle.nodes.some(({ body }) => body === hostileBody),
				).toBe(false);
				const [rejectedLifecycleWrites] = await database!.unsafe<
					Readonly<Array<{ dispatches: number; receipts: number }>>
				>(
					`SELECT
  (SELECT count(*)::int FROM questpie_internal.durable_dispatches WHERE call_id IN ($1, $2)) AS dispatches,
  (SELECT count(*)::int FROM questpie_internal.mutation_call_receipts WHERE call_id IN ($1, $2)) AS receipts`,
					[directLifecycleCallId, networkLifecycleCallId],
				);
				expect(rejectedLifecycleWrites).toEqual({
					dispatches: 0,
					receipts: 0,
				});
				const hostileConstraintBody = "__questpie_hostile_missing_message__";
				let directConstraintError: unknown;
				try {
					await routeApplication.execution(executionInput, ({ mutations }) =>
						mutations.message.publish(
							{
								body: hostileConstraintBody,
								channelId: tracerIds.channel,
							},
							{ callId: `direct:constraint:${crypto.randomUUID()}` },
						),
					);
				} catch (error) {
					directConstraintError = error;
				}
				expect(directConstraintError).toMatchObject({
					code: "INTERNAL",
					retryable: false,
				});
				expect(Object.keys(directConstraintError as object).sort()).toEqual([
					"code",
					"retryable",
				]);
				let clientConstraintError: unknown;
				try {
					await networkClient.mutations["message.publish"](
						{ body: hostileConstraintBody, channelId: tracerIds.channel },
						{ callId: `network:constraint:${crypto.randomUUID()}` },
					);
				} catch (error) {
					clientConstraintError = error;
				}
				expect(clientConstraintError).toMatchObject({
					code: "INTERNAL",
					retryable: false,
				});
				expect(Object.keys(clientConstraintError as object).sort()).toEqual([
					"code",
					"retryable",
				]);
				const directConstraintErrorBytes = ownErrorBytes(directConstraintError);
				const clientConstraintErrorBytes = ownErrorBytes(clientConstraintError);
				expect(clientConstraintErrorBytes).toBe(directConstraintErrorBytes);
				expect(wireErrorBytes.get("INTERNAL")).toBe(directConstraintErrorBytes);
				for (const secret of [
					hostileConstraintBody,
					"message_events_message_id_fkey",
					"violates foreign key constraint",
					"00000000-0000-4000-8000-000000000099",
					"stack",
					"sourceURL",
					"originalLine",
					"originalColumn",
					"line",
					"column",
				])
					for (const evidence of [
						ownErrorBytes(directConstraintError),
						ownErrorBytes(clientConstraintError),
						wireErrorBytes.get("INTERNAL")!,
					])
						expect(evidence).not.toContain(secret);
				const afterRejectedConstraint = await routeApplication.execution(
					executionInput,
					({ queries }) =>
						queries.messages.page({
							after: null,
							channelId: tracerIds.channel,
							first: 100,
						}),
				);
				expect(
					afterRejectedConstraint.nodes.some(
						({ body }) => body === hostileConstraintBody,
					),
				).toBe(false);
				const networkDelivery = await networkClient.actions["delivery.publish"](
					{ effectKey: "domain-network", message: "delivery-network" },
					{
						effectKey: stableEffectKey,
						callId: "delivery-network-1",
						timeoutMilliseconds: 700,
					},
				);
				expect(networkDelivery).toEqual({
					attempt: 3,
					disposals: 2,
					receipt: `delivery:${effectId}`,
				});
				expect(transportCalls).toBe(5);
				const maximumTimeoutEffectKey = "provider-maximum-timeout";
				const directMaximumTimeout = await invokeDelivery(
					{ effectKey: "domain-direct-maximum", message: "delivery-maximum" },
					{
						effectKey: maximumTimeoutEffectKey,
						callId: "delivery-direct-maximum",
						timeoutMilliseconds: Number.MAX_SAFE_INTEGER,
					},
				);
				const networkMaximumTimeout = await networkClient.actions[
					"delivery.publish"
				](
					{ effectKey: "domain-network-maximum", message: "delivery-maximum" },
					{
						effectKey: maximumTimeoutEffectKey,
						callId: "delivery-network-maximum",
						timeoutMilliseconds: Number.MAX_SAFE_INTEGER,
					},
				);
				expect(networkMaximumTimeout.receipt).toBe(
					directMaximumTimeout.receipt,
				);
				expect(transportCalls).toBe(6);
				await expect(
					networkClient.actions["delivery.publish"](
						{
							effectKey: "domain-network-rejected",
							message: "delivery-refused-always-network",
						},
						{
							effectKey: "provider-network-rejected",
							callId: "delivery-network-rejected",
						},
					),
				).rejects.toMatchObject({
					code: "PROVIDER_REJECTED",
					payload: null,
					status: 502,
				});
				await expect(
					networkClient.actions["delivery.publish"](
						{
							effectKey: "domain-network-timeout",
							message: "delivery-blocked",
						},
						{
							effectKey: "provider-network-timeout",
							callId: "delivery-network-timeout",
							timeoutMilliseconds: 10,
						},
					),
				).rejects.toMatchObject({ code: "DEADLINE_EXCEEDED" });
				expect(transportCalls).toBe(8);

				await expect(
					invokeDelivery(
						{
							effectKey: "domain-rejected",
							message: "delivery-refused-always",
						},
						{ effectKey: "provider-rejected" },
					),
				).rejects.toMatchObject({
					code: "PROVIDER_REJECTED",
					payload: null,
					status: 502,
				});
				await expect(
					invokeDelivery(
						{ effectKey: "domain-timeout", message: "delivery-blocked" },
						{
							effectKey: "provider-timeout",
							callId: "delivery-timeout",
							timeoutMilliseconds: 10,
						},
					),
				).rejects.toMatchObject({ code: "DEADLINE_EXCEEDED" });
				const cancellation = new AbortController();
				const cancellationReason = new DOMException(
					"direct Action cancelled",
					"AbortError",
				);
				let markExecutionReady!: () => void;
				const executionReady = new Promise<void>((resolve) => {
					markExecutionReady = resolve;
				});
				const cancelledDelivery = routeApplication.execution(
					{ ...executionInput, signal: cancellation.signal },
					({ actions }) => {
						markExecutionReady();
						return actions.delivery.publish(
							{ effectKey: "domain-cancel", message: "delivery-blocked" },
							{
								effectKey: "provider-cancel",
								timeoutMilliseconds: 900,
							},
						);
					},
				);
				await executionReady;
				setTimeout(() => cancellation.abort(cancellationReason), 10);
				await expect(cancelledDelivery).rejects.toBe(cancellationReason);

				const afterFailure = await invokeDelivery(
					{ effectKey: "domain-cleanup", message: "delivery-after-failure" },
					{ effectKey: "provider-after-failure" },
				);
				expect(afterFailure).toMatchObject({ attempt: 11, disposals: 10 });
				await expect(
					escapedAction!(
						{ effectKey: "domain-escaped", message: "delivery-escaped" },
						{ effectKey: "provider-escaped" },
					),
				).rejects.toBeDefined();

				const generatedFetch = await routeApplication.fetch(
					new Request("https://app.test/api/whoami", {
						headers: {
							cookie:
								"questpie_tracer_session=f18f8b8e0e1446079dc6e6d4755505f9",
						},
					}),
				);
				expect(await generatedFetch.json()).toEqual({
					principal: { id: tracerIds.principal, kind: "user" },
				});
				const direct = await routeApplication.routes[
					"collaboration.whoami"
				]!.direct({
					request: new Request("https://app.test/api/whoami"),
					execution: {
						principal: principal.user({ id: tracerIds.principal }),
					},
				});
				expect(await direct.json()).toEqual({
					principal: { id: tracerIds.principal, kind: "user" },
				});
			} finally {
				await routeApplication.close();
				expect(postgresFacts()).toMatchObject({
					state: "closed",
					generation: 1,
					pool: { max: 10, total: 0 },
					listener: "disabled",
				});
			}

			const first = await startHost(temporary, 0, { pauseWorker: true });
			cleanup.defer(() => stop(first.child, "SIGKILL"));
			const origin = `http://127.0.0.1:${first.port}`;
			const ordinaryDocument = await fetch(`${origin}/`);
			expect(ordinaryDocument.headers.get("set-cookie")).toBeNull();

			const missingCredential = await fetch(`${origin}/api/whoami`);
			expect(missingCredential.status).toBe(401);
			expect(missingCredential.headers.get("cache-control")).toBe("no-store");

			const issuedDocument = await fetch(`${origin}/?credential=demo-cookie`);
			const issuedCookie = issuedDocument.headers
				.get("set-cookie")
				?.split(";", 1)[0];
			expect(issuedCookie).toMatch(/^questpie_tracer_session=[a-f0-9]{32}$/);

			const duplicateCredential = await fetch(`${origin}/api/whoami`, {
				headers: { cookie: `${issuedCookie}; ${issuedCookie}` },
			});
			expect(duplicateCredential.status).toBe(401);

			const malformedCredential = await fetch(`${origin}/api/whoami`, {
				headers: { cookie: "questpie_tracer_session" },
			});
			expect(malformedCredential.status).toBe(401);

			const wrongCredential = await fetch(`${origin}/api/whoami`, {
				headers: { cookie: "questpie_tracer_session=wrong" },
			});
			expect(wrongCredential.status).toBe(401);

			const recognizedCredential = await fetch(`${origin}/api/whoami`, {
				headers: { cookie: `unrelated=value; ${issuedCookie}` },
			});
			expect(recognizedCredential.status).toBe(200);
			expect(recognizedCredential.headers.get("cache-control")).toBe(
				"no-store",
			);
			expect(recognizedCredential.headers.get("vary")).toBe("Cookie");
			expect(await recognizedCredential.json()).toEqual({
				principal: { id: tracerIds.principal, kind: "user" },
			});

			const wrongMethod = await fetch(`${origin}/api/whoami`, {
				method: "POST",
			});
			expect(wrongMethod.status).toBe(405);
			expect(wrongMethod.headers.get("allow")).toBe("GET");
			expect(wrongMethod.headers.get("cache-control")).toBe("no-store");

			const profile = join(temporary, "firefox-profile");
			await mkdir(profile);
			const body = `browser restart ${crypto.randomUUID()}`;
			const browserUrl = new URL(`http://127.0.0.1:${first.port}/`);
			browserUrl.searchParams.set("body", body);
			// Fixture-only login surrogate: the document response sets the demo
			// cookie that Firefox sends to /api/whoami.
			browserUrl.searchParams.set("credential", "demo-cookie");
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
				await eventually(() => report(first.port), {
					accept: (current) =>
						current?.whoami?.principal?.kind === "user" &&
						current.whoami.principal.id === tracerIds.principal,
					description: "browser demo cookie recognized through /api/whoami",
					intervalMilliseconds: 50,
					timeoutMilliseconds: 30_000,
				}),
			).toMatchObject({
				whoami: {
					principal: { id: tracerIds.principal, kind: "user" },
				},
			});

			expect(
				await eventually(() => report(first.port), {
					accept: (current) => current?.phase === "mutation-observed",
					description: "browser-observed committed Mutation",
					intervalMilliseconds: 50,
					timeoutMilliseconds: 30_000,
				}),
			).toMatchObject({
				phase: "mutation-observed",
				whoami: {
					principal: { id: tracerIds.principal, kind: "user" },
				},
			});
			const [published] = await database!.unsafe<
				readonly Readonly<{ events: number }>[]
			>(
				`SELECT count(*)::int AS events
FROM collaboration.message_events AS events
JOIN collaboration.messages AS messages ON messages.id = events.message_id
WHERE messages.body = $1 AND events.kind = 'published'`,
				[body],
			);
			expect(published).toEqual({ events: 1 });

			await stop(first.child, "SIGKILL");
			const recovered = await startHost(temporary, first.port);
			cleanup.defer(() => stop(recovered.child, "SIGTERM"));

			expect(
				await eventually(() => report(recovered.port), {
					accept: (current) => current?.phase === "recovered",
					description: "browser Live Query reconnect",
					intervalMilliseconds: 50,
					timeoutMilliseconds: 30_000,
				}),
			).toMatchObject({
				phase: "recovered",
				whoami: {
					principal: { id: tracerIds.principal, kind: "user" },
				},
			});

			const terminal = await eventually(
				async () => {
					const [row] = await database!.unsafe<
						readonly Readonly<{ state: string; delivered: number }>[]
					>(
						`SELECT runs.state,
  (SELECT count(*)::int
   FROM collaboration.message_events AS events
   WHERE events.message_id = (convert_from(intents.payload_bytes, 'UTF8')::jsonb->>'messageId')::uuid
     AND events.kind = 'delivered') AS delivered
FROM questpie_internal.durable_runs AS runs
JOIN questpie_internal.durable_dispatches AS intents
  ON intents.application_name = runs.application_name
 AND intents.record_id = runs.dispatch_id
WHERE intents.resource_kind = 'reaction'
ORDER BY runs.accepted_at DESC
LIMIT 1`,
					);
					return row ?? null;
				},
				{
					accept: (row) => row?.state === "succeeded" && row.delivered === 1,
					description: "restarted host Reaction recovery",
					intervalMilliseconds: 50,
					timeoutMilliseconds: 30_000,
				},
			);
			expect(terminal).toEqual({ state: "succeeded", delivered: 1 });
			await stop(recovered.child, "SIGTERM");

			const jobCallId = `job-mutation-${crypto.randomUUID()}`;
			const jobApplication = await createApp({
				postgres: {
					connectionUrl: postgresUrl(),
					directConnectionUrl: postgresUrl(),
				},
				realtime: { hmacKey: new Uint8Array(32).fill(23) },
				maintenance: { authorize: () => true },
			});
			const acceptJob = () =>
				jobApplication.execution(
					{
						principal: principal.user({ id: tracerIds.principal }),
						context: { companyId: tracerIds.company },
					},
					({ mutations }) =>
						mutations.message.requestDigest(
							{ companyId: tracerIds.company },
							{ callId: jobCallId },
						),
				);
			const acceptDirectJob = (
				companyId: string,
				idempotencyKey: string,
				notBefore?: Date,
				restartProbe?: "hardRestart" | "staleSettlement",
			) =>
				jobApplication.execution(
					{
						principal: principal.user({ id: tracerIds.principal }),
						context: { companyId: tracerIds.company },
					},
					({ jobs }) =>
						jobs.reports.companyDigest.accept(
							{
								companyId,
								...(restartProbe === undefined ? {} : { restartProbe }),
							},
							{
								idempotencyKey,
								...(notBefore === undefined ? {} : { notBefore }),
							},
						),
				);
			let acceptedJob: Readonly<{ runId: string; resource: string }>;
			let directJob: Readonly<{ runId: string; resource: string }>;
			let delayedJob: Readonly<{ runId: string; resource: string }>;
			let cancelledJob: Readonly<{ runId: string; resource: string }>;
			let restartJob: Readonly<{ runId: string; resource: string }>;
			try {
				acceptedJob = await acceptJob();
				expect(await acceptJob()).toEqual(acceptedJob);
				const directKey = `direct-job-${crypto.randomUUID()}`;
				directJob = await acceptDirectJob(tracerIds.company, directKey);
				expect(await acceptDirectJob(tracerIds.company, directKey)).toEqual(
					directJob,
				);
				await expect(
					acceptDirectJob(tracerIds.channel, directKey),
				).rejects.toMatchObject({ code: "JOB_ACCEPTANCE_CONFLICT" });
				delayedJob = await acceptDirectJob(
					tracerIds.company,
					`delayed-job-${crypto.randomUUID()}`,
					new Date(Date.now() + 1_000),
				);
				cancelledJob = await acceptDirectJob(
					tracerIds.company,
					`cancelled-job-${crypto.randomUUID()}`,
					new Date(Date.now() + 60_000),
				);
				await expect(
					jobApplication.durable.cancelRun({
						runId: cancelledJob.runId,
						reason: "collaboration tracer cancellation",
						actor: principal.user({ id: tracerIds.principal }),
					}),
				).resolves.toMatchObject({ outcome: "applied" });
				restartJob = await acceptDirectJob(
					tracerIds.company,
					`restart-job-${crypto.randomUUID()}`,
					undefined,
					"hardRestart",
				);
			} finally {
				await jobApplication.close();
			}
			expect(acceptedJob).toMatchObject({
				resource: "job:reports.companyDigest",
			});
			const firstJobHost = await startHost(temporary, 0, {
				leaseMilliseconds: 1_000,
				heartbeatMilliseconds: 200,
				attemptDeadlineMilliseconds: 30_000,
			});
			cleanup.defer(() => stop(firstJobHost.child, "SIGKILL"));
			const firstRestartProbe = JSON.parse(
				await waitForOutputLine(firstJobHost.output, {
					accept: (line) =>
						line.includes('"event":"collaboration-job-attempt"') &&
						line.includes(`"runId":"${restartJob.runId}"`) &&
						line.includes('"attemptNumber":1'),
					description: "first ordinary Job attempt before hard restart",
					timeoutMilliseconds: 30_000,
				}),
			) as JobAttemptProbe;
			expect(firstRestartProbe).toMatchObject({
				attemptNumber: 1,
				role: "admin",
				runId: restartJob.runId,
			});
			expect(firstRestartProbe?.contextResolutionId).toMatch(/^[0-9a-f-]{36}$/);
			expect(firstRestartProbe?.invocationId).toMatch(/^[0-9a-f-]{36}$/);

			const [preRestartClaim] = await database!.unsafe<
				readonly Readonly<{
					attemptId: string;
					attemptNumber: number;
					leaseTokenDigest: string;
					state: string;
					workerId: string;
				}>[]
			>(
				`SELECT runs.state, attempts.attempt_id::text AS "attemptId",
  attempts.attempt_number AS "attemptNumber", attempts.worker_id AS "workerId",
  attempts.lease_token_digest AS "leaseTokenDigest"
FROM questpie_internal.durable_runs runs
JOIN questpie_internal.durable_attempts attempts
  ON attempts.application_name = runs.application_name
 AND attempts.attempt_id = runs.current_attempt_id
WHERE runs.application_name = 'application:collaboration'
  AND runs.run_id = $1`,
				[restartJob.runId],
			);
			expect(preRestartClaim).toMatchObject({
				attemptNumber: 1,
				state: "running",
				workerId: `collaboration-tracer:${firstJobHost.child.pid}`,
			});
			expect(preRestartClaim?.leaseTokenDigest).toMatch(/^[0-9a-f]{64}$/);

			await database!.unsafe(
				`UPDATE collaboration.memberships
SET role = 'owner'
WHERE company_id = $1 AND principal_id = $2 AND scope_key = 'company'`,
				[tracerIds.company, tracerIds.principal],
			);
			await stop(firstJobHost.child, "SIGKILL");
			const recoveredJobHost = await startHost(temporary, firstJobHost.port, {
				leaseMilliseconds: 1_000,
				heartbeatMilliseconds: 200,
				attemptDeadlineMilliseconds: 30_000,
			});
			cleanup.defer(() => stop(recoveredJobHost.child, "SIGTERM"));
			const secondRestartProbe = JSON.parse(
				await waitForOutputLine(recoveredJobHost.output, {
					accept: (line) =>
						line.includes('"event":"collaboration-job-attempt"') &&
						line.includes(`"runId":"${restartJob.runId}"`) &&
						line.includes('"attemptNumber":2'),
					description: "ordinary Job attempt reclaimed after hard restart",
					timeoutMilliseconds: 30_000,
				}),
			) as JobAttemptProbe;
			const jobRecords = await database!.unsafe<
				readonly Readonly<{
					causationKind: string;
					dispatches: number;
					events: number;
					resource: string;
					runId: string;
					semanticVersion: number;
					state: string;
				}>[]
			>(
				`SELECT count(*) OVER ()::int AS dispatches,
  runs.run_id::text AS "runId", runs.resource_identity AS resource,
  runs.semantic_version AS "semanticVersion", runs.state,
  runs.causation_kind AS "causationKind",
  (SELECT count(*)::int FROM questpie_internal.durable_run_events events
   WHERE events.application_name = runs.application_name AND events.run_id = runs.run_id) AS events
FROM questpie_internal.durable_dispatches dispatches
JOIN questpie_internal.durable_runs runs
  ON runs.application_name = dispatches.application_name
 AND runs.dispatch_id = dispatches.record_id
WHERE dispatches.call_id = $1 AND dispatches.resource_kind = 'job'`,
				[jobCallId],
			);
			expect(jobRecords).toHaveLength(2);
			expect(jobRecords).toContainEqual(
				expect.objectContaining({
					causationKind: "mutationDispatch",
					dispatches: 2,
					resource: "job:reports.companyDigest",
					runId: acceptedJob.runId,
					semanticVersion: 1,
				}),
			);
			const mutationRunIds = jobRecords.map(({ runId }) => runId);
			const terminalJobs = await eventually(
				async () =>
					database!.unsafe<
						readonly Readonly<{
							causationKind: string;
							events: number;
							runId: string;
							state: string;
						}>[]
					>(
						`SELECT runs.run_id::text AS "runId", runs.state,
  runs.causation_kind AS "causationKind",
  (SELECT count(*)::int FROM questpie_internal.durable_run_events events
   WHERE events.application_name = runs.application_name AND events.run_id = runs.run_id) AS events
FROM questpie_internal.durable_runs runs
WHERE runs.run_id IN ($1, $2, $3, $4, $5, $6)
ORDER BY runs.run_id`,
						[
							...mutationRunIds,
							directJob.runId,
							delayedJob.runId,
							cancelledJob.runId,
							restartJob.runId,
						],
					),
				{
					accept: (rows) =>
						rows.length === 6 &&
						rows.filter(({ state }) => state === "succeeded").length === 5 &&
						rows.filter(({ state }) => state === "cancelled").length === 1,
					description: "ordinary Job execution, delay, and cancellation",
					intervalMilliseconds: 50,
					timeoutMilliseconds: 30_000,
				},
			);
			expect(terminalJobs).toHaveLength(6);
			expect(
				terminalJobs.filter(
					({ causationKind }) => causationKind === "explicit",
				),
			).toHaveLength(4);
			expect(
				terminalJobs
					.filter(({ state }) => state === "succeeded")
					.every(({ events }) => events >= 3),
			).toBe(true);

			const hardRestartProbes = [firstRestartProbe, secondRestartProbe];
			expect(
				hardRestartProbes.map(({ attemptNumber, role, runId }) => ({
					attemptNumber,
					role,
					runId,
				})),
			).toEqual([
				{ attemptNumber: 1, role: "admin", runId: restartJob.runId },
				{ attemptNumber: 2, role: "owner", runId: restartJob.runId },
			]);
			expect(recoveredJobHost.child.pid).not.toBe(firstJobHost.child.pid);
			expect(hardRestartProbes[1]?.contextResolutionId).not.toBe(
				hardRestartProbes[0]?.contextResolutionId,
			);
			expect(hardRestartProbes[1]?.invocationId).not.toBe(
				hardRestartProbes[0]?.invocationId,
			);

			const recoveredAttempts = await database!.unsafe<
				readonly Readonly<{
					attemptId: string;
					attemptNumber: number;
					leaseTokenDigest: string;
					outcome: string;
					workerId: string;
				}>[]
			>(
				`SELECT attempt_id::text AS "attemptId", attempt_number AS "attemptNumber",
  worker_id AS "workerId", lease_token_digest AS "leaseTokenDigest", outcome
FROM questpie_internal.durable_attempts
WHERE application_name = 'application:collaboration' AND run_id = $1
ORDER BY attempt_number`,
				[restartJob.runId],
			);
			expect(
				recoveredAttempts.map(
					({ attemptId, attemptNumber, outcome, workerId }) => ({
						attemptId,
						attemptNumber,
						outcome,
						workerId,
					}),
				),
			).toEqual([
				{
					attemptId: preRestartClaim?.attemptId,
					attemptNumber: 1,
					outcome: "leaseSuperseded",
					workerId: `collaboration-tracer:${firstJobHost.child.pid}`,
				},
				{
					attemptId: expect.any(String),
					attemptNumber: 2,
					outcome: "succeeded",
					workerId: `collaboration-tracer:${recoveredJobHost.child.pid}`,
				},
			]);
			expect(recoveredAttempts[1]?.leaseTokenDigest).not.toBe(
				recoveredAttempts[0]?.leaseTokenDigest,
			);
			const [restartResult] = await database!.unsafe<
				readonly Readonly<{
					attemptNumber: number;
					contextResolutionId: string;
					invocationId: string;
					role: string;
				}>[]
			>(
				`SELECT
  (convert_from(result_bytes, 'UTF8')::jsonb->>'attemptNumber')::int AS "attemptNumber",
  convert_from(result_bytes, 'UTF8')::jsonb->>'contextResolutionId' AS "contextResolutionId",
  convert_from(result_bytes, 'UTF8')::jsonb->>'invocationId' AS "invocationId",
  convert_from(result_bytes, 'UTF8')::jsonb->>'role' AS role
FROM questpie_internal.durable_runs
WHERE application_name = 'application:collaboration' AND run_id = $1`,
				[restartJob.runId],
			);
			expect(restartResult).toEqual({
				attemptNumber: 2,
				contextResolutionId: hardRestartProbes[1]?.contextResolutionId,
				invocationId: hardRestartProbes[1]?.invocationId,
				role: "owner",
			});

			await stop(recoveredJobHost.child, "SIGTERM");
			const staleApplication = await createApp({
				postgres: {
					connectionUrl: postgresUrl(),
					directConnectionUrl: postgresUrl(),
				},
				realtime: { hmacKey: new Uint8Array(32).fill(23) },
				maintenance: { authorize: () => true },
			});
			const replacementApplication = await createApp({
				postgres: {
					connectionUrl: postgresUrl(),
					directConnectionUrl: postgresUrl(),
				},
				realtime: { hmacKey: new Uint8Array(32).fill(23) },
				maintenance: { authorize: () => true },
			});
			try {
				const staleRun = await staleApplication.execution(
					{
						principal: principal.user({ id: tracerIds.principal }),
						context: { companyId: tracerIds.company },
					},
					({ jobs }) =>
						jobs.reports.companyDigest.accept(
							{
								companyId: tracerIds.company,
								restartProbe: "staleSettlement",
							},
							{ idempotencyKey: `stale-job-${crypto.randomUUID()}` },
						),
				);
				const staleWorker = staleApplication.durable.worker({
					workerId: "collaboration-tracer:stale",
					claimBatch: 1,
					leaseMilliseconds: 1_000,
					heartbeatMilliseconds: 200,
					attemptDeadlineMilliseconds: 1_000,
				});
				const stalePoll = staleWorker.poll();
				expect(
					await eventually(
						async () => {
							const [attempt] = await database!.unsafe<
								readonly Readonly<{
									attemptNumber: number;
									state: string;
									workerId: string;
								}>[]
							>(
								`SELECT runs.state, attempts.attempt_number AS "attemptNumber",
  attempts.worker_id AS "workerId"
FROM questpie_internal.durable_runs runs
JOIN questpie_internal.durable_attempts attempts
  ON attempts.application_name = runs.application_name
 AND attempts.attempt_id = runs.current_attempt_id
WHERE runs.application_name = 'application:collaboration' AND runs.run_id = $1`,
								[staleRun.runId],
							);
							return attempt ?? null;
						},
						{
							accept: (attempt) =>
								attempt?.attemptNumber === 1 &&
								attempt.state === "running" &&
								attempt.workerId === "collaboration-tracer:stale",
							description: "stale Job attempt owns its first lease",
							intervalMilliseconds: 25,
							timeoutMilliseconds: 30_000,
						},
					),
				).toEqual({
					attemptNumber: 1,
					state: "running",
					workerId: "collaboration-tracer:stale",
				});
				const replacementWorker = replacementApplication.durable.worker({
					workerId: "collaboration-tracer:replacement",
					claimBatch: 1,
					leaseMilliseconds: 1_000,
					heartbeatMilliseconds: 200,
					attemptDeadlineMilliseconds: 5_000,
				});
				const replacementTrace = await eventually(
					() => replacementWorker.poll(),
					{
						accept: (trace) =>
							trace.outcomes.some(
								(outcome) =>
									outcome.runId === staleRun.runId &&
									outcome.attemptNumber === 2 &&
									outcome.outcome === "succeeded",
							),
						description: "replacement worker owns stale Job run",
						intervalMilliseconds: 50,
						timeoutMilliseconds: 30_000,
					},
				);
				expect(replacementTrace.outcomes).toContainEqual(
					expect.objectContaining({
						attemptNumber: 2,
						outcome: "succeeded",
						runId: staleRun.runId,
					}),
				);
				const staleTrace = await stalePoll;
				expect(staleTrace.outcomes).toContainEqual(
					expect.objectContaining({
						attemptNumber: 1,
						failureCode: "HANDLER_FAILED",
						outcome: "fenced",
						runId: staleRun.runId,
					}),
				);
				const staleAttempts = await database!.unsafe<
					readonly Readonly<{
						attemptNumber: number;
						leaseTokenDigest: string;
						outcome: string;
						workerId: string;
					}>[]
				>(
					`SELECT attempt_number AS "attemptNumber", worker_id AS "workerId",
  lease_token_digest AS "leaseTokenDigest", outcome
FROM questpie_internal.durable_attempts
WHERE application_name = 'application:collaboration' AND run_id = $1
ORDER BY attempt_number`,
					[staleRun.runId],
				);
				expect(
					staleAttempts.map(({ attemptNumber, outcome, workerId }) => ({
						attemptNumber,
						outcome,
						workerId,
					})),
				).toEqual([
					{
						attemptNumber: 1,
						outcome: "leaseSuperseded",
						workerId: "collaboration-tracer:stale",
					},
					{
						attemptNumber: 2,
						outcome: "succeeded",
						workerId: "collaboration-tracer:replacement",
					},
				]);
				expect(staleAttempts[1]?.leaseTokenDigest).not.toBe(
					staleAttempts[0]?.leaseTokenDigest,
				);
			} finally {
				await Promise.all([
					staleApplication.close(),
					replacementApplication.close(),
				]);
			}

			const policyApplication = await createApp({
				postgres: {
					connectionUrl: postgresUrl(),
					directConnectionUrl: postgresUrl(),
				},
				realtime: { hmacKey: new Uint8Array(32).fill(23) },
				maintenance: { authorize: () => false },
			});
			const deniedRun = await policyApplication
				.execution(
					{
						principal: principal.user({ id: tracerIds.principal }),
						context: { companyId: tracerIds.company },
					},
					({ jobs }) =>
						jobs.reports.companyDigest.accept(
							{
								companyId: tracerIds.company,
								restartProbe: "hardRestart",
							},
							{ idempotencyKey: `policy-job-${crypto.randomUUID()}` },
						),
				)
				.finally(() => policyApplication.close());
			expect(deniedRun).toMatchObject({
				resource: "job:reports.companyDigest",
			});
			const revokedMembership = await database!.unsafe<
				readonly Readonly<{ role: string; status: string }>[]
			>(
				`UPDATE collaboration.memberships
SET status = 'revoked'
WHERE company_id = $1 AND principal_id = $2 AND scope_key = 'company'
RETURNING role, status`,
				[tracerIds.company, tracerIds.principal],
			);
			expect(revokedMembership).toEqual([{ role: "owner", status: "revoked" }]);

			const policyHost = await startHost(temporary, 0, {
				leaseMilliseconds: 1_000,
				heartbeatMilliseconds: 200,
				attemptDeadlineMilliseconds: 5_000,
			});
			cleanup.defer(() => stop(policyHost.child, "SIGTERM"));
			const denied = await eventually(
				async () => {
					const [row] = await database!.unsafe<
						readonly Readonly<{
							attemptCount: number;
							attemptFailureCode: string;
							attemptOutcome: string;
							currentAttemptId: string | null;
							deadLetter: boolean;
							failureCode: string;
							resultBytes: Uint8Array | null;
							state: string;
							workerId: string;
						}>[]
					>(
						`SELECT runs.state, runs.attempt_count AS "attemptCount",
  runs.current_attempt_id::text AS "currentAttemptId",
  runs.dead_letter AS "deadLetter", runs.failure_code AS "failureCode",
  runs.result_bytes AS "resultBytes", attempts.worker_id AS "workerId",
  attempts.outcome AS "attemptOutcome",
  attempts.failure_code AS "attemptFailureCode"
FROM questpie_internal.durable_runs runs
JOIN questpie_internal.durable_attempts attempts
  ON attempts.application_name = runs.application_name
 AND attempts.run_id = runs.run_id
WHERE runs.application_name = 'application:collaboration' AND runs.run_id = $1`,
						[deniedRun.runId],
					);
					return row ?? null;
				},
				{
					accept: (row) =>
						row?.state === "failed" && row.failureCode === "RUN_AS_DENIED",
					description: "current run-as policy rejects revoked Job caller",
					intervalMilliseconds: 25,
					timeoutMilliseconds: 30_000,
				},
			);
			expect(denied).toEqual({
				attemptCount: 1,
				attemptFailureCode: "RUN_AS_DENIED",
				attemptOutcome: "failed",
				currentAttemptId: null,
				deadLetter: true,
				failureCode: "RUN_AS_DENIED",
				resultBytes: null,
				state: "failed",
				workerId: `collaboration-tracer:${policyHost.child.pid}`,
			});
			const deniedEvents = await database!.unsafe<
				readonly Readonly<{
					attemptId: string | null;
					errorCode: string | null;
					kind: string;
					sequence: number;
				}>[]
			>(
				`SELECT sequence, kind, attempt_id::text AS "attemptId",
  error_code AS "errorCode"
FROM questpie_internal.durable_run_events
WHERE application_name = 'application:collaboration' AND run_id = $1
ORDER BY sequence`,
				[deniedRun.runId],
			);
			expect(deniedEvents).toEqual([
				{
					attemptId: null,
					errorCode: null,
					kind: "accepted",
					sequence: 1,
				},
				{
					attemptId: expect.any(String),
					errorCode: null,
					kind: "attemptStarted",
					sequence: 2,
				},
				{
					attemptId: deniedEvents[1]?.attemptId,
					errorCode: "RUN_AS_DENIED",
					kind: "failed",
					sequence: 3,
				},
			]);
			await stop(policyHost.child, "SIGTERM");
			const policyHostOutput = await new Response(policyHost.output).text();
			expect(policyHostOutput).not.toContain(`"runId":"${deniedRun.runId}"`);
		} finally {
			await cleanup.dispose();
		}
	},
	180_000,
);
