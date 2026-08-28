import { afterAll, expect, test } from "bun:test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

type MessageInput = Readonly<{
	authorMembershipId: string;
	body: string;
	channelId: string;
}>;

type Message = Readonly<{
	body: string;
}>;

type MutationOptions = Readonly<{ callId: string }>;

type GeneratedApplication = Readonly<{
	execution<Result>(
		input: Readonly<{
			principal: Principal;
			context: Readonly<{ companyId: string }>;
		}>,
		use: (
			scope: Readonly<{
				mutations: Readonly<{
					messages: Readonly<{
						create(
							input: Readonly<{ input: MessageInput }>,
							options: MutationOptions,
						): Promise<Message>;
					}>;
				}>;
			}>,
		) => Result | Promise<Result>,
	): Promise<Awaited<Result>>;
	fetch(request: Request): Promise<Response>;
	close(): Promise<void>;
}>;

type GeneratedClient = Readonly<{
	withContext(context: Readonly<{ companyId: string }>): Readonly<{
		mutations: Readonly<{
			"messages.create"(
				input: Readonly<{ input: MessageInput }>,
				options: MutationOptions,
			): Promise<Message>;
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

function runCli(root: string, arguments_: readonly string[]): void {
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
}

afterAll(async () => database?.close({ timeout: 0 }));

postgresTest(
	"executes one generated Collection write kernel through direct and network Operations",
	async () => {
		const temporary = await mkdtemp(
			join(tmpdir(), "questpie-generated-operation-adapter-"),
		);
		let application: GeneratedApplication | undefined;
		try {
			await database!.unsafe(
				'DROP SCHEMA IF EXISTS "collaboration" CASCADE; DROP SCHEMA IF EXISTS questpie_internal CASCADE;',
			);
			await cp(fixtureRoot, temporary, { recursive: true });
			const operationsPath = join(temporary, "src/message-operations.ts");
			const operations = await readFile(operationsPath, "utf8");
			await writeFile(
				operationsPath,
				operations.replace(
					'name: "messages",\n\tpolicy: messagePolicy,',
					'name: "messages",\n\tpolicy: messagePolicy,\n\tnetwork: true,',
				),
			);
			const questpieEntry = await installQuestpieForTracer(temporary);
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
					) as Promise<
						Readonly<{ createClient(input: unknown): GeneratedClient }>
					>,
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
				realtime: { hmacKey: new Uint8Array(32).fill(30) },
				maintenance: { authorize: () => false },
			});
			const root = {
				principal: principal.user({ id: tracerIds.principal }),
				context: { companyId: tracerIds.company },
			};
			const directInput = {
				input: {
					authorMembershipId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a3",
					body: "  generated direct  ",
					channelId: tracerIds.channel,
				},
			};
			await expect(
				application.execution(root, ({ mutations }) =>
					mutations.messages.create(
						{
							input: {
								...directInput.input,
								channelId: "not-a-uuid",
							},
						},
						{ callId: "generated-operation-invalid-direct" },
					),
				),
			).rejects.toThrow("PROTOCOL_UNSUPPORTED");

			const direct = await application.execution(root, ({ mutations }) =>
				mutations.messages.create(directInput, {
					callId: "generated-operation-direct",
				}),
			);
			expect(direct).toMatchObject({ body: "generated direct" });
			const replay = await application.execution(root, ({ mutations }) =>
				mutations.messages.create(directInput, {
					callId: "generated-operation-direct",
				}),
			);
			expect(replay).toEqual(direct);

			let transportCalls = 0;
			const client = createClient({
				baseUrl: "https://app.test",
				fetch: (request: Request) => {
					transportCalls += 1;
					const headers = new Headers(request.headers);
					headers.set(
						"cookie",
						"questpie_tracer_session=f18f8b8e0e1446079dc6e6d4755505f9",
					);
					return application!.fetch(new Request(request, { headers }));
				},
			}).withContext({ companyId: tracerIds.company });
			await expect(
				client.mutations["messages.create"](
					{
						input: { ...directInput.input, channelId: "not-a-uuid" },
					},
					{ callId: "generated-operation-invalid-network" },
				),
			).rejects.toThrow("PROTOCOL_UNSUPPORTED");
			expect(transportCalls).toBe(0);
			const network = await client.mutations["messages.create"](
				{
					input: {
						authorMembershipId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a3",
						body: "  generated network  ",
						channelId: tracerIds.channel,
					},
				},
				{ callId: "generated-operation-network" },
			);
			expect(network).toMatchObject({ body: "generated network" });
			expect(transportCalls).toBe(1);

			const rows = await database!.unsafe(
				`SELECT body FROM collaboration.messages WHERE body IN ('generated direct', 'generated network') ORDER BY body`,
			);
			expect(rows.map(({ body }) => body)).toEqual([
				"generated direct",
				"generated network",
			]);
			const receipts = await database!.unsafe(
				`SELECT call_id FROM questpie_internal.mutation_call_receipts WHERE operation_name = 'mutation:messages.create' ORDER BY call_id`,
			);
			expect(receipts.map((row) => row.call_id)).toEqual([
				"generated-operation-direct",
				"generated-operation-network",
			]);
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
