// Proves ADR-0045 (docs/adr/0045-freeze-public-testing-surface.md): an
// application outside this repository, using only the published `questpie`
// and `questpie/testing` specifiers, can boot its own compiled app against a
// real PostgreSQL, get an isolated database with migrations and Seeds
// applied and torn down, obtain a trusted Principal through the same seam
// the application's credential resolver uses, call a generated Query and
// Mutation in-process and a Route over HTTP, and drain a Job deterministically.
//
// This test does not import anything from `packages/testkit`, `tests/support`
// framework-internal proof machinery, or a repo-relative `packages/questpie/src`
// path for the surface under test — only `questpie` and `questpie/testing`
// specifiers resolved from the fixture application's own `node_modules`, plus
// the fixture application's own source (its tracer constants and route-auth
// module), exactly as an external consumer would.
import { afterAll, expect, test } from "bun:test";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { SQL } from "bun";

import { tracerIds } from "../../../fixtures/collaboration/tracer/constants";
import { installQuestpieForTracer } from "../../support/beta12-packed-questpie";

const repositoryRoot = resolve(import.meta.dir, "../../..");
const fixtureRoot = resolve(repositoryRoot, "fixtures/collaboration");
const adminDatabase = process.env.PGHOST ? new SQL({ max: 2 }) : undefined;
const postgresTest = process.env.PGHOST ? test : test.skip;

function adminConnectionUrl(): string {
	const url = new URL("postgres://localhost/");
	url.hostname = process.env.PGHOST ?? "127.0.0.1";
	url.port = process.env.PGPORT ?? "5432";
	url.username = process.env.PGUSER ?? "postgres";
	url.pathname = `/${process.env.PGDATABASE ?? "postgres"}`;
	if (process.env.PGPASSWORD) url.password = process.env.PGPASSWORD;
	return url.toString();
}

function runCli(root: string, arguments_: readonly string[]): void {
	const cli = resolve(repositoryRoot, "packages/questpie/dist/cli.js");
	const result = Bun.spawnSync(["bun", cli, ...arguments_], {
		cwd: root,
		env: { ...process.env, DATABASE_URL: adminConnectionUrl() },
		stdout: "pipe",
		stderr: "pipe",
	});
	expect(
		result.exitCode,
		`${arguments_.join(" ")}\n${result.stdout.toString()}${result.stderr.toString()}`,
	).toBe(0);
}

afterAll(async () => {
	await adminDatabase?.close({ timeout: 0 });
});

postgresTest(
	"an external consumer of questpie/testing boots, isolates, authenticates, calls, and drains a Job",
	async () => {
		const temporary = await mkdtemp(
			join(tmpdir(), "questpie-public-testing-surface-"),
		);
		try {
			await cp(fixtureRoot, temporary, { recursive: true });
			// The generated App Contract compiler is private; a real consumer
			// runs `questpie build` once (their own build step), same as here.
			const questpieEntry = await installQuestpieForTracer(temporary);
			runCli(temporary, ["build"]);

			// The fixture's own demo credential constants; not part of the
			// QUESTPIE public surface, imported from the built copy exactly as
			// the fixture's own package-internal `#questpie/app` alias resolves.
			const { demoSessionCookieName, demoSessionToken } = (await import(
				`${pathToFileURL(join(temporary, "src/route-auth.ts")).href}?routeAuth=${crypto.randomUUID()}`
			)) as Readonly<{
				demoSessionCookieName: string;
				demoSessionToken: string;
			}>;

			// From here on, every QUESTPIE import is a public specifier resolved
			// from the fixture application's own node_modules, exactly as an
			// external consumer's test would resolve it.
			const [{ principal }, testing] = await Promise.all([
				import(
					`${pathToFileURL(questpieEntry).href}?principal=${crypto.randomUUID()}`
				) as Promise<
					Readonly<{
						principal: Readonly<{
							user(input: Readonly<{ id: string }>): unknown;
						}>;
					}>
				>,
				import(
					`${pathToFileURL(join(temporary, "node_modules/questpie/testing.ts")).href}?testing=${crypto.randomUUID()}`
				) as Promise<
					Readonly<{
						createIsolatedApplicationDatabase(
							input: Readonly<{
								adminConnectionUrl: string;
								applicationRoot: string;
								namePrefix?: string;
								seed?: boolean;
							}>,
						): Promise<
							Readonly<{
								connectionUrl: string;
								databaseName: string;
								dispose: () => Promise<void>;
							}>
						>;
						eventually: <Value>(
							probe: () => Value | Promise<Value>,
							input: Readonly<{
								accept: (value: Value) => boolean;
								timeoutMilliseconds?: number;
								intervalMilliseconds?: number;
								description?: string;
							}>,
						) => Promise<Value>;
					}>
				>,
			]);

			// Item 2: an isolated database, per test, with migrations and Seeds
			// applied, through the public seam — no hand-written DROP SCHEMA, no
			// knowledge of the application's configured PostgreSQL schema name.
			const database = await testing.createIsolatedApplicationDatabase({
				adminConnectionUrl: adminConnectionUrl(),
				applicationRoot: temporary,
				namePrefix: "questpie_public_testing_proof",
				seed: true,
			});
			try {
				const { createApp } = (await import(
					`${pathToFileURL(join(temporary, ".questpie/generated/app.ts")).href}?app=${crypto.randomUUID()}`
				)) as Readonly<{
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
					// Item 3: a trusted Principal obtained through the exact same
					// public `principal.user()` seam the application's own
					// credential resolver uses (fixtures/collaboration/src/route-auth.ts)
					// — not a forged object literal.
					const trustedPrincipal = principal.user({ id: tracerIds.principal });
					const executionInput = {
						principal: trustedPrincipal,
						context: { companyId: tracerIds.company },
					};

					// Item 4a: a generated Query and Mutation, called in-process.
					const channel = await app.execution(executionInput, ({ queries }) =>
						queries.channels.detail({ id: tracerIds.channel }),
					);
					expect(channel).toMatchObject({ id: tracerIds.channel });

					// Item 4b: the same generated App Contract, called over HTTP,
					// authenticated through the fixture's own credential resolver
					// (a static demo cookie, not a QUESTPIE Auth concern).
					const whoamiResponse = await app.fetch(
						new Request("https://app.test/api/whoami", {
							headers: {
								cookie: `${demoSessionCookieName}=${demoSessionToken}`,
							},
						}),
					);
					expect(whoamiResponse.status).toBe(200);
					expect(await whoamiResponse.json()).toEqual({
						principal: { kind: "user", id: tracerIds.principal },
					});

					// Item 5: accept and deterministically drain a Job using the
					// generated Durable worker and the public `eventually` poll
					// helper — no fixed sleep.
					const acceptedJob = await app.execution(
						executionInput,
						({ mutations }) =>
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
				// Item 2's teardown half: the isolated database is dropped, not
				// merely disconnected.
				await database.dispose();
			}
		} finally {
			await rm(temporary, { force: true, recursive: true });
		}
	},
	60_000,
);
