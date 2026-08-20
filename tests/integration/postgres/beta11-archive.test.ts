import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { SQL } from "bun";
import type { Principal } from "questpie";

import {
	applyCommittedMigrations,
	compileApplication,
	loadCommittedMigration,
} from "@questpie/compiler";

const fixtureRoot = resolve(import.meta.dir, "../../../fixtures/archive");
const repositoryRoot = resolve(import.meta.dir, "../../..");
const database = process.env.PGHOST ? new SQL({ max: 8 }) : undefined;
const postgresTest = process.env.PGHOST ? test : test.skip;

setDefaultTimeout(30_000);

const ids = Object.freeze({
	authorized: "018f5f6e-5f2c-7b41-a854-3d9a6b6b6201",
	reader: "018f5f6e-5f2c-7b41-a854-3d9a6b6b6202",
	nationalTenant: "018f5f6e-5f2c-7b41-a854-3d9a6b6b6203",
	foreignTenant: "018f5f6e-5f2c-7b41-a854-3d9a6b6b6204",
});

type RecordNode = Readonly<{
	archiveCode: string;
	catalogueNumber: string;
	visibility: string;
	title: string;
	body?: string;
	createdAt: Date;
}>;

type Page<Node> = Readonly<{
	nodes: readonly Node[];
	pageInfo: Readonly<{ endCursor: string | null; hasNextPage: boolean }>;
}>;

type QueryInput = Readonly<{
	archiveCode: string;
	first: number;
	after: string | null;
}>;

type GeneratedApplication = Readonly<{
	execution<Result>(
		input: Readonly<{ principal: Principal; context: { archiveCode: string } }>,
		use: (
			scope: Readonly<{
				queries: Readonly<{
					"records.page"(input: QueryInput): Promise<Page<RecordNode>>;
					"provenance.page"(
						input: Readonly<{
							archiveCode: string;
							catalogueNumber: string;
							first: number;
							after: string | null;
						}>,
					): Promise<
						Page<
							Readonly<{
								sequence: number;
								kind: string;
								note: string;
							}>
						>
					>;
				}>;
				mutations: Readonly<{
					"record.deposit"(
						input: Readonly<{
							archiveCode: string;
							catalogueNumber: string;
							visibility: string;
							title: string;
							body: string;
						}>,
						options: Readonly<{ callId: string }>,
					): Promise<
						Readonly<{
							archiveCode: string;
							catalogueNumber: string;
							createdAt: Date;
						}>
					>;
				}>;
			}>,
		) => Result | Promise<Result>,
	): Promise<Awaited<Result>>;
	fetch(request: Request): Promise<Response>;
	durable: Readonly<{
		poll(): Promise<
			Readonly<{
				claimed: number;
				outcomes: readonly Readonly<{ outcome: string; runId: string }>[];
			}>
		>;
	}>;
	close(): Promise<void>;
}>;

type GeneratedInternal = Readonly<{
	bindIngressPrincipalForRequest(request: Request, principal: unknown): Request;
	createApplication(
		input: Readonly<{
			postgres: Readonly<{ url: string }>;
			realtime: Readonly<{ hmacKey: Uint8Array }>;
			maintenance: Readonly<{ authorize(): boolean }>;
		}>,
	): Promise<GeneratedApplication>;
}>;

type GeneratedClient = Readonly<{
	withContext(context: Readonly<{ archiveCode: string }>): Readonly<{
		queries: Readonly<{
			"records.page": Readonly<{
				watch(
					input: QueryInput,
					callback: (
						page: Page<RecordNode>,
						delivery: Readonly<{ kind: string }>,
					) => void,
					options?: Readonly<{
						onError?: (error: Readonly<{ code: string }>) => void;
					}>,
				): () => void;
			}>;
		}>;
	}>;
}>;

function postgresUrl(): string {
	const url = new URL("postgres://localhost/");
	url.hostname = process.env.PGHOST ?? "127.0.0.1";
	url.port = process.env.PGPORT ?? "5432";
	url.username = process.env.PGUSER ?? "postgres";
	url.pathname = `/${process.env.PGDATABASE ?? "postgres"}`;
	if (process.env.PGPASSWORD) url.password = process.env.PGPASSWORD;
	return url.toString();
}

function deferred<Value>() {
	let resolvePromise!: (value: Value) => void;
	let rejectPromise!: (reason: unknown) => void;
	const promise = new Promise<Value>((resolve, reject) => {
		resolvePromise = resolve;
		rejectPromise = reject;
	});
	return { promise, reject: rejectPromise, resolve: resolvePromise };
}

