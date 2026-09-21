import { expect, test } from "bun:test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { SQL } from "bun";

import type { GeneratedApp } from "../../../fixtures/team-support-desk/.questpie/generated/app";
import {
	supportAuthCredentials,
	supportTracerIds,
} from "../../../fixtures/team-support-desk/tracer/constants";
import { compositionContract } from "../../../packages/compiler/src/composition";
import { CleanupStack } from "../../../packages/testkit/src";
import {
	installOpenTelemetryForTracer,
	installQuestpieForTracer,
} from "../../support/beta12-packed-questpie";
import {
	currentProtocolMcpRequest,
	MCP_PROTOCOL_VERSION,
} from "../../support/mcp-2026-07-28-client";

/**
 * F6(ii) from the ADR-0046 security review: an armed/unarmed pair of the
 * REAL Team Support Desk fixture, each compiled by the real CLI compiler and
 * booted by the real runtime, hit over the real `fetch` handler. The
 * unarmed copy compiles the pristine, unmodified fixture (identical to
 * every other Team Support Desk test). The armed copy has its
 * `src/auth/credentials.ts` overwritten with a static variant that adds
 * `challenge`/`protectCatalog: true`/`requireCredential: true` (see
 * `armCredentialResolver` below) before its own compile. Two separate
 * directories, not one rebuilt in place — see the comment at the call site.
 * The committed fixture on disk is never touched.
 */

const repositoryRoot = resolve(import.meta.dir, "../../..");
const fixtureRoot = resolve(repositoryRoot, "fixtures/team-support-desk");
const cli = resolve(repositoryRoot, "packages/questpie/dist/cli.js");
const database = process.env.PGHOST ? new SQL({ max: 2 }) : undefined;
const postgresTest = process.env.PGHOST ? test : test.skip;
const expectedChallenge =
	'Bearer resource_metadata="https://team-support.test/.well-known/oauth-protected-resource"';
const authOrigin = "https://team-support.test";

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

function responseCookie(response: Response): string {
	const value = response.headers.get("set-cookie")?.split(";", 1)[0];
	if (!value) throw new TypeError("Better Auth response did not set a cookie");
	return value;
}

/**
 * The compiler rejects `process` references inside structural source
 * (`QP-COMPOSE-010 impureStructuralGraph`) — resource definitions must be
 * deterministic, so an env-var-gated `defineCredentialResolver` call is not
 * an option. Instead, the "armed" build literally overwrites the copied
 * fixture's `credentials.ts` with a static, non-conditional variant (same
 * `resolve`, three extra static fields) before compiling. The pristine
 * fixture on disk, and every other Team Support Desk test, is untouched.
 */
async function armCredentialResolver(
	temporary: string,
	challenge: string,
): Promise<void> {
	const path = join(temporary, "src/auth/credentials.ts");
	const original = await readFile(path, "utf8");
	const closing = "\t},\n});\n\nexport { supportAuth };\n";
	if (!original.endsWith(closing))
		throw new TypeError(
			"fixtures/team-support-desk/src/auth/credentials.ts no longer ends with the expected defineCredentialResolver closing — update armCredentialResolver's literal replacement",
		);
	const armed = `${original.slice(0, -closing.length)}\t},
	challenge: ${JSON.stringify(challenge)},
	protectCatalog: true,
	requireCredential: true,
});

export { supportAuth };
`;
	await writeFile(path, armed);
}

function catalogueRequest(
	method: "tools/list" | "server/discover",
	cookie?: string,
): Request {
	const id = `mcp:${crypto.randomUUID()}`;
	return new Request(`${authOrigin}/_questpie/mcp`, {
		method: "POST",
		headers: {
			accept: "application/json, text/event-stream",
			"content-type": "application/json",
			"mcp-method": method,
			"mcp-protocol-version": MCP_PROTOCOL_VERSION,
			origin: authOrigin,
			...(cookie === undefined ? {} : { cookie }),
		},
		body: JSON.stringify({
			jsonrpc: "2.0",
			id,
			method,
			params: {
				_meta: {
					"io.modelcontextprotocol/protocolVersion": MCP_PROTOCOL_VERSION,
					"io.modelcontextprotocol/clientCapabilities": {},
				},
			},
		}),
	});
}

const ticketsQueueCall = (cookie: string | undefined) => ({
	arguments: {
		context: {
			organizationId: supportTracerIds.organization,
			membershipId: supportTracerIds.membershipAgent,
		},
		input: { after: null, first: 20, statuses: null, teamIds: null },
	},
	headers: cookie === undefined ? undefined : { cookie },
	name: "query.tickets.queue",
});

async function importFreshApp(
	temporary: string,
): Promise<{ createApp(input: unknown): Promise<GeneratedApp> }> {
	return import(
		`${pathToFileURL(join(temporary, ".questpie/generated/app.ts")).href}?app=${crypto.randomUUID()}`
	) as Promise<{ createApp(input: unknown): Promise<GeneratedApp> }>;
}

