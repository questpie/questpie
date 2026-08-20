/**
 * Derives an internal-protocol delta module from PostgreSQL's live catalog.
 * `--check` is the trust boundary: the v4 snapshot plus the upgraded v5
 * catalog must reproduce the committed module byte for byte.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SQL } from "bun";

type Snapshot = Readonly<{
	tables: readonly string[];
	columns: readonly (readonly [string, string, string, boolean])[];
	constraints: readonly (readonly [string, string, string, string])[];
	indexes: readonly (readonly [
		string,
		string,
		string,
		boolean,
		boolean,
		string,
	])[];
}>;

const cliArguments = Bun.argv.slice(2);

function flag(name: string): string | undefined {
	const index = cliArguments.indexOf(`--${name}`);
	return index === -1 ? undefined : cliArguments[index + 1];
}

async function readCatalog(): Promise<Snapshot> {
	const sql = new SQL({ max: 1 });
	try {
		const tables = await sql<{ name: string }[]>`
			select c.relname as name
			from pg_catalog.pg_class c
			join pg_catalog.pg_namespace n on n.oid = c.relnamespace
			where n.nspname = 'questpie_internal' and c.relkind = 'r'
			order by c.relname
		`;
		const columns = await sql<
			{ table: string; name: string; type: string; notNull: boolean }[]
		>`
			select c.relname as table, a.attname as name,
			       pg_catalog.format_type(a.atttypid, a.atttypmod) as type,
			       a.attnotnull as "notNull"
			from pg_catalog.pg_attribute a
			join pg_catalog.pg_class c on c.oid = a.attrelid
			join pg_catalog.pg_namespace n on n.oid = c.relnamespace
			where n.nspname = 'questpie_internal' and c.relkind = 'r'
			  and a.attnum > 0 and not a.attisdropped
			order by c.relname, a.attnum
		`;
		const constraints = await sql<
			{ table: string; name: string; type: string; definition: string }[]
		>`
			select c.relname as table, con.conname as name,
			       con.contype::text as type,
			       pg_catalog.pg_get_constraintdef(con.oid, true) as definition
			from pg_catalog.pg_constraint con
			join pg_catalog.pg_class c on c.oid = con.conrelid
			join pg_catalog.pg_namespace n on n.oid = c.relnamespace
			where n.nspname = 'questpie_internal' and con.contype <> 'n'
			order by c.relname, con.conname
		`;
		const indexes = await sql<
			{
				table: string;
				name: string;
				method: string;
				unique: boolean;
				primary: boolean;
				definition: string;
			}[]
		>`
			select t.relname as table, i.relname as name, am.amname as method,
			       x.indisunique as unique, x.indisprimary as primary,
			       pg_catalog.pg_get_indexdef(i.oid) as definition
			from pg_catalog.pg_index x
			join pg_catalog.pg_class i on i.oid = x.indexrelid
			join pg_catalog.pg_class t on t.oid = x.indrelid
			join pg_catalog.pg_namespace n on n.oid = t.relnamespace
			join pg_catalog.pg_am am on am.oid = i.relam
			where n.nspname = 'questpie_internal'
			order by t.relname, i.relname
		`;
		return {
			tables: tables.map((entry) => entry.name),
			columns: columns.map((entry) => [
				entry.table,
				entry.name,
				entry.type,
				entry.notNull,
			]),
			constraints: constraints.map((entry) => [
				entry.table,
				entry.name,
				entry.type,
				entry.definition,
			]),
			indexes: indexes.map((entry) => [
				entry.table,
				entry.name,
				entry.method,
				entry.unique,
				entry.primary,
				entry.definition,
			]),
		};
	} finally {
		await sql.close();
	}
}

const key = (entry: readonly unknown[], through: number): string =>
	entry.slice(0, through).join(" ");

function renderDelta(base: Snapshot, live: Snapshot, version: string): string {
	const baseTables = new Set(base.tables);
	const baseColumns = new Set(base.columns.map((entry) => key(entry, 2)));
	const baseIndexes = new Set(base.indexes.map((entry) => key(entry, 2)));
	const baseConstraints = new Map(
		base.constraints.map((entry) => [key(entry, 2), entry[3]] as const),
	);
	const addedTables = live.tables.filter((name) => !baseTables.has(name));
	const addedColumns = live.columns.filter(
		(entry) => !baseColumns.has(key(entry, 2)),
	);
	const addedIndexes = live.indexes.filter(
		(entry) => !baseIndexes.has(key(entry, 2)),
	);
	const addedConstraints = live.constraints.filter(
		(entry) => baseConstraints.get(key(entry, 2)) !== entry[3],
	);
	const replacedConstraints = base.constraints.filter((entry) => {
		const current = live.constraints.find(
			(candidate) => key(candidate, 2) === key(entry, 2),
		);
		return current === undefined || current[3] !== entry[3];
	});

	const indent = String.fromCharCode(9);
	const row = (entries: readonly unknown[]): string =>
		indent +
		"[" +
		entries.map((entry) => JSON.stringify(entry)).join(", ") +
		"],";
	const block = (name: string, rows: readonly string[]): string =>
		"export const internalProtocolV" +
		version +
		name +
		" = [" +
		(rows.length === 0
			? ""
			: String.fromCharCode(10) + rows.join(String.fromCharCode(10))) +
		String.fromCharCode(10) +
		"] as const;";

	return [
		"/** Generated from a live PostgreSQL catalog after applying `internalProtocolV" +
			version +
			"Sql`. */",
		"",
		block(
			"Tables",
			addedTables.map((name) => indent + JSON.stringify(name) + ","),
		),
		"",
		block("ReplacedConstraints", replacedConstraints.map(row)),
		"",
		block("Columns", addedColumns.map(row)),
		"",
		block("Constraints", addedConstraints.map(row)),
		"",
		block("Indexes", addedIndexes.map(row)),
		"",
	].join(String.fromCharCode(10));
}

async function formatted(source: string, path: string): Promise<string> {
	await Bun.write(path, source);
	const result = Bun.spawnSync(["bunx", "oxfmt", path], {
		stdout: "ignore",
		stderr: "pipe",
	});
	if (result.exitCode !== 0)
		throw new Error(new TextDecoder().decode(result.stderr));
	return Bun.file(path).text();
}

const snapshotPath = flag("snapshot");
if (snapshotPath) {
	await Bun.write(snapshotPath, JSON.stringify(await readCatalog(), null, 2));
	console.log(`wrote snapshot ${snapshotPath}`);
	process.exit(0);
}

const version = flag("emit");
const basePath = flag("base");
if (!version || !/^[1-9]\d*$/.test(version) || !basePath) {
	console.error(
		"require --emit <positive-version> --base <snapshot>, or --snapshot <file>",
	);
	process.exit(1);
}

const base = JSON.parse(await Bun.file(basePath).text()) as Snapshot;
const rendered = renderDelta(base, await readCatalog(), version);
const modulePath = `packages/compiler/src/schema/postgres/internal-protocol-v${version}-catalog.ts`;

if (cliArguments.includes("--check")) {
	const directory = await mkdtemp(join(tmpdir(), "questpie-protocol-catalog-"));
	let matches = false;
	try {
		const existing = await Bun.file(modulePath).text();
		const candidate = await formatted(rendered, join(directory, "catalog.ts"));
		matches = existing === candidate;
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
	if (!matches) {
		console.error(`catalog v${version} differs from the committed module`);
		process.exit(1);
	}
	console.log(`catalog v${version} reproduces the committed module exactly`);
	process.exit(0);
}

await formatted(rendered, modulePath);
console.log(`wrote ${modulePath}`);
