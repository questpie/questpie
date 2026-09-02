import { expect, test } from "bun:test";
import {
	cp,
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	realpath,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { SQL } from "bun";

import {
	applyCommittedMigrations,
	compileApplication,
	loadCommittedMigration,
} from "@questpie/compiler";

import {
	integrationCredentialHeader,
	localIntegrationKey,
} from "../../../fixtures/team-support-desk/src/auth";
import { demoIds } from "../../../fixtures/team-support-desk/src/demo-ids";
import { installQuestpieForTracer } from "../../support/beta12-packed-questpie";

const repositoryRoot = resolve(import.meta.dir, "../../..");
const fixtureRoot = resolve(repositoryRoot, "fixtures/team-support-desk");
const postgresTest = process.env.PGHOST ? test : test.skip;

const ids = Object.freeze({
	organization: "20000000-0000-0000-0000-000000000001",
	team: "20000000-0000-0000-0000-000000000002",
	membership: "20000000-0000-0000-0000-000000000003",
	principal: demoIds.principals.integration,
	ticket: "20000000-0000-0000-0000-000000000005",
	emptyTicket: "20000000-0000-0000-0000-000000000006",
	visibleComment: "20000000-0000-0000-0000-000000000007",
	redactedComment: "20000000-0000-0000-0000-000000000008",
});

function postgresUrl(): string {
	const url = new URL("postgres://localhost/");
	url.hostname = process.env.PGHOST ?? "127.0.0.1";
	url.port = process.env.PGPORT ?? "5432";
	url.username = process.env.PGUSER ?? "postgres";
	url.pathname = `/${process.env.PGDATABASE ?? "postgres"}`;
	if (process.env.PGPASSWORD) url.password = process.env.PGPASSWORD;
	return url.toString();
}

async function prepareSource(root: string): Promise<void> {
	await rm(join(root, "node_modules"), { force: true, recursive: true });
	await mkdir(join(root, "node_modules"), { recursive: true });
	await installQuestpieForTracer(root);
	for (const dependency of [
		"@types",
		"auth",
		"better-auth",
		"pg",
		"typescript",
	])
		await symlink(
			await realpath(
				join(
					["auth", "better-auth", "pg"].includes(dependency)
						? fixtureRoot
						: repositoryRoot,
					"node_modules",
					dependency,
				),
			),
			join(root, "node_modules", dependency),
			"dir",
		);
	await writeFile(
		join(root, "src/inverse-detail-query.ts"),
		`import { codec } from "questpie";
import { defineQuery } from "#questpie/app";
import { comments } from "./comments";
import { tickets } from "./tickets";

const ticketComments = comments.list({
	first: 50,
	orderBy: { createdAt: "desc", id: "desc" },
	select: {
		id: true,
		body: true,
		createdAt: true,
		author: { select: { id: true, role: true } },
	},
});

export const inverseDetail = defineQuery({
	name: "tickets.inverseDetail",
	network: true,
	query: tickets.list({
		parameters: {
			id: codec.uuid(),
			first: codec.integer({ minimum: 1, maximum: 100 }),
			after: codec.nullable(codec.cursor()),
		},
		where: ({ row, parameters }) => row.id.equal(parameters.id),
		orderBy: { id: "asc" },
		select: { id: true, comments: ticketComments },
		page: ({ parameters }) => ({
			first: parameters.first,
			after: parameters.after,
		}),
	}),
});
`,
	);
	const policyPath = join(root, "src/comments/policy.ts");
	let policy = await readFile(policyPath, "utf8");
	const readStart =
		"\t\trows: ({ row, principal, tenant }) =>\n\t\t\texpr.and(\n";
	expect(policy).toContain(readStart);
	policy = policy.replace(
		readStart,
		`${readStart}\t\t\t\trow.kind.equal("public"),\n`,
	);
	await writeFile(policyPath, policy);
}

async function applyMigrations(): Promise<void> {
	const migrationRoot = join(fixtureRoot, "questpie/migrations");
	const names = (await readdir(migrationRoot, { withFileTypes: true }))
		.filter((entry) => entry.isDirectory())
		.map(({ name }) => name)
		.sort();
	const result = await applyCommittedMigrations({
		migrations: await Promise.all(
			names.map((name) => loadCommittedMigration(join(migrationRoot, name))),
		),
	});
	if (result.status !== "applied")
		throw new TypeError(`inverse tracer migrations were ${result.status}`);
}

postgresTest(
	"runs one compiled inverse statement through direct, Fetch, client, and watch paths",
	async () => {
		const temporary = await mkdtemp(join(tmpdir(), "questpie-inv03-pg-"));
		const priorDatabaseUrl = process.env.DATABASE_URL;
		process.env.DATABASE_URL = postgresUrl();
		const database = new SQL({ max: 2 });
		let application:
			| Readonly<{
					close(): Promise<void>;
					execution(
						input: unknown,
						use: (scope: unknown) => unknown,
					): Promise<unknown>;
					fetch(request: Request): Promise<Response>;
			  }>
			| undefined;
		try {
			await database.unsafe(
				'DROP SCHEMA IF EXISTS "team_support_desk" CASCADE; DROP SCHEMA IF EXISTS questpie_internal CASCADE;',
			);
			await applyMigrations();
			await cp(fixtureRoot, temporary, { recursive: true });
			await prepareSource(temporary);
			await compileApplication({ applicationRoot: temporary });

			await database`
				insert into team_support_desk.organizations (id, name)
				values (${ids.organization}, 'Inverse Org')
			`;
			await database`
				insert into team_support_desk.memberships
					(id, organization_id, principal_id, role, status)
				values (${ids.membership}, ${ids.organization}, ${ids.principal}, 'agent', 'active')
			`;
			await database`
				insert into team_support_desk.teams
					(id, organization_id, name, routing_status)
				values (${ids.team}, ${ids.organization}, 'Inverse Team', 'active')
			`;
			for (const [id, reference, summary] of [
				[ids.ticket, "INV-1", "With comments"],
				[ids.emptyTicket, "INV-2", "Without comments"],
			] as const)
				await database`
					insert into team_support_desk.tickets
						(id, organization_id, team_id, requester_membership_id,
						 reference, summary, description, status, priority)
					values (${id}, ${ids.organization}, ${ids.team}, ${ids.membership},
						${reference}, ${summary}, 'description', 'open', 'normal')
				`;
			for (let index = 0; index < 50; index += 1) {
				const id = `30000000-0000-0000-0000-${index.toString(16).padStart(12, "0")}`;
				await database`
					insert into team_support_desk.comments
						(id, ticket_id, author_membership_id, body, kind, created_at)
					values (${id}, ${ids.ticket}, ${ids.membership}, ${`hidden-${index}`},
						'internal', ${new Date(1_788_240_000_000 + index * 1_000)})
				`;
			}
			await database`
				insert into team_support_desk.comments
					(id, ticket_id, author_membership_id, body, kind, created_at)
				values
					(${ids.visibleComment}, ${ids.ticket}, ${ids.membership}, 'visible', 'public', '2026-08-01T10:00:00Z'),
					(${ids.redactedComment}, ${ids.ticket}, ${ids.membership}, 'redacted', 'public', '2026-08-01T09:00:00Z')
			`;

			const nonce = `?inv03=${crypto.randomUUID()}`;
			const generatedRoot = join(temporary, ".questpie/generated");
			const generated = await import(
				`${pathToFileURL(join(generatedRoot, "app.ts")).href}${nonce}`
			);
			const generatedClient = await import(
				`${pathToFileURL(join(generatedRoot, "client.ts")).href}${nonce}`
			);
			const framework = await import(
				`${pathToFileURL(join(temporary, "node_modules/questpie/index.ts")).href}${nonce}`
			);
			const app = await generated.createApp({
				postgres: {
					connectionUrl: postgresUrl(),
					directConnectionUrl: postgresUrl(),
				},
				realtime: { hmacKey: new Uint8Array(32).fill(31) },
				maintenance: { authorize: () => true },
			});
			application = app;
			const principal = framework.principal.service({ name: ids.principal });
			const context = {
				organizationId: ids.organization,
				membershipId: ids.membership,
			};
			const input = { id: ids.ticket, first: 1, after: null };
			const direct = await app.execution(
				{ principal, context },
				({ queries }: { queries: Record<string, Record<string, Function>> }) =>
					queries.tickets!.inverseDetail!(input),
			);

			let captured: Request | undefined;
			const transport = (request: Request) => {
				const headers = new Headers(request.headers);
				headers.set(integrationCredentialHeader, localIntegrationKey);
				const authorized = new Request(request, { headers });
				captured ??= authorized.clone();
				return app.fetch(authorized);
			};
			const client = generatedClient.createClient({
				baseUrl: "http://inverse.test",
				fetch: transport,
			});
			const scoped = client.withContext(context);
			const network = await scoped.queries["tickets.inverseDetail"](input);
			expect(network).toEqual(direct);
			if (!captured) expect.unreachable();
			const rawResponse = await app.fetch(captured);
			expect(rawResponse.status, await rawResponse.clone().text()).toBe(200);
			const raw = await rawResponse.json();
			expect(raw).toMatchObject({
				callId: expect.any(String),
				result: { nodes: expect.any(Array), pageInfo: expect.any(Object) },
			});
			expect(direct).toEqual({
				nodes: [
					{
						id: ids.ticket,
						comments: [
							{
								id: ids.visibleComment,
								body: "visible",
								createdAt: new Date("2026-08-01T10:00:00.000Z"),
								author: { id: ids.membership, role: "agent" },
							},
							{
								id: ids.redactedComment,
								body: "redacted",
								createdAt: new Date("2026-08-01T09:00:00.000Z"),
								author: { id: ids.membership, role: "agent" },
							},
						],
					},
				],
				pageInfo: { endCursor: expect.any(String), hasNextPage: false },
			});
			const empty = await scoped.queries["tickets.inverseDetail"]({
				...input,
				id: ids.emptyTicket,
			});
			expect(empty.nodes[0]?.comments).toEqual([]);
			expect(Object.isFrozen(direct.nodes[0]!.comments)).toBe(true);

			const initial = await new Promise<unknown>((resolve, reject) => {
				const timer = setTimeout(
					() => reject(new Error("watch timed out")),
					10_000,
				);
				const stop = scoped.queries["tickets.inverseDetail"].watch(
					input,
					(value: unknown) => {
						clearTimeout(timer);
						stop();
						resolve(value);
					},
					{ onError: reject },
				);
			});
			expect(initial).toEqual(network);
		} finally {
			await application?.close().catch(() => {});
			await database
				.unsafe(
					'DROP SCHEMA IF EXISTS "team_support_desk" CASCADE; DROP SCHEMA IF EXISTS questpie_internal CASCADE;',
				)
				.catch(() => {});
			await database.close({ timeout: 0 }).catch(() => {});
			await rm(temporary, { recursive: true, force: true });
			if (priorDatabaseUrl === undefined) delete process.env.DATABASE_URL;
			else process.env.DATABASE_URL = priorDatabaseUrl;
		}
	},
	30_000,
);