async function within<Value>(promise: Promise<Value>, milliseconds: number) {
	return Promise.race([
		promise,
		Bun.sleep(milliseconds).then(() => {
			throw new Error(`archive trace exceeded ${milliseconds}ms`);
		}),
	]);
}

async function relocatedFixture(): Promise<string> {
	const temporary = await mkdtemp(join(tmpdir(), "questpie-beta11-pg-"));
	await cp(fixtureRoot, temporary, { recursive: true });
	await mkdir(join(temporary, "node_modules/questpie"), { recursive: true });
	await writeFile(
		join(temporary, "node_modules/questpie/package.json"),
		JSON.stringify({ name: "questpie", type: "module", exports: "./index.ts" }),
	);
	await symlink(
		resolve(repositoryRoot, "packages/questpie/src/index.ts"),
		join(temporary, "node_modules/questpie/index.ts"),
		"file",
	);
	return temporary;
}

async function prepareArchive() {
	await database!.unsafe(
		'DROP SCHEMA IF EXISTS "archive" CASCADE; DROP SCHEMA IF EXISTS questpie_internal CASCADE;',
	);
	const migration = await loadCommittedMigration(
		resolve(fixtureRoot, "questpie/migrations/000001_create-archive"),
	);
	const applied = await applyCommittedMigrations({ migrations: [migration] });
	if (applied.status !== "applied")
		throw new Error(`failed to apply archive migration: ${applied.status}`);

	await database!`
		insert into archive.institutions (code, tenant_id, name) values
		('national', ${ids.nationalTenant}, 'National Archive'),
		('foreign', ${ids.foreignTenant}, 'Foreign Archive')
	`;
	await database!`
		insert into archive.research_permits
			(programme_code, archive_code, principal_id, status, may_view_restricted, may_deposit)
		values ('programme-linguistics', 'national', ${ids.authorized}, 'active', true, true)
	`;
	await database!`
		insert into archive.records
			(archive_code, catalogue_number, visibility, title, body, created_at)
		values
			('national', 'N-001', 'public', 'Embargoed public record', 'sealed one', '2026-08-20T10:00:00Z'),
			('national', 'N-002', 'restricted', 'Permit record', 'sealed two', '2026-08-20T10:01:00Z'),
			('foreign', 'F-001', 'restricted', 'Foreign record', 'foreign sealed', '2026-08-20T10:02:00Z')
	`;
	await database!`
		insert into archive.embargoes
			(archive_code, catalogue_number, status, expires_at)
		values ('national', 'N-001', 'active', '2027-08-20T00:00:00Z')
	`;

	const temporary = await relocatedFixture();
	try {
		await compileApplication({ applicationRoot: temporary });
		const generatedRoot = join(temporary, ".questpie/generated");
		const nonce = `?beta11=${crypto.randomUUID()}`;
		const client = await import(
			`${pathToFileURL(join(generatedRoot, "client.ts")).href}${nonce}`
		);
		const framework = await import(
			`${pathToFileURL(join(temporary, "node_modules/questpie/index.ts")).href}${nonce}`
		);
		const internal = (await import(
			`${pathToFileURL(join(generatedRoot, "internal/application.js")).href}${nonce}`
		)) as GeneratedInternal;
		const applications = new Set<GeneratedApplication>();
		const createApplication = async () => {
			const application = await internal.createApplication({
				postgres: { url: postgresUrl() },
				realtime: { hmacKey: new Uint8Array(32).fill(11) },
				maintenance: { authorize: () => true },
			});
			applications.add(application);
			return application;
		};
		return {
			client,
			createApplication,
			framework,
			internal,
			dispose: async () => {
				await Promise.allSettled(
					[...applications].map((application) => application.close()),
				);
				await rm(temporary, { recursive: true, force: true });
			},
		};
	} catch (error) {
		await rm(temporary, { recursive: true, force: true });
		throw error;
	}
}

afterAll(async () => {
	await database?.close({ timeout: 0 });
});

