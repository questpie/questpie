import { expect, test } from "bun:test";

import {
	compareFingerprintDependencies,
	compareFingerprintObjects,
} from "../../packages/compiler/src/schema/postgres/fingerprint-order";

test("orders fingerprint records by their frozen physical identities", () => {
	const objects = [
		{ kind: "table", name: "alpha" },
		{ kind: "column", table: "zeta", name: "alpha", default: null },
		{ kind: "column", table: "alpha", name: "zeta", default: "later" },
		{ kind: "column", table: "alpha", name: "alpha", default: "first" },
	].sort(compareFingerprintObjects);
	expect(
		objects.map(({ kind, name, table }) => [kind, table ?? null, name]),
	).toEqual([
		["column", "alpha", "alpha"],
		["column", "alpha", "zeta"],
		["column", "zeta", "alpha"],
		["table", null, "alpha"],
	]);

	const unsupported = [
		{ kind: "view", qualifiedIdentity: "app.alpha", attachedTo: null },
		{ kind: "other", qualifiedIdentity: "app.zeta", attachedTo: "app.table" },
		{ kind: "other", qualifiedIdentity: "app.alpha", attachedTo: "app.table" },
		{ kind: "other", qualifiedIdentity: "app.alpha", attachedTo: null },
	].sort(compareFingerprintObjects);
	expect(
		unsupported.map((item) => [item.qualifiedIdentity, item.attachedTo]),
	).toEqual([
		["app.alpha", null],
		["app.alpha", "app.table"],
		["app.zeta", "app.table"],
		["app.alpha", null],
	]);

	const dependencies = [
		{ kind: "type", schema: "pg_catalog", name: "uuid", extension: null },
		{ kind: "type", schema: "pg_catalog", name: "uuid", extension: "owner" },
		{ kind: "type", schema: "extension", name: "uuid", extension: "owner" },
		{ kind: "collation", schema: "pg_catalog", name: "C", extension: null },
	].sort(compareFingerprintDependencies);
	expect(
		dependencies.map((item) => [
			item.kind,
			item.schema,
			item.name,
			item.extension,
		]),
	).toEqual([
		["collation", "pg_catalog", "C", null],
		["type", "extension", "uuid", "owner"],
		["type", "pg_catalog", "uuid", null],
		["type", "pg_catalog", "uuid", "owner"],
	]);
});
