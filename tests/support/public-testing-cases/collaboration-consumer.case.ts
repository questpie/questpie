// Copied to the root of a compiled `fixtures/collaboration` copy (dev-symlink
// or real packed-tarball `node_modules/questpie`, selected by whichever
// installQuestpieForTracer already set up) and run there as its own `bun
// test` process, so every `questpie`/`questpie/testing` specifier below
// resolves through that copy's own node_modules — never through this
// repository's own workspace symlink. This is ADR-0045's proof that an
// external consumer, using only published exports, can boot its own
// compiled app against real PostgreSQL, get an isolated database, obtain a
// trusted Principal, call a generated Query/Mutation/Route, and drain a Job.
//
// Everything imported here by a repo-relative-looking specifier ("./tracer/
// constants", "./src/route-auth", "#questpie/app") is the fixture
// application's own source, copied alongside this file — not a QUESTPIE
// framework import.
import { expect, test } from "bun:test";

import { principal } from "questpie";
import * as testing from "questpie/testing";

import { tracerIds } from "./tracer/constants";

const adminConnectionUrl = (() => {
	const url = new URL("postgres://localhost/");
	url.hostname = process.env.PGHOST ?? "127.0.0.1";
	url.port = process.env.PGPORT ?? "5432";
	url.username = process.env.PGUSER ?? "postgres";
	url.pathname = `/${process.env.PGDATABASE ?? "postgres"}`;
	if (process.env.PGPASSWORD) url.password = process.env.PGPASSWORD;
	return url.toString();
})();

test("an external consumer of questpie/testing isolates, authenticates, calls, and drains a Job", async () => {
	const { demoSessionCookieName, demoSessionToken } =
		(await import("./src/route-auth")) as Readonly<{
			demoSessionCookieName: string;
			demoSessionToken: string;
		}>;

	// Item 2: an isolated database, per test, with migrations and Seeds
	// applied, through the public seam — no hand-written DROP SCHEMA, no
	// knowledge of the application's configured PostgreSQL schema name.
	const database = await testing.createIsolatedApplicationDatabase({
		adminConnectionUrl,
		applicationRoot: process.cwd(),
		namePrefix: "questpie_public_testing_proof",
		seed: true,
	});
	try {
		const { createApp } = (await import("#questpie/app")) as Readonly<{
			createApp(input: unknown): Promise<{
				execution<Result>(
					input: Readonly<{
						principal: unknown;
						context: Readonly<{ companyId: string }>;
					}>,
					use: (scope: {
						queries: {
							channels: {
								detail(
									input: Readonly<{ id: string }>,
								): Promise<Readonly<{ id: string }> | null>;
							};
						};
						mutations: {
							message: {
								requestDigest(
									input: Readonly<{ companyId: string }>,
									options: Readonly<{ callId: string }>,
								): Promise<Readonly<{ runId: string; resource: string }>>;
							};
						};
					}) => Result | Promise<Result>,
				): Promise<Awaited<Result>>;
				fetch(request: Request): Promise<Response>;
				durable: Readonly<{
					worker(
						options: Readonly<{
							workerId: string;
							claimBatch: number;
							leaseMilliseconds: number;
							heartbeatMilliseconds: number;
							attemptDeadlineMilliseconds: number;
						}>,
					): Readonly<{
						poll(): Promise<
							Readonly<{
								outcomes: readonly Readonly<{
									runId: string;
									outcome: string;
								}>[];
							}>
						>;
					}>;
				}>;
				close(): Promise<void>;
			}>;
		}>;

		const app = await createApp({
			postgres: {
				connectionUrl: database.connectionUrl,
				directConnectionUrl: database.connectionUrl,
			},
			realtime: { hmacKey: new Uint8Array(32).fill(23) },
			maintenance: { authorize: () => true },
		});
		try {
			// Item 3: a trusted Principal obtained through the exact same public
			// `principal.user()` seam the application's own credential resolver
			// uses (./src/route-auth.ts) — not a forged object literal.
			const trustedPrincipal = principal.user({ id: tracerIds.principal });
			const executionInput = {
				principal: trustedPrincipal,
				context: { companyId: tracerIds.company },
			};

			// Item 4a: a generated Query, called in-process.
			const channel = await app.execution(executionInput, ({ queries }) =>
				queries.channels.detail({ id: tracerIds.channel }),
			);
			expect(channel).toMatchObject({ id: tracerIds.channel });

			// Item 4b: the same generated App Contract, called over HTTP,
			// authenticated through the fixture's own credential resolver (a
			// static demo cookie, not a QUESTPIE Auth concern).
			const whoamiResponse = await app.fetch(
				new Request("https://app.test/api/whoami", {
					headers: { cookie: `${demoSessionCookieName}=${demoSessionToken}` },
				}),
			);
			expect(whoamiResponse.status).toBe(200);
			expect(await whoamiResponse.json()).toEqual({
				principal: { kind: "user", id: tracerIds.principal },
			});

			// Item 5: accept and deterministically drain a Job using the
			// generated Durable worker and the public `eventually` poll helper
			// — no fixed sleep.
			const acceptedJob = await app.execution(executionInput, ({ mutations }) =>
				mutations.message.requestDigest(
					{ companyId: tracerIds.company },
					{ callId: `public-testing-proof:${crypto.randomUUID()}` },
				),
			);
			expect(acceptedJob.resource).toBe("job:reports.companyDigest");
			const worker = app.durable.worker({
				workerId: "public-testing-proof:worker",
				claimBatch: 4,
				leaseMilliseconds: 1_000,
				heartbeatMilliseconds: 200,
				attemptDeadlineMilliseconds: 5_000,
			});
			const terminal = await testing.eventually(() => worker.poll(), {
				accept: (trace) =>
					trace.outcomes.some(
						(outcome) =>
							outcome.runId === acceptedJob.runId &&
							outcome.outcome === "succeeded",
					),
				description: "digest Job reaches a succeeded outcome",
				intervalMilliseconds: 50,
				timeoutMilliseconds: 20_000,
			});
			expect(terminal.outcomes).toContainEqual(
				expect.objectContaining({
					runId: acceptedJob.runId,
					outcome: "succeeded",
				}),
			);
		} finally {
			await app.close();
		}
	} finally {
		// Item 2's teardown half: the isolated database is dropped, not merely
		// disconnected.
		await database.dispose();
	}
});