postgresTest(
	"runs permit, embargo, append-only watch, and recovered Reaction through one archive Runtime",
	async () => {
		const prepared = await prepareArchive();
		let application = await prepared.createApplication();
		const principal = (id: string) =>
			prepared.framework.principal.user({ id }) as Principal;
		const page = async (caller: Principal, archiveCode = "national") => {
			try {
				return await application.execution(
					{ principal: caller, context: { archiveCode } },
					({ queries }) =>
						queries["records.page"]({ archiveCode, first: 100, after: null }),
				);
			} catch (error) {
				throw new Error(`records.page failed for ${archiveCode}`, {
					cause: error,
				});
			}
		};
		try {
			const reader = principal(ids.reader);
			const authorized = principal(ids.authorized);
			expect((await page(reader)).nodes).toEqual([]);
			expect((await page(authorized)).nodes).toHaveLength(2);
			expect((await page(authorized, "foreign")).nodes).toEqual([]);

			await database!`
				update archive.embargoes set status = 'expired'
				where archive_code = 'national' and catalogue_number = 'N-001'
			`;
			expect((await page(reader)).nodes).toMatchObject([
				{ catalogueNumber: "N-001", title: "Embargoed public record" },
			]);
			expect((await page(reader)).nodes[0]).not.toHaveProperty("body");

			await database!`
				insert into archive.research_permits
					(programme_code, archive_code, principal_id, status, may_view_restricted, may_deposit)
				values ('programme-linguistics', 'national', ${ids.reader}, 'active', true, false)
			`;
			await database!`
				update archive.embargoes set status = 'active'
				where archive_code = 'national' and catalogue_number = 'N-001'
			`;
			expect((await page(reader)).nodes.map(({ body }) => body)).toEqual([
				"sealed two",
				"sealed one",
			]);

			await database!`
				update archive.research_permits set status = 'revoked'
				where archive_code = 'national' and principal_id = ${ids.reader}
			`;
			expect((await page(reader)).nodes).toEqual([]);
			expect((await page(reader, "foreign")).nodes).toEqual([]);

			const initial = deferred<void>();
			const updated = deferred<Page<RecordNode>>();
			const failures: string[] = [];
			let sawInitial = false;
			const client = prepared.client.createClient({
				baseUrl: "http://runtime.test",
				fetch: (request: Request) =>
					application.fetch(
						prepared.internal.bindIngressPrincipalForRequest(
							request,
							authorized,
						),
					),
			}) as GeneratedClient;
			const stop = client
				.withContext({ archiveCode: "national" })
				.queries["records.page"].watch(
					{ archiveCode: "national", first: 100, after: null },
					(result, delivery) => {
						if (delivery.kind === "initial") {
							sawInitial = true;
							initial.resolve();
						}
						if (
							delivery.kind === "update" &&
							result.nodes.some(
								({ catalogueNumber }) => catalogueNumber === "N-003",
							)
						)
							updated.resolve(result);
					},
					{ onError: (error) => failures.push(error.code) },
				);
			await within(initial.promise, 5_000);

			const deposited = await application.execution(
				{ principal: authorized, context: { archiveCode: "national" } },
				({ mutations }) =>
					mutations["record.deposit"](
						{
							archiveCode: "national",
							catalogueNumber: "N-003",
							visibility: "restricted",
							title: "Runtime deposit",
							body: "portable append",
						},
						{ callId: "beta11-deposit-1" },
					),
			);
			expect(deposited).toMatchObject({
				archiveCode: "national",
				catalogueNumber: "N-003",
			});
			expect((await within(updated.promise, 15_000)).nodes).toContainEqual(
				expect.objectContaining({
					catalogueNumber: "N-003",
					body: "portable append",
				}),
			);
			stop();
			expect(sawInitial).toBe(true);
			expect(failures).toEqual([]);

			await application.close();
			application = await prepared.createApplication();
			let workerTrace = await application.durable.poll();
			for (
				let attempt = 0;
				workerTrace.claimed === 0 && attempt < 20;
				attempt += 1
			) {
				await Bun.sleep(25);
				workerTrace = await application.durable.poll();
			}
			expect(workerTrace.outcomes).toContainEqual(
				expect.objectContaining({ outcome: "succeeded" }),
			);

			const provenance = await application.execution(
				{ principal: authorized, context: { archiveCode: "national" } },
				({ queries }) =>
					queries["provenance.page"]({
						archiveCode: "national",
						catalogueNumber: "N-003",
						first: 100,
						after: null,
					}),
			);
			expect(
				provenance.nodes.map(({ sequence, kind }) => ({ sequence, kind })),
			).toEqual([
				{ sequence: 1, kind: "deposited" },
				{ sequence: 2, kind: "indexed" },
			]);
		} finally {
			await prepared.dispose();
		}
	},
);
