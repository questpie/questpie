import { expect, test } from "bun:test";

import { reduceCatalogTableColumns } from "../../packages/compiler/src/schema/postgres/catalog-reader-columns";
import type { CatalogColumnRow } from "../../packages/compiler/src/schema/postgres/catalog-reader-statements";
import type {
	CatalogAccumulator,
	CatalogColumn,
} from "../../packages/compiler/src/schema/postgres/catalog-reader-types";

function state(): CatalogAccumulator {
	return { objects: [], unsupportedObjects: [], dependencies: new Map() };
}

function column(overrides: Partial<CatalogColumnRow> = {}): CatalogColumnRow {
	return {
		table: "messages",
		name: "id",
		type: "uuid",
		typeNamespace: "pg_catalog",
		typeExtension: null,
		typeModifier: null,
		nullable: false,
		defaultExpression: "gen_random_uuid()",
		collation: null,
		collationNamespace: null,
		collationExtension: null,
		identity: "",
		generated: "",
		defaultFunctionName: "gen_random_uuid",
		defaultFunctionNamespace: "pg_catalog",
		defaultFunctionExtension: null,
		...overrides,
	};
}

test("pure column reducer projects one table and all dependencies", () => {
	const accumulator = state();
	const columns = reduceCatalogTableColumns(
		"collaboration",
		{ name: "messages" },
		[
			column(),
			column({
				name: "body",
				type: "text",
				nullable: true,
				defaultExpression: null,
				defaultFunctionName: null,
				defaultFunctionNamespace: null,
				collation: "C",
				collationNamespace: "pg_catalog",
			}),
			column({ table: "other", name: "ignored" }),
		],
		accumulator,
	);

	expect(columns).toEqual<CatalogColumn[]>([
		{ name: "id", nullable: false },
		{ name: "body", nullable: true },
	]);
	expect(accumulator.objects).toEqual([
		{
			kind: "column",
			table: "messages",
			name: "id",
			type: { kind: "uuid" },
			nullable: false,
			default: { kind: "randomUuid" },
			identity: "none",
			generated: "none",
			collation: null,
		},
		{
			kind: "column",
			table: "messages",
			name: "body",
			type: { kind: "text" },
			nullable: true,
			default: null,
			identity: "none",
			generated: "none",
			collation: "pg_catalog.C",
		},
	]);
	expect([...accumulator.dependencies.values()]).toEqual([
		{
			kind: "type",
			schema: "pg_catalog",
			name: "uuid",
			extension: null,
		},
		{
			kind: "defaultFunction",
			schema: "pg_catalog",
			name: "gen_random_uuid",
			extension: null,
		},
		{
			kind: "type",
			schema: "pg_catalog",
			name: "text",
			extension: null,
		},
		{
			kind: "collation",
			schema: "pg_catalog",
			name: "C",
			extension: null,
		},
	]);
});

test("pure column reducer fails unsupported default-function and collation shapes closed", () => {
	const accumulator = state();
	reduceCatalogTableColumns(
		"collaboration",
		{ name: "messages" },
		[
			column({
				name: "forged_default",
				defaultFunctionName: null,
				defaultFunctionNamespace: null,
			}),
			column({
				name: "locale_text",
				type: "text",
				defaultExpression: null,
				defaultFunctionName: null,
				defaultFunctionNamespace: null,
				collation: "en_US",
				collationNamespace: "public",
			}),
		],
		accumulator,
	);

	expect(accumulator.objects).toEqual([]);
	expect(accumulator.unsupportedObjects).toEqual([
		{
			kind: "other",
			qualifiedIdentity: "collaboration.messages.forged_default",
			attachedTo: "collaboration.messages",
		},
		{
			kind: "other",
			qualifiedIdentity: "collaboration.messages.locale_text",
			attachedTo: "collaboration.messages",
		},
	]);
});
