import { afterAll, expect, test } from "bun:test";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { SQL } from "bun";
import type { Principal } from "questpie";

import { tracerIds } from "../../../fixtures/collaboration/tracer/constants";
import { installQuestpieForTracer } from "../../support/beta12-packed-questpie";

const repositoryRoot = resolve(import.meta.dir, "../../..");
const fixtureRoot = resolve(repositoryRoot, "fixtures/collaboration");
const cli = resolve(repositoryRoot, "packages/questpie/dist/cli.js");
const database = process.env.PGHOST ? new SQL({ max: 2 }) : undefined;
const postgresTest = process.env.PGHOST ? test.serial : test.skip;

type DetailQuery = Readonly<{
	(input: Readonly<{ id: string }>): Promise<Readonly<{
		id: string;
		label: string;
	}> | null>;
	watch(
		input: Readonly<{ id: string }>,
		onData: (value: Readonly<{ id: string; label: string }> | null) => void,
		options: Readonly<{ onError: (error: unknown) => void }>,
	): () => void;
}>;

type GeneratedApplication = Readonly<{
	execution<Result>(
		input: Readonly<{
			principal: Principal;
			context: Readonly<{ companyId: string }>;
		}>,
		use: (
			scope: Readonly<{
				mutations: Readonly<{
					watchableRecords: Readonly<{
						deleteRecord(
							input: Readonly<{ id: string }>,
							options: Readonly<{ callId: string }>,
						): Promise<Readonly<{ deleted: boolean }>>;
					}>;
				}>;
			}>,
		) => Result | Promise<Result>,
	): Promise<Awaited<Result>>;
	fetch(request: Request): Promise<Response>;
	close(): Promise<void>;
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

// Watchable-Query proof: the change-ledger trigger already fires on DELETE
// (verified by reading the trigger source), but that is not the same as
// proving a live subscription actually converges. This wires one Query
// (list with first:1, the same "detail" shape channels.detail uses) over a
// Collection that also grants delete, watches it through the generated
// network client end to end (trigger -> change ledger -> Runtime
// reconciliation -> delivered snapshot), then deletes the watched row and
// asserts the watch delivers a snapshot with the row gone (null). A second
// row proves the inverse: a Policy-denied delete (current.locked === true)
// delivers no new "gone" snapshot — the watch stays on the original value.
const SOURCE = `import { codec, constraint, defineCollection, definePolicy, field, policy } from "questpie";

import { defineMutation, defineQuery } from "#questpie/app";

export const watchableRecords = defineCollection({
	name: "watchableRecords",
	fields: {
		id: field.uuid({ nullable: false, default: "randomUuid", server: true, immutable: true }),
		label: field.text({ nullable: false, server: false, immutable: false }),
		locked: field.boolean({ nullable: false, default: false, server: false, immutable: false }),
	},
	constraints: { primary: constraint.primaryKey({ fields: ["id"] }) },
});

export const watchableRecordPolicy = definePolicy(watchableRecords, {
	name: "watchableRecords.default",
	read: {
		admit: policy.authenticated(),
		rows: ({ row }) => row.id.equal(row.id),
	},
	delete: {
		admit: policy.authenticated(),
		rows: ({ current }) => current.locked.equal(false),
	},
});

export const watchableRecordDetailPlan = watchableRecords.list({
	parameters: {
		recordId: codec.uuid(),
		pageSize: codec.integer({ minimum: 1, maximum: 1 }),
		pageCursor: codec.nullable(codec.cursor()),
	},
	where: ({ row, parameters }) => row.id.equal(parameters.recordId),
	orderBy: { id: "asc" },
	select: { id: true, label: true },
	page: ({ parameters }) => ({
		first: parameters.pageSize,
		after: parameters.pageCursor,
	}),
});

export const watchableRecordDetail = defineQuery({
	name: "watchableRecords.detail",
	network: true,
	input: codec.object({ id: codec.uuid() }),
	output: codec.nullable(codec.object({ id: codec.uuid(), label: codec.text() })),
	handler: async ({ input, ctx }) => {
		const page = await ctx.data.run(watchableRecordDetailPlan, {
			recordId: input.id,
			pageSize: 1,
			pageCursor: null,
		});
		return page.nodes[0] ?? null;
	},
});

export const deleteRecord = defineMutation({
	name: "watchableRecords.deleteRecord",
	network: true,
	input: codec.object({ id: codec.uuid() }),
	output: codec.object({ deleted: codec.boolean() }),
	policy: policy.authenticated(),
	errors: {},
	handler: async ({ input, ctx }) => {
		const deleted = await ctx.data.watchableRecords.delete({ key: { id: input.id } });
		return { deleted: deleted !== null };
	},
});
`;

afterAll(async () => database?.close({ timeout: 0 }));

postgresTest(
	"Live Query: a watch over a Collection Query converges after a kernel delete, and stays put on a Policy-denied delete",
	async () => {
		const temporary = await mkdtemp(
			join(tmpdir(), "questpie-adr0047-live-query-"),
		);
		let application: GeneratedApplication | undefined;
		try {
			await database!.unsafe(
				'DROP SCHEMA IF EXISTS "collaboration" CASCADE; DROP SCHEMA IF EXISTS questpie_internal CASCADE;',
			);
			await cp(fixtureRoot, temporary, { recursive: true });
			await writeFile(join(temporary, "src/watchable-records.ts"), SOURCE);
			const questpieEntry = await installQuestpieForTracer(temporary);
			runCli(temporary, ["build"]);
			runCli(temporary, ["migration", "apply"]);
			const planned = JSON.parse(
				runCli(temporary, [
					"migration",
					"plan",
					"--name",
					"add-watchable-records",
				]),
			);
			runCli(temporary, [
				"migration",
				"create",
				"--plan",
				planned.path,
				...(planned.classification === "destructive"
					? ["--accept-destructive", planned.digest]
					: []),
			]);
			runCli(temporary, ["build"]);
			runCli(temporary, ["migration", "apply"]);
			runCli(temporary, ["seed", "apply"]);

			const [{ createApp }, { createClient }, { principal }] =
				await Promise.all([
					import(
						`${pathToFileURL(join(temporary, ".questpie/generated/app.ts")).href}?direct=${crypto.randomUUID()}`
					) as Promise<
						Readonly<{
							createApp(input: unknown): Promise<GeneratedApplication>;
						}>
					>,
					import(
						`${pathToFileURL(join(temporary, ".questpie/generated/client.ts")).href}?network=${crypto.randomUUID()}`
					) as Promise<Readonly<{ createClient(input: unknown): unknown }>>,
					import(
						`${pathToFileURL(questpieEntry).href}?principal=${crypto.randomUUID()}`
					) as Promise<
						Readonly<{
							principal: Readonly<{
								user(input: Readonly<{ id: string }>): Principal;
							}>;
						}>
					>,
				]);
			application = await createApp({
				postgres: {
					connectionUrl: postgresUrl(),
					directConnectionUrl: postgresUrl(),
				},
				realtime: { hmacKey: new Uint8Array(32).fill(32) },
				maintenance: { authorize: () => false },
			});
			const root = {
				principal: principal.user({ id: tracerIds.principal }),
				context: { companyId: tracerIds.company },
			};
			const client = createClient({
				baseUrl: "https://watch.test",
				fetch: (request: Request) => {
					const headers = new Headers(request.headers);
					headers.set(
						"cookie",
						"questpie_tracer_session=f18f8b8e0e1446079dc6e6d4755505f9",
					);
					return application!.fetch(new Request(request, { headers }));
				},
			}) as Readonly<{
				withContext(context: Readonly<{ companyId: string }>): Readonly<{
					queries: Readonly<{ "watchableRecords.detail": DetailQuery }>;
				}>;
			}>;
			const scoped = client.withContext({ companyId: tracerIds.company });
			const detail = scoped.queries["watchableRecords.detail"];

			const [{ id: openIdRaw }] = await database!.unsafe(
				`INSERT INTO collaboration.watchable_records (id, label, locked) VALUES (gen_random_uuid(), 'open', false) RETURNING id`,
			);
			const [{ id: lockedIdRaw }] = await database!.unsafe(
				`INSERT INTO collaboration.watchable_records (id, label, locked) VALUES (gen_random_uuid(), 'locked', true) RETURNING id`,
			);
			const openId = String(openIdRaw);
			const lockedId = String(lockedIdRaw);

			// 1. Watch the deletable row, confirm the initial snapshot, delete
			// it directly, then wait (bounded) for a snapshot with the row gone.
			const openDeliveries: (Readonly<{ id: string; label: string }> | null)[] =
				[];
			let openError: unknown;
			const stopOpen = detail.watch(
				{ id: openId },
				(value) => {
					openDeliveries.push(value);
				},
				{ onError: (error) => (openError = error) },
			);
			try {
				await eventually(
					() => openDeliveries.length > 0,
					"initial watchableRecords.detail snapshot",
				);
				expect(openError).toBeUndefined();
				expect(openDeliveries.at(-1)).toEqual({ id: openId, label: "open" });

				await application.execution(root, ({ mutations }) =>
					mutations.watchableRecords.deleteRecord(
						{ id: openId },
						{ callId: "live-query-delete" },
					),
				);

				await eventually(
					() => openDeliveries.at(-1) === null,
					"watchableRecords.detail snapshot converging to gone after delete",
				);
			} finally {
				stopOpen();
			}

			// 2. Watch the locked row, attempt a Policy-denied delete, confirm
			// no "gone" snapshot ever arrives within a bounded window — the
			// watch stays on the original value.
			const lockedDeliveries: (Readonly<{
				id: string;
				label: string;
			}> | null)[] = [];
			const stopLocked = detail.watch(
				{ id: lockedId },
				(value) => {
					lockedDeliveries.push(value);
				},
				{ onError: () => {} },
			);
			try {
				await eventually(
					() => lockedDeliveries.length > 0,
					"initial watchableRecords.detail snapshot (locked row)",
				);
				expect(lockedDeliveries.at(-1)).toEqual({
					id: lockedId,
					label: "locked",
				});

				const denied = await application.execution(root, ({ mutations }) =>
					mutations.watchableRecords.deleteRecord(
						{ id: lockedId },
						{ callId: "live-query-denied-delete" },
					),
				);
				expect(denied).toEqual({ deleted: false });

				// Bounded negative wait: give the reconciliation loop a real
				// window to (wrongly) converge to "gone", then assert it did not.
				await Bun.sleep(2_000);
				expect(lockedDeliveries.every((value) => value !== null)).toBe(true);
				expect(lockedDeliveries.at(-1)).toEqual({
					id: lockedId,
					label: "locked",
				});
				expect(
					await database!.unsafe(
						`SELECT id FROM collaboration.watchable_records WHERE id = '${lockedId}'`,
					),
				).toHaveLength(1);
			} finally {
				stopLocked();
			}
		} finally {
			await application?.close();
			await database!.unsafe(
				'DROP SCHEMA IF EXISTS "collaboration" CASCADE; DROP SCHEMA IF EXISTS questpie_internal CASCADE;',
			);
			await rm(temporary, { force: true, recursive: true });
		}
	},
	60_000,
);

async function eventually(
	check: () => boolean,
	description: string,
	timeoutMilliseconds = 20_000,
	intervalMilliseconds = 100,
): Promise<void> {
	const deadline = Date.now() + timeoutMilliseconds;
	for (;;) {
		if (check()) return;
		if (Date.now() > deadline)
			throw new Error(`timed out waiting for ${description}`);
		await Bun.sleep(intervalMilliseconds);
	}
}
