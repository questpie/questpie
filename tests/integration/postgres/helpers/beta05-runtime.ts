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

import type { SQL } from "bun";

import {
	applyCommittedMigrations,
	compileApplication,
	loadCommittedMigration,
} from "@questpie/compiler";

export const beta05Ids = Object.freeze({
	company: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0",
	space: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a1",
	channel: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a2",
	membership: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a3",
	principal: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a4",
	message: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61c1",
});

const beta05FixtureRoot = resolve(
	import.meta.dir,
	"../../../../fixtures/collaboration",
);
const repositoryRoot = resolve(import.meta.dir, "../../../..");

export function beta05PostgresUrl(): string {
	const url = new URL(["postgres:", "//localhost/"].join(""));
	url.hostname = process.env.PGHOST ?? "127.0.0.1";
	url.port = process.env.PGPORT ?? "5432";
	url.username = process.env.PGUSER ?? "postgres";
	url.pathname = `/${process.env.PGDATABASE ?? "postgres"}`;
	if (process.env.PGPASSWORD) url.password = process.env.PGPASSWORD;
	return url.toString();
}

async function relocatedFixture(): Promise<string> {
	const temporary = await mkdtemp(join(tmpdir(), "questpie-beta05-pg-"));
	await cp(beta05FixtureRoot, temporary, { recursive: true });
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
	const generatedRoot = join(temporary, ".questpie/generated");
	const nonce = `?beta05=${crypto.randomUUID()}`;
	const app = await import(
		`${pathToFileURL(join(generatedRoot, "app.ts")).href}${nonce}`
	);
	const client = await import(
		`${pathToFileURL(join(generatedRoot, "client.ts")).href}${nonce}`
	);
	const framework = await import(
		`${pathToFileURL(join(temporary, "node_modules/questpie/index.ts")).href}${nonce}`
	);
	const loadInternal = () =>
		import(
			`${pathToFileURL(join(generatedRoot, "internal/application.js")).href}${nonce}`
		);
	return { app, client, framework, generatedRoot, loadInternal };
}

export async function prepareBeta05PostgresApplication(database: SQL) {
	await database.unsafe(
		'DROP SCHEMA IF EXISTS "collaboration" CASCADE; DROP SCHEMA IF EXISTS questpie_internal CASCADE;',
	);
	const migrations = await Promise.all([
		loadCommittedMigration(
			resolve(
				beta05FixtureRoot,
				"questpie/migrations/000001_create-collaboration",
			),
		),
		loadCommittedMigration(
			resolve(
				beta05FixtureRoot,
				"questpie/migrations/000002_authorize-message-pages",
			),
		),
	]);
	const applied = await applyCommittedMigrations({ migrations });
	if (applied.status !== "applied")
		throw new Error(`failed to apply BETA-05 migrations: ${applied.status}`);
	await database`
		insert into collaboration.companies (id, name)
		values (${beta05Ids.company}, 'Acme')
	`;
	await database`
		insert into collaboration.spaces (id, company_id, name)
		values (${beta05Ids.space}, ${beta05Ids.company}, 'Product')
	`;
	await database`
		insert into collaboration.channels (id, space_id, name)
		values (${beta05Ids.channel}, ${beta05Ids.space}, 'General')
	`;
	await database`
		insert into collaboration.memberships
			(id, company_id, principal_id, role, scope_key, status)
		values
			(${beta05Ids.membership}, ${beta05Ids.company}, ${beta05Ids.principal}, 'admin', 'company', 'active')
	`;
	await database`
		insert into collaboration.messages
			(id, channel_id, author_membership_id, body, created_at)
		values
			(${beta05Ids.message}, ${beta05Ids.channel}, ${beta05Ids.membership}, 'one engine', '2026-08-15T10:00:00.000Z')
	`;
	const temporary = await relocatedFixture();
	try {
		const compilation = await compileApplication({
			applicationRoot: temporary,
		});
		const generated = await importGenerated(temporary);
		const runtimeBuildBytes = await readFile(
			join(generated.generatedRoot, "runtime-build.json"),
			"utf8",
		);
		return Object.freeze({
			compilation,
			generated,
			runtimeBuildBytes,
			dispose: () => rm(temporary, { force: true, recursive: true }),
		});
	} catch (error) {
		await rm(temporary, { force: true, recursive: true });
		throw error;
	}
}
