/** Research only: generated CRUD, real PostgreSQL, at most 100 roots per read.
 * QUESTPIE_PROJECTION_ACCESS_DATABASE_URL=... bun packages/questpie/bench/projection-access-batching-prototype.ts
 * Creates a unique scratch schema and drops it in finally. No framework edits.
 */
import assert from "node:assert/strict";

import { getTableColumns, getTableName } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

import { collection } from "../src/exports/index.js";

type Mode = "A" | "B" | "C" | "D";
type Evaluation = {
	mode: Mode;
	context: any;
	facts: ReadonlySet<string>;
	callbacks: { root: number; relation: number; grant: number; field: number };
};

const source = process.env.QUESTPIE_PROJECTION_ACCESS_DATABASE_URL;
if (!source) throw new Error("Supply the disposable PostgreSQL URL explicitly");
const schema = `projection_access_${crypto.randomUUID().replaceAll("-", "")}`;
const client = new pg.Client({ connectionString: source });
const statements: string[] = [];
const app: any = { collections: {} };
const tables: Record<string, any> = {};
const expectedPrincipal = (ordinal: number) => (ordinal % 2 ? "alice" : "bob");
const db = drizzle({
	client,
	logger: { logQuery: (statement: string) => statements.push(statement) },
});

const owners = collection("pa_owners")
	.fields(({ f }: any) => ({
		tenant: f.text(),
		name: f.text(),
		visible: f.boolean(),
	}))
	.access({
		read: ({ session, evaluation }: any) => {
			evaluation.callbacks.relation++;
			return session ? { tenant: session.user.tenant, visible: true } : false;
		},
		create: false,
		update: false,
		delete: false,
	});
const grants = collection("pa_grants")
	.fields(({ f }: any) => ({
		tenant: f.text(),
		principal: f.text(),
		rootId: f.text(),
		ordinal: f.number(),
	}))
	.access({
		read: ({ session, evaluation }: any) => {
			evaluation.callbacks.grant++;
			return session
				? { tenant: session.user.tenant, principal: session.user.id }
				: false;
		},
		create: false,
		update: false,
		delete: false,
	});
const roots = collection("pa_roots")
	.fields(({ f }: any) => ({
		tenant: f.text(),
		ordinal: f.number(),
		title: f.text(),
		secret: f.text(),
		owner: f.relation("pa_owners"),
	}))
	.access({
		read: ({ session, evaluation }: any) => {
			evaluation.callbacks.root++;
			return session ? { tenant: session.user.tenant } : false;
		},
		create: false,
		update: false,
		delete: false,
		fields: {
			secret: {
				read: ({ doc, user, evaluation }: any) => {
					const ev = evaluation as Evaluation;
					ev.callbacks.field++;
					if (ev.mode === "C") {
						return app.collections.pa_grants
							.findOne({ where: { rootId: doc.id } }, ev.context)
							.then(Boolean);
					}
					if (ev.mode === "D") return ev.facts.has(doc.id);
					// Pure control decision agrees with the seeded grant facts.
					return expectedPrincipal(doc.ordinal) === user.id;
				},
			},
		},
	} as any);

