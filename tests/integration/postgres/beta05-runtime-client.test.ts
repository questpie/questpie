import { afterAll, expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { SQL } from "bun";

import {
	beta05Ids,
	beta05PostgresUrl,
	prepareBeta05PostgresApplication,
} from "./helpers/beta05-runtime";

const database = process.env.PGHOST ? new SQL({ max: 1 }) : undefined;

afterAll(async () => {
	await database?.close({ timeout: 0 });
});

const postgresTest = process.env.PGHOST ? test : test.skip;

postgresTest(
	"runs the exact Message Query through direct, Fetch, and generated client paths",
	async () => {
		const prepared = await prepareBeta05PostgresApplication(database!);
		try {
			const { generated, runtimeBuildBytes } = prepared;
			const runtimeBuildPath = join(
				generated.generatedRoot,
				"runtime-build.json",
			);
			const mismatched = JSON.parse(runtimeBuildBytes);
			mismatched.schemaFingerprint = "0".repeat(64);
			await writeFile(runtimeBuildPath, `${JSON.stringify(mismatched)}\n`);
			await expect(
				generated.app.createApp({ postgres: { url: beta05PostgresUrl() } }),
			).rejects.toThrow("Runtime Build digest does not match");
			await writeFile(runtimeBuildPath, runtimeBuildBytes);

			const application = await generated.app.createApp({
				postgres: { url: beta05PostgresUrl() },
			});
			try {
				const internal = await generated.loadInternal();
				const user = generated.framework.principal.user({
					id: beta05Ids.principal,
				});
				const context = { companyId: beta05Ids.company };
				const input = { channelId: beta05Ids.channel, first: 20, after: null };
				const direct = await application.execution(
					{ principal: user, context },
					async ({
						queries,
						services,
						tenant,
					}: Readonly<{
						tenant: Readonly<{ id: string }>;
						services: Readonly<{
							"audit.connection": Readonly<{ id: number }>;
							"audit.execution": Readonly<{ connectionId: number }>;
						}>;
						queries: Readonly<
							Record<string, (queryInput: unknown) => Promise<unknown>>
						>;
					}>) => {
						expect(tenant.id).toBe(beta05Ids.company);
						expect(services["audit.connection"].id).toBe(1);
						expect(services["audit.execution"].connectionId).toBe(1);
						return queries["messages.page"]!(input);
					},
				);
				const runtimeBuild = JSON.parse(runtimeBuildBytes);
				const wire = JSON.parse(
					await readFile(
						join(generated.generatedRoot, "wire-contract.json"),
						"utf8",
					),
				);
				const rawRequest = new Request(
					"http://runtime.test/_questpie/operation",
					{
						method: "POST",
						headers: { "content-type": wire.mediaType },
						body: JSON.stringify({
							application: runtimeBuild.application,
							callId: crypto.randomUUID(),
							clientContractDigest: runtimeBuild.clientContractDigest,
							context,
							input,
							operation: "query:messages.page",
							protocol: wire.protocol,
							timeoutMilliseconds: 5_000,
							wireDigest: runtimeBuild.wireDigest,
						}),
					},
				);
				const rawResponse = await application.fetch(
					internal.bindIngressPrincipalForRequest(rawRequest, user),
				);
				expect(rawResponse.status).toBe(200);
				const rawFrame = (await rawResponse.json()) as Readonly<{
					kind: string;
					payload: unknown;
				}>;
				expect(rawFrame.kind).toBe("result");

				let clientFetches = 0;
				const client = generated.client.createClient({
					baseUrl: "http://runtime.test",
					fetch: (request: Request) => {
						clientFetches += 1;
						return application.fetch(
							internal.bindIngressPrincipalForRequest(request, user),
						);
					},
				});
				const clientResult = await client
					.withContext(context)
					.queries["messages.page"](input);
				expect(clientFetches).toBe(1);
				expect(clientResult).toEqual(direct);
				expect(direct).toEqual({
					nodes: [
						{
							author: null,
							body: "one engine",
							createdAt: new Date("2026-08-15T10:00:00.000Z"),
							id: beta05Ids.message,
						},
					],
					pageInfo: {
						endCursor: expect.any(String),
						hasNextPage: false,
					},
				});
				expect(rawFrame.payload).toEqual({
					...(direct as Readonly<Record<string, unknown>>),
					nodes: [
						{
							author: null,
							body: "one engine",
							createdAt: "2026-08-15T10:00:00.000Z",
							id: beta05Ids.message,
						},
					],
				});
			} finally {
				await application.close();
			}

			await database!`
				delete from questpie_internal.schema_migration_receipts
				where sequence = 2
			`;
			await expect(
				generated.app.createApp({ postgres: { url: beta05PostgresUrl() } }),
			).rejects.toThrow(
				"PostgreSQL migration history does not match Runtime Build",
			);
		} finally {
			await prepared.dispose();
		}
	},
);
