import { afterAll, expect, test } from "bun:test";
import {
	cp,
	mkdir,
	mkdtemp,
	readFile,
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

const fixtureRoot = resolve(import.meta.dir, "../../../fixtures/collaboration");
const repositoryRoot = resolve(import.meta.dir, "../../..");
const database = process.env.PGHOST ? new SQL({ max: 1 }) : undefined;

const companyId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0";
const spaceId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a1";
const channelId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a2";
const membershipId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a3";
const principalId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a4";
const messageId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61c1";

function postgresUrl(): string {
	const url = new URL("postgres://localhost/");
	url.hostname = process.env.PGHOST ?? "127.0.0.1";
	url.port = process.env.PGPORT ?? "5432";
	url.username = process.env.PGUSER ?? "postgres";
	url.pathname = `/${process.env.PGDATABASE ?? "postgres"}`;
	if (process.env.PGPASSWORD) url.password = process.env.PGPASSWORD;
	return url.toString();
}

async function relocatedFixture(): Promise<string> {
	const temporary = await mkdtemp(join(tmpdir(), "questpie-beta05-pg-"));
	await cp(fixtureRoot, temporary, { recursive: true });
	await mkdir(join(temporary, "node_modules"), { recursive: true });
	await rm(join(temporary, "node_modules/questpie"), {
		force: true,
		recursive: true,
	});
	await mkdir(join(temporary, "node_modules/questpie"));
	await writeFile(
		join(temporary, "node_modules/questpie/package.json"),
		JSON.stringify({
			name: "questpie",
			type: "module",
			exports: "./index.ts",
		}),
	);
	await symlink(
		resolve(repositoryRoot, "packages/questpie/src/index.ts"),
		join(temporary, "node_modules/questpie/index.ts"),
		"file",
	);
	return temporary;
}

async function importGenerated(temporary: string) {
	const generated = join(temporary, ".questpie/generated");
	const nonce = `?beta05=${crypto.randomUUID()}`;
	const app = await import(
		`${pathToFileURL(join(generated, "app.ts")).href}${nonce}`
	);
	const client = await import(
		`${pathToFileURL(join(generated, "client.ts")).href}${nonce}`
	);
	const internal = await import(
		`${pathToFileURL(join(generated, "internal/application.js")).href}${nonce}`
	);
	const framework = await import(
		`${pathToFileURL(join(temporary, "node_modules/questpie/index.ts")).href}${nonce}`
	);
	return { app, client, framework, generated, internal };
}

afterAll(async () => {
	await database?.close({ timeout: 0 });
});

const postgresTest = process.env.PGHOST ? test : test.skip;

postgresTest(
	"runs the exact Message Query through direct, Fetch, and generated client paths",
	async () => {
		await database!.unsafe(
			'DROP SCHEMA IF EXISTS "collaboration" CASCADE; DROP SCHEMA IF EXISTS questpie_internal CASCADE;',
		);
		const migrations = await Promise.all([
			loadCommittedMigration(
				resolve(fixtureRoot, "questpie/migrations/000001_create-collaboration"),
			),
			loadCommittedMigration(
				resolve(
					fixtureRoot,
					"questpie/migrations/000002_authorize-message-pages",
				),
			),
		]);
		const applied = await applyCommittedMigrations({ migrations });
		expect(applied.status).toBe("applied");
		await database!`
			insert into collaboration.companies (id, name)
			values (${companyId}, 'Acme')
		`;
		await database!`
			insert into collaboration.spaces (id, company_id, name)
			values (${spaceId}, ${companyId}, 'Product')
		`;
		await database!`
			insert into collaboration.channels (id, space_id, name)
			values (${channelId}, ${spaceId}, 'General')
		`;
		await database!`
			insert into collaboration.memberships
				(id, company_id, principal_id, role, scope_key, status)
			values
				(${membershipId}, ${companyId}, ${principalId}, 'admin', 'company', 'active')
		`;
		await database!`
			insert into collaboration.messages
				(id, channel_id, author_membership_id, body, created_at)
			values
				(${messageId}, ${channelId}, ${membershipId}, 'one engine', '2026-08-15T10:00:00.000Z')
		`;

		const temporary = await relocatedFixture();
		try {
			await compileApplication({ applicationRoot: temporary });
			const generated = await importGenerated(temporary);
			const originalRuntimeBuild = await readFile(
				join(generated.generated, "runtime-build.json"),
				"utf8",
			);
			const mismatched = JSON.parse(originalRuntimeBuild);
			mismatched.schemaFingerprint = "0".repeat(64);
			await writeFile(
				join(generated.generated, "runtime-build.json"),
				`${JSON.stringify(mismatched)}\n`,
			);
			await expect(
				generated.app.createApp({ postgres: { url: postgresUrl() } }),
			).rejects.toThrow("Runtime Build digest does not match");
			await writeFile(
				join(generated.generated, "runtime-build.json"),
				originalRuntimeBuild,
			);

			const application = await generated.app.createApp({
				postgres: { url: postgresUrl() },
			});
			try {
				const user = generated.framework.principal.user({ id: principalId });
				const context = { companyId };
				const input = { channelId, first: 20, after: null };
				const direct = await application.execution(
					{ principal: user, context },
					({ queries }: { queries: Record<string, Function> }) =>
						queries["messages.page"]!(input),
				);
				const runtimeBuild = JSON.parse(originalRuntimeBuild);
				const wire = JSON.parse(
					await readFile(
						join(generated.generated, "wire-contract.json"),
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
					generated.internal.bindIngressPrincipalForRequest(rawRequest, user),
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
							generated.internal.bindIngressPrincipalForRequest(request, user),
						);
					},
				});
				const clientResult = await client
					.withContext(context)
					.queries["messages.page"](input);
				expect(clientFetches).toBe(1);
				expect(clientResult).toEqual(direct);
				expect(rawFrame.payload).toEqual(direct);
				expect(direct).toEqual({
					nodes: [
						{
							author: null,
							body: "one engine",
							createdAt: "2026-08-15T10:00:00.000Z",
							id: messageId,
						},
					],
					pageInfo: {
						endCursor: expect.any(String),
						hasNextPage: false,
					},
				});
			} finally {
				await application.close();
			}
		} finally {
			await rm(temporary, { force: true, recursive: true });
		}
	},
);