function sqlCounts() {
	const result = {
		data: 0,
		count: 0,
		acl: 0,
		other: 0,
		total: statements.length,
	};
	for (const statement of statements) {
		if (/"pa_grants"/i.test(statement)) result.acl++;
		else if (/\bcount\s*\(/i.test(statement)) result.count++;
		else if (/^select\b/i.test(statement)) result.data++;
		else result.other++;
	}
	assert.equal(
		result.total,
		result.data + result.count + result.acl + result.other,
	);
	return result;
}

const ids = Array.from({ length: 100 }, () => ({
	root: crypto.randomUUID(),
	owner: crypto.randomUUID(),
	grant: crypto.randomUUID(),
}));

async function evaluate(
	mode: Mode,
	size: number,
	principal: string,
	tenant: string,
) {
	const ev: Evaluation = {
		mode,
		context: undefined,
		facts: new Set(),
		callbacks: { root: 0, relation: 0, grant: 0, field: 0 },
	};
	ev.context = {
		accessMode: "user",
		locale: "en",
		defaultLocale: "en",
		session: {
			user: { id: principal, tenant },
			session: { id: `${tenant}:${principal}` },
		},
		"~contextExtensions": { evaluation: ev },
	};
	statements.length = 0;
	if (mode === "D") {
		// Fresh facts per evaluation/principal, bounded by the same request range.
		// No field callback needs I/O after this acquisition.
		const facts = await app.collections.pa_grants.findRows(
			{ where: { ordinal: { lte: size } }, limit: 100 },
			ev.context,
		);
		ev.facts = new Set(facts.map((fact: any) => fact.rootId));
	}
	const page = await app.collections.pa_roots.find(
		{
			where: { ordinal: { lte: size } },
			limit: size,
			orderBy: { ordinal: "asc" },
			...(mode === "A" ? {} : { with: { owner: true } }),
		},
		ev.context,
	);
	if (mode === "A") {
		for (const row of page.docs) {
			row.owner = await app.collections.pa_owners.findOne(
				{ where: { id: row.owner } },
				ev.context,
			);
		}
	}
	assert.equal(page.docs.length, tenant === "alpha" ? size : 0);
	assert.equal(page.totalDocs, tenant === "alpha" ? size : 0);
	for (const row of page.docs) {
		assert.equal(row.tenant, "alpha");
		assert.equal(
			Object.hasOwn(row, "secret"),
			expectedPrincipal(row.ordinal) === principal,
		);
		if (Object.hasOwn(row, "secret"))
			assert.equal(row.secret, `secret-${row.ordinal}`);
		if (row.ordinal % 10 === 0 || row.ordinal % 10 === 9) {
			assert.equal(
				row.owner,
				null,
				"Foreign-tenant and hidden relations must stay null",
			);
		} else {
			assert.equal(row.owner.tenant, "alpha");
			assert.equal(row.owner.visible, true);
			assert.equal(row.owner.name, `owner-${row.ordinal}`);
		}
	}
	const canonical = page.docs.map((row: any) => ({
		id: row.id,
		owner: row.owner?.id ?? null,
		secret: row.secret ?? null,
	}));
	const sql = sqlCounts();
	assert.equal(sql.other, 0, "Every measured statement must be classified");
	if (tenant === "alpha") {
		assert.equal(sql.total, { A: size + 2, B: 4, C: size + 4, D: 5 }[mode]);
		assert.equal(ev.callbacks.root, 1);
		assert.equal(ev.callbacks.relation, mode === "A" ? size : 1);
		assert.equal(ev.callbacks.field, size);
		assert.equal(
			ev.callbacks.grant,
			mode === "C" ? size : mode === "D" ? 1 : 0,
		);
	}
	return {
		mode,
		roots: size,
		principal,
		tenant,
		returned: page.docs.length,
		hiddenRelations: page.docs.filter((row: any) => row.owner === null).length,
		visibleSecrets: page.docs.filter((row: any) => Object.hasOwn(row, "secret"))
			.length,
		sql,
		callbacks: ev.callbacks,
		canonical,
	};
}

await client.connect();
try {
	const version = (await client.query("SHOW server_version")).rows[0]
		.server_version;
	await client.query(`CREATE SCHEMA "${schema}"`);
	await client.query(`SET search_path TO "${schema}"`);
	for (const builder of [owners, grants, roots]) {
		const built: any = builder.build();
		const columns = Object.values(getTableColumns(built.table)).map(
			(column: any) => `"${column.name}" ${column.getSQLType()}`,
		);
		await client.query(
			`CREATE TABLE "${getTableName(built.table)}" (${columns.join(", ")})`,
		);
		tables[built.state.name] = built.table;
		app.collections[built.state.name] = built.generateCRUD(db, app);
	}
	// Fixture writes only: all measured reads use generated CRUD in user mode.
	await db.insert(tables.pa_owners).values(
		ids.map((id, index) => ({
			id: id.owner,
			name: `owner-${index + 1}`,
			tenant: (index + 1) % 10 === 0 ? "beta" : "alpha",
			visible: (index + 1) % 10 !== 9,
		})),
	);
	await db.insert(tables.pa_roots).values(
		ids.map((id, index) => ({
			id: id.root,
			tenant: "alpha",
			ordinal: index + 1,
			title: `root-${index + 1}`,
			secret: `secret-${index + 1}`,
			owner: id.owner,
		})),
	);
	await db.insert(tables.pa_grants).values(
		ids.map((id, index) => ({
			id: id.grant,
			tenant: "alpha",
			ordinal: index + 1,
			rootId: id.root,
			principal: expectedPrincipal(index + 1),
		})),
	);
	const results = [];
	for (const size of [10, 50, 100]) {
		for (const [principal, tenant] of [
			["alice", "alpha"],
			["bob", "alpha"],
			["alice", "beta"],
		]) {
			let expected: unknown;
			for (const mode of ["A", "B", "C", "D"] as const) {
				const { canonical, ...result } = await evaluate(
					mode,
					size,
					principal!,
					tenant!,
				);
				if (expected === undefined) expected = canonical;
				else
					assert.deepEqual(
						canonical,
						expected,
						"All four cases must preserve disclosure",
					);
				results.push(result);
			}
		}
	}
	console.log(
		JSON.stringify(
			{
				postgres: version,
				bun: Bun.version,
				schema,
				seedRowsPerTable: 100,
				measurement:
					"All Drizzle SQL during each evaluation; setup/cleanup excluded; no timing claim",
				cases: {
					A: "manual relation reads",
					B: "with batched relations",
					C: "with + per-row SQL field ACL",
					D: "with + fresh batched facts and pure field ACL",
				},
				assertions:
					"36 evaluations: equal results; tenant, relation and principal isolation",
				results,
			},
			null,
			2,
		),
	);
} finally {
	try {
		await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
		const remaining = await client.query(
			"SELECT 1 FROM pg_namespace WHERE nspname = $1",
			[schema],
		);
		assert.equal(remaining.rowCount, 0, "Scratch schema must be removed");
	} finally {
		await client.end();
	}
}
