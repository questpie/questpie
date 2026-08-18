/**
 * Reads a live PostgreSQL catalog and emits an internal-protocol catalog
 * module, or a snapshot to diff a later version against.
 *
 * The catalog modules were transcribed by hand, which is why nothing in the
 * tree could reproduce or check them. This runs the same queries
 * `verifyInternalProtocolCatalog` runs and emits the exact shape it consumes.
 *
 * A catalog module holds the DELTA a protocol version adds over its
 * predecessor, not the whole schema, so emitting one needs a snapshot of the
 * base taken before the upgrade:
 *
 *   # with the base version installed
 *   bun run scripts/internal-protocol-catalog.ts --snapshot v4.json
 *   # apply the upgrade, then
 *   bun run scripts/internal-protocol-catalog.ts --emit 5 --base v4.json
 *
 * Prove it before trusting it: regenerating an existing version from the right
 * base must reproduce the committed module byte for byte (--check).
 */
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

const argv = Bun.argv.slice(2);
function flag(name: string): string | undefined {
	const index = argv.indexOf(`--${name}`);
	return index === -1 ? undefined : argv[index + 1];
}

async function readCatalog(): Promise<Snapshot> {
	const sql = new SQL({ max: 1 });
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
	await sql.close();
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
}

const snapshotPath = flag("snapshot");
if (snapshotPath) {
	await Bun.write(snapshotPath, JSON.stringify(await readCatalog(), null, 2));
	console.log(`wrote snapshot ${snapshotPath}`);
	process.exit(0);
}

const version = flag("emit");
const basePath = flag("base");
if (!version || !basePath) {
	console.error(
		"require --emit <version> --base <snapshot>, or --snapshot <file>",
	);
	process.exit(1);
}
const base = JSON.parse(await Bun.file(basePath).text()) as Snapshot;
const live = await readCatalog();

const key = (entry: readonly unknown[], through: number): string =>
	entry.slice(0, through).join(" ");
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
	(entry) => !baseConstraints.has(key(entry, 2)),
);
/** A constraint the base declared that this version redefines or drops. */
const replacedConstraints = base.constraints.filter((entry) => {
	const current = live.constraints.find(
		(candidate) => key(candidate, 2) === key(entry, 2),
	);
	return current === undefined || current[3] !== entry[3];
});

const INDENT = String.fromCharCode(9);
const row = (entries: readonly unknown[]): string =>
	INDENT +
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

const rendered = [
	"/** Generated from a live PostgreSQL catalog after applying `internalProtocolV" +
		version +
		"Sql`. */",
	"",
	block(
		"Tables",
		addedTables.map((name) => INDENT + JSON.stringify(name) + ","),
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

async function formatted(source: string, path: string): Promise<string> {
	// The committed modules are oxfmt output, so compare like for like.
	await Bun.write(path, source);
	Bun.spawnSync(["bunx", "oxfmt", path], {
		stdout: "ignore",
		stderr: "ignore",
	});
	return Bun.file(path).text();
}

const modulePath =
	"packages/compiler/src/schema/postgres/internal-protocol-v" +
	version +
	"-catalog.ts";
if (argv.includes("--check")) {
	const existing = await Bun.file(modulePath).text();
	const scratch = modulePath.replace(/\.ts$/, ".check.ts");
	const candidate = await formatted(rendered, scratch);
	await Bun.file(scratch).delete();
	if (existing === candidate) {
		console.log(`catalog v${version} reproduces the committed module exactly`);
		process.exit(0);
	}
	console.error(`catalog v${version} differs from the committed module`);
	process.exit(1);
}
await formatted(rendered, modulePath);
console.log(`wrote ${modulePath}`);
