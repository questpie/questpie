import { expect, test } from "bun:test";
import { copyFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { SQL } from "bun";

import { compileApplication } from "@questpie/compiler";

import {
	beta05Ids,
	prepareBeta05PostgresApplication,
} from "./helpers/beta05-runtime";

const postgresTest = process.env.PGHOST ? test.serial : test.skip;
function connectionUrl(database: string) {
	const url = new URL("postgres://localhost/");
	url.hostname = process.env.PGHOST ?? "127.0.0.1";
	url.port = process.env.PGPORT ?? "5432";
	url.username = process.env.PGUSER ?? "postgres";
	if (process.env.PGPASSWORD) url.password = process.env.PGPASSWORD;
	url.pathname = `/${database}`;
	return url.toString();
}

postgresTest(
	"Mutation Collection list shares writes, Policy-before-limit, cursors and terminal budgets",
	async () => {
		const name = `qp_mutation_list_${crypto.randomUUID().replaceAll("-", "")}`;
		const previous = process.env.PGDATABASE;
		const admin = new SQL(connectionUrl("postgres"), { max: 1 });
		let owned = false;
		let database: SQL | undefined;
		let prepared:
			| Awaited<ReturnType<typeof prepareBeta05PostgresApplication>>
			| undefined;
		let application:
			| {
					execution(
						root: unknown,
						use: (scope: {
							mutations: {
								message: {
									probeList(input: unknown): Promise<{
										nodes: { id: string; createdAt: Date }[];
										pageInfo: {
											endCursor: string | null;
											hasNextPage: boolean;
										};
									}>;
								};
							};
						}) => Promise<unknown>,
					): Promise<unknown>;
					close(): Promise<void>;
			  }
			| undefined;
		try {
			await admin.unsafe(`CREATE DATABASE "${name}"`);
			owned = true;
			process.env.PGDATABASE = name;
			database = new SQL(connectionUrl(name), { max: 2 });
			const [connected] =
				await database`SELECT current_database() AS name, current_setting('server_version_num')::integer AS version`;
			expect(connected.name).toBe(name);
			expect(Math.floor(connected.version / 10_000)).toBe(17);
			prepared = await prepareBeta05PostgresApplication(database);
			const root = resolve(prepared.generated.generatedRoot, "../..");
			await copyFile(
				resolve(
					import.meta.dir,
					"../../../docs/v4/prototypes/static-job-schedules/mutation-list.fixture.ts",
				),
				join(root, "src/mutation-list-probe.ts"),
			);
			await compileApplication({ applicationRoot: root });
			const internal = await prepared.generated.loadInternal();
			application = await internal.createApplication({
				postgres: {
					connectionUrl: connectionUrl(name),
					directConnectionUrl: connectionUrl(name),
				},
				realtime: { hmacKey: new Uint8Array(32).fill(42) },
				maintenance: { authorize: () => false },
			});
			const execution = {
				principal: prepared.generated.framework.principal.user({
					id: beta05Ids.principal,
				}),
				context: { companyId: beta05Ids.company },
			};
			const hiddenMembership = crypto.randomUUID();
			await database`INSERT INTO collaboration.memberships (id, company_id, principal_id, role, scope_key, status) VALUES (${hiddenMembership}, ${beta05Ids.company}, ${crypto.randomUUID()}, 'admin', 'company', 'suspended')`;
			await database`INSERT INTO collaboration.messages (id, channel_id, author_membership_id, body, created_at) VALUES (${crypto.randomUUID()}, ${beta05Ids.channel}, ${hiddenMembership}, 'hidden-before-limit', '2030-01-01T00:00:00Z')`;
			const request = {
				channelId: beta05Ids.channel,
				first: 1,
				after: null,
				write: true,
				exhaust: false,
				extra: false,
			};
			expect(
				await application!.execution(execution, ({ mutations }) =>
					mutations.message.probeList({ ...request, write: false }),
				),
			).toMatchObject({
				nodes: [{ id: beta05Ids.message }],
				pageInfo: { hasNextPage: false },
			});
			const page = (await application!.execution(execution, ({ mutations }) =>
				mutations.message.probeList(request),
			)) as {
				nodes: { id: string; createdAt: Date }[];
				pageInfo: { endCursor: string | null; hasNextPage: boolean };
			};
			expect(page.nodes).toHaveLength(1);
			expect(page.nodes[0]!.createdAt).toBeInstanceOf(Date);
			expect(page.nodes[0]!.id).not.toBe(beta05Ids.message);
			expect(page.pageInfo.hasNextPage).toBe(true);
			expect(page.pageInfo.endCursor).toBeString();
			const [written] =
				await database`SELECT id FROM collaboration.messages WHERE body = 'inside-list-transaction'`;
			expect(page.nodes[0]!.id).toBe(written.id);
			const next = (await application!.execution(execution, ({ mutations }) =>
				mutations.message.probeList({
					...request,
					write: false,
					after: page.pageInfo.endCursor,
				}),
			)) as typeof page;
			expect(next.nodes.map((row) => row.id)).toEqual([beta05Ids.message]);
			expect(next.pageInfo.hasNextPage).toBe(false);
			await expect(
				application!.execution(execution, ({ mutations }) =>
					mutations.message.probeList({ ...request, exhaust: true }),
				),
			).rejects.toMatchObject({ code: "INTERNAL" });
			const [count] =
				await database`SELECT count(*)::integer AS count FROM collaboration.messages WHERE body = 'inside-list-transaction'`;
			expect(count.count).toBe(1);
			await expect(
				application!.execution(execution, ({ mutations }) =>
					mutations.message.probeList({
						...request,
						write: false,
						extra: true,
					}),
				),
			).rejects.toMatchObject({ code: "INTERNAL" });
		} finally {
			const cleanup = await Promise.allSettled([
				application?.close(),
				prepared?.dispose(),
			]);
			await database?.close({ timeout: 0 });
			if (previous === undefined) delete process.env.PGDATABASE;
			else process.env.PGDATABASE = previous;
			if (owned) await admin.unsafe(`DROP DATABASE "${name}"`);
			await admin.close({ timeout: 0 });
			expect(cleanup.every((result) => result.status === "fulfilled")).toBe(
				true,
			);
		}
	},
	120_000,
);
