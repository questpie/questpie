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
	pauseWorker: boolean,
): Promise<Readonly<{ child: Child; port: number }>> {
	const child = Bun.spawn(["bun", "tracer/host.ts", `--port=${port}`], {
		cwd: root,
		env: {
			...process.env,
			DATABASE_URL: postgresUrl(),
			...(pauseWorker ? { QUESTPIE_TRACER_PAUSE_WORKER: "1" } : {}),
		},
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});
	const line = await waitForOutputLine(child.stdout, {
		accept: (candidate) => candidate.includes('"event":"ready"'),
		description: "collaboration tracer host readiness",
		timeoutMilliseconds: 30_000,
	});
	const ready = JSON.parse(line) as Readonly<{ port?: unknown }>;
	if (!Number.isSafeInteger(ready.port) || Number(ready.port) <= 0)
		throw new TypeError("collaboration tracer readiness port is invalid");
	return Object.freeze({ child, port: Number(ready.port) });
}

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
		message: Readonly<{ publish: unknown }>;
	}>;
	services: Readonly<{
		"audit.execution": unknown;
		"collaboration.demo-auth": unknown;
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

afterAll(async () => {
	await database?.close({ timeout: 0 });
});

postgresTest(
	"runs compile, migrate, seed, Query, Mutation, browser Live Query, and Reaction recovery",
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

			const [{ createApp }, { principal }] = await Promise.all([
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
								}>,
								use: (
									scope: GeneratedExecutionScope,
								) => Result | Promise<Result>,
							): Promise<Awaited<Result>>;
							fetch(request: Request): Promise<Response>;
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
				const cancelledDelivery = routeApplication.execution(
					{ ...executionInput, signal: cancellation.signal },
					({ actions }) =>
						actions.delivery.publish(
							{ effectKey: "domain-cancel", message: "delivery-blocked" },
							{
								effectKey: "provider-cancel",
								timeoutMilliseconds: 900,
							},
						),
				);
				setTimeout(() => cancellation.abort(cancellationReason), 10);
				await expect(cancelledDelivery).rejects.toBe(cancellationReason);

				const afterFailure = await invokeDelivery(
					{ effectKey: "domain-cleanup", message: "delivery-after-failure" },
					{ effectKey: "provider-after-failure" },
				);
				expect(afterFailure).toMatchObject({ attempt: 6, disposals: 5 });
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
			}

			const first = await startHost(temporary, 0, true);
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

			await stop(first.child, "SIGKILL");
			const recovered = await startHost(temporary, first.port, false);
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
JOIN questpie_internal.pending_reaction_intents AS intents
  ON intents.application_name = runs.application_name
 AND intents.record_id = runs.dispatch_id
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
		} finally {
			await cleanup.dispose();
		}
	},
	180_000,
);
