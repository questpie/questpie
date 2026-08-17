import { afterAll, expect, test } from "bun:test";
import { resolve } from "node:path";

import { SQL } from "bun";

import {
	applyCommittedMigrations,
	loadCommittedMigration,
} from "@questpie/compiler";

import { verifyPostgresChangeCapture } from "../../../packages/compiler/src/schema";

const database = process.env.PGHOST ? new SQL({ max: 1 }) : undefined;
const postgresTest = process.env.PGHOST ? test : test.skip;
const fixtureRoot = resolve(import.meta.dir, "../../../fixtures/collaboration");
const ids = Object.freeze({
	company: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0",
	space: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a1",
	channel: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a2",
	membership: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a3",
	principal: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a4",
	message: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a5",
});

afterAll(async () => {
	await database?.unsafe(`DROP SCHEMA IF EXISTS collaboration CASCADE;
DROP SCHEMA IF EXISTS questpie_internal CASCADE;`);
	await database?.close({ timeout: 0 });
});

postgresTest(
	"installs exact Change Ledger capture only through committed migration 000004",
	async () => {
		await database!.unsafe(`DROP SCHEMA IF EXISTS collaboration CASCADE;
DROP SCHEMA IF EXISTS questpie_internal CASCADE;`);
		const migrations = await Promise.all(
			[
				"000001_create-collaboration",
				"000002_authorize-message-pages",
				"000003_publish-message-transaction",
				"000004_watch-message-query",
			].map((name) =>
				loadCommittedMigration(
					resolve(fixtureRoot, "questpie/migrations", name),
				),
			),
		);
		const applied = await applyCommittedMigrations({ migrations });
		expect(applied).toMatchObject({
			status: "applied",
			head: "000004_watch-message-query",
		});
		const capture = migrations.at(-1)!.targetSchema.changeCapture;
		if (!capture)
			throw new Error("committed migration has no capture projection");
		await expect(
			verifyPostgresChangeCapture(database!, capture),
		).resolves.toBeUndefined();

		await database!.begin(async (transaction) => {
			await transaction`
				insert into collaboration.companies (id, name)
				values (${ids.company}, 'Acme')
			`;
			await transaction`
				insert into collaboration.spaces (id, company_id, name)
				values (${ids.space}, ${ids.company}, 'Product')
			`;
			await transaction`
				insert into collaboration.channels (id, space_id, name)
				values (${ids.channel}, ${ids.space}, 'General')
			`;
			await transaction`
				insert into collaboration.memberships
					(id, company_id, principal_id, role, scope_key, status)
				values
					(${ids.membership}, ${ids.company}, ${ids.principal}, 'member', 'company', 'active')
			`;
			await transaction`
				insert into collaboration.messages
					(id, channel_id, author_membership_id, body, created_at)
				values
					(${ids.message}, ${ids.channel}, ${ids.membership}, 'captured by 000004', '2026-08-16T00:00:00.000Z')
			`;
		});
		const facts = await database!<
			{ collection: string; kind: string; newId: string | null }[]
		>`
			select collection_identity as collection, change_kind as kind,
			       new_key->>'id' as "newId"
			from questpie_internal.change_ledger
			where collection_identity = 'collection:messages'
			order by fact_id
		`;
		expect(facts).toEqual([
			{
				collection: "collection:messages",
				kind: "insert",
				newId: ids.message,
			},
		]);
	},
	15_000,
);