async function importFreshCredentials(temporary: string) {
	return import(
		`${pathToFileURL(join(temporary, "src/auth/credentials.ts")).href}?credentials=${crypto.randomUUID()}`
	) as Promise<{
		applicationCredentials: Readonly<{
			name: string;
			service: unknown;
			resolve: unknown;
			challenge?: unknown;
			protectCatalog?: unknown;
			requireCredential?: unknown;
		}>;
	}>;
}

postgresTest(
	"F6(ii): the real compiler and runtime enforce the credential gate end to end, and the compiled contract captures it",
	async () => {
		const cleanup = new CleanupStack();
		const previousDatabaseUrl = process.env.DATABASE_URL;
		process.env.DATABASE_URL = postgresUrl();
		cleanup.defer(() => {
			if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
			else process.env.DATABASE_URL = previousDatabaseUrl;
		});
		// Two separate temp directories (two separate absolute paths), not one
		// directory rebuilt in place: Bun's dynamic `import()` has a known
		// transpile-cache defect for re-importing the *same* path with changed
		// content within one process (see HANDOFF.md's note on "Bun test-host
		// resolution and shared installer-cache defects" — not a reason to add
		// a framework-side fallback, just to route around it here). Both point
		// at the same PostgreSQL schema; migrate/seed run once, against the
		// unarmed directory, and are idempotent no-ops if repeated.
		const unarmedRoot = await mkdtemp(join(tmpdir(), "questpie-mcp-gate-off-"));
		const armedRoot = await mkdtemp(join(tmpdir(), "questpie-mcp-gate-on-"));
		cleanup.defer(() => rm(unarmedRoot, { force: true, recursive: true }));
		cleanup.defer(() => rm(armedRoot, { force: true, recursive: true }));
		try {
			await database!.unsafe(
				'DROP SCHEMA IF EXISTS "team_support_desk" CASCADE; DROP SCHEMA IF EXISTS questpie_internal CASCADE; DROP TABLE IF EXISTS support_auth_verification, support_auth_account, support_auth_session, support_auth_user CASCADE;',
			);
			await cp(fixtureRoot, unarmedRoot, { recursive: true });
			await cp(fixtureRoot, armedRoot, { recursive: true });
			await armCredentialResolver(armedRoot, expectedChallenge);
			await Promise.all([
				installQuestpieForTracer(unarmedRoot),
				installQuestpieForTracer(armedRoot),
			]);
			await Promise.all([
				installOpenTelemetryForTracer(unarmedRoot),
				installOpenTelemetryForTracer(armedRoot),
			]);

			// --- Unarmed build: the pristine, unmodified fixture, exactly as
			// every other Team Support Desk test compiles it. ---
			runCli(unarmedRoot, ["build"]);
			runCli(unarmedRoot, ["migration", "apply"]);
			runCli(unarmedRoot, ["seed", "apply"]);
			runFixtureScript(unarmedRoot, "auth:migrate");
			runFixtureScript(unarmedRoot, "auth:seed");
			const unarmedCredentials = await importFreshCredentials(unarmedRoot);
			const unarmedContract = compositionContract(
				"credentialResolver",
				unarmedCredentials.applicationCredentials as never,
			);
			const appOptions = {
				postgres: {
					connectionUrl: postgresUrl(),
					directConnectionUrl: postgresUrl(),
				},
				realtime: { hmacKey: new Uint8Array(32).fill(41) },
				maintenance: { authorize: () => true },
			} as const;
			const { createApp: createUnarmedApp } = await importFreshApp(unarmedRoot);
			const unarmedApp = await createUnarmedApp(appOptions);
			cleanup.defer(() => unarmedApp.close());

			// (5) Unarmed: tools/list stays public, unchanged from today.
			const unarmedList = await unarmedApp.fetch(
				catalogueRequest("tools/list"),
			);
			expect(unarmedList.status).toBe(200);
			expect(unarmedList.headers.has("www-authenticate")).toBe(false);
			const unarmedListBody = (await unarmedList.json()) as Readonly<{
				result: Readonly<{ tools: readonly Readonly<{ name: string }>[] }>;
			}>;
			expect(
				unarmedListBody.result.tools.some(
					(tool) => tool.name === "query.tickets.queue",
				),
			).toBe(true);
			const unarmedQueue = await unarmedApp.fetch(
				currentProtocolMcpRequest(authOrigin, ticketsQueueCall(undefined))
					.request,
			);
			expect(unarmedQueue.status).toBe(200);
			expect(unarmedQueue.headers.get("content-type")).toBe(
				"text/event-stream",
			);

			// --- Armed build: the pre-armed directory, compiled fresh (schema
			// and seed data already applied above, against the same database). ---
			runCli(armedRoot, ["build"]);
			const armedCredentials = await importFreshCredentials(armedRoot);
			const armedContract = compositionContract(
				"credentialResolver",
				armedCredentials.applicationCredentials as never,
			);

			// (6) The compiled contract differs in exactly the three new fields.
			expect(unarmedContract).toMatchObject({
				hasChallenge: false,
				protectCatalog: false,
				requireCredential: false,
			});
			expect(armedContract).toMatchObject({
				hasChallenge: true,
				protectCatalog: true,
				requireCredential: true,
			});
			expect({
				...armedContract,
				hasChallenge: false,
				protectCatalog: false,
				requireCredential: false,
			}).toEqual({
				...unarmedContract,
				hasChallenge: false,
				protectCatalog: false,
				requireCredential: false,
			});

			const { createApp: createArmedApp } = await importFreshApp(armedRoot);
			const armedApp = await createArmedApp(appOptions);
			cleanup.defer(() => armedApp.close());

			// (1) No credential -> 401 + exact challenge + no-store, on all three
			// gated surfaces.
			for (const request of [
				catalogueRequest("tools/list"),
				catalogueRequest("server/discover"),
				currentProtocolMcpRequest(authOrigin, ticketsQueueCall(undefined))
					.request,
			]) {
				const response = await armedApp.fetch(request);
				expect(response.status).toBe(401);
				expect(response.headers.get("www-authenticate")).toBe(
					expectedChallenge,
				);
				expect(response.headers.get("cache-control")).toBe("private, no-store");
			}

			// (2) A garbage/invalid session cookie also resolves to `anonymous`
			// in this fixture's resolver (no valid session, no integration key)
			// - the same fail-closed 401, proving armed catches the "presented
			// something, still anonymous" path too, not just "presented
			// nothing".
			const garbageCookieResponse = await armedApp.fetch(
				currentProtocolMcpRequest(
					authOrigin,
					ticketsQueueCall("team-support.session_token=not-a-real-session"),
				).request,
			);
			expect(garbageCookieResponse.status).toBe(401);
			expect(garbageCookieResponse.headers.get("www-authenticate")).toBe(
				expectedChallenge,
			);

			// (3) A valid credential still works: catalogue and a successful
			// tools/call, matching the unarmed shape.
			const signIn = await armedApp.fetch(
				new Request(`${authOrigin}/api/auth/sign-in/email`, {
					method: "POST",
					headers: { "content-type": "application/json", origin: authOrigin },
					body: JSON.stringify(supportAuthCredentials.agent),
				}),
			);
			expect(signIn.status).toBe(200);
			const cookie = responseCookie(signIn);
			const armedList = await armedApp.fetch(
				catalogueRequest("tools/list", cookie),
			);
			expect(armedList.status).toBe(200);
			const armedListBody = (await armedList.json()) as typeof unarmedListBody;
			expect(armedListBody.result.tools).toEqual(unarmedListBody.result.tools);
			const armedQueue = await armedApp.fetch(
				currentProtocolMcpRequest(authOrigin, ticketsQueueCall(cookie)).request,
			);
			expect(armedQueue.status).toBe(200);
			expect(armedQueue.headers.get("content-type")).toBe("text/event-stream");
			const armedQueueEvent = await armedQueue.text();
			const armedQueueFrame = JSON.parse(
				armedQueueEvent.slice(6, -2),
			) as Readonly<{ result: Readonly<{ structuredContent: unknown }> }>;
			expect(armedQueueFrame.result.structuredContent).toMatchObject({
				result: { nodes: expect.any(Array) },
			});

			// (4) Authenticated (valid agent credential) but Policy-denied at the
			// Context layer (claiming someone else's membership) -> a neutral
			// JSON-RPC failure over a 200/SSE frame, NOT a 401. Proves Policy
			// nondisclosure and credential-failure remain distinct outcomes
			// under the armed gate.
			const deniedRequest = currentProtocolMcpRequest(authOrigin, {
				arguments: {
					context: {
						organizationId: supportTracerIds.organization,
						membershipId: supportTracerIds.membershipCustomer,
					},
					input: { after: null, first: 20, statuses: null, teamIds: null },
				},
				headers: { cookie },
				name: "query.tickets.queue",
			}).request;
			const deniedResponse = await armedApp.fetch(deniedRequest);
			expect(deniedResponse.status).toBe(200);
			expect(deniedResponse.headers.get("content-type")).toBe(
				"text/event-stream",
			);
			expect(deniedResponse.headers.has("www-authenticate")).toBe(false);
			const deniedEvent = await deniedResponse.text();
			const deniedFrame = JSON.parse(deniedEvent.slice(6, -2)) as Readonly<{
				result: Readonly<{
					structuredContent: Readonly<{ error?: Readonly<{ code: string }> }>;
					isError?: boolean;
				}>;
			}>;
			expect(deniedFrame.result.isError).toBe(true);
			expect(deniedFrame.result.structuredContent.error?.code).not.toBe(
				"UNAUTHENTICATED",
			);
		} finally {
			await cleanup.dispose();
		}
	},
	180_000,
);
