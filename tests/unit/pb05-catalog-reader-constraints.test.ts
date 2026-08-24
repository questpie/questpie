import { expect, test } from "bun:test";

import { reduceCatalogTableConstraintsAndIndexes } from "../../packages/compiler/src/schema/postgres/catalog-reader-constraints";
import type {
	CatalogConstraintRow,
	CatalogIndexRow,
	CatalogIndexTermRow,
} from "../../packages/compiler/src/schema/postgres/catalog-reader-statements";
import type {
	CatalogAccumulator,
	CatalogColumn,
} from "../../packages/compiler/src/schema/postgres/catalog-reader-types";

function state(): CatalogAccumulator {
	return { objects: [], unsupportedObjects: [], dependencies: new Map() };
}

const primaryKey: CatalogConstraintRow = {
	table: "messages",
	name: "messages_pk",
	type: "p",
	fields: ["id"],
	referencedTable: null,
	referencedNamespace: null,
	referencedFields: [],
	onDelete: "a",
	onUpdate: "a",
	matchType: "s",
	deleteSetFieldCount: 0,
	definition: null,
	validated: true,
	deferrable: false,
	initiallyDeferred: false,
	enforced: true,
	period: false,
	local: true,
	inheritedCount: 0,
	noInherit: false,
};

function index(overrides: Partial<CatalogIndexRow> = {}): CatalogIndexRow {
	return {
		table: "messages",
		name: "messages_pk",
		method: "btree",
		unique: true,
		valid: true,
		ready: true,
		predicate: null,
		hasExpressions: false,
		keyTermCount: 1,
		totalTermCount: 1,
		nullsNotDistinct: false,
		constraintBacked: true,
		constraintName: "messages_pk",
		...overrides,
	};
}

function term(
	overrides: Partial<CatalogIndexTermRow> = {},
): CatalogIndexTermRow {
	return {
		table: "messages",
		index: "messages_pk",
		field: "id",
		operatorClass: "int4_ops",
		operatorClassNamespace: "pg_catalog",
		operatorClassDefault: true,
		operatorClassExtension: null,
		collation: null,
		collationNamespace: null,
		options: 0,
		position: 1,
		...overrides,
	};
}

test("pure constraint/index reducer preserves supported objects and dependencies", () => {
	const accumulator = state();
	const columns: readonly CatalogColumn[] = [
		{ name: "id", nullable: false },
		{ name: "body", nullable: true },
	];
	reduceCatalogTableConstraintsAndIndexes(
		"collaboration",
		{ name: "messages" },
		columns,
		{
			constraints: [primaryKey],
			indexes: [
				index(),
				index({
					name: "messages_body_idx",
					unique: false,
					constraintBacked: false,
					constraintName: null,
				}),
			],
			indexTerms: [
				term(),
				term({
					table: "other",
					operatorClassDefault: false,
				}),
				term({
					index: "messages_body_idx",
					field: "body",
					operatorClass: "text_ops",
					collation: "C",
					collationNamespace: "pg_catalog",
				}),
			],
		},
		accumulator,
	);

	expect(accumulator.objects).toEqual([
		{
			kind: "primaryKey",
			table: "messages",
			name: "messages_pk",
			fields: ["id"],
			validated: true,
			deferrable: false,
			initiallyDeferred: false,
		},
		{
			kind: "index",
			table: "messages",
			name: "messages_body_idx",
			method: "btree",
			unique: false,
			fields: [
				{
					field: "body",
					order: "asc",
					nulls: "last",
					operatorClass: "typeDefault",
					collation: "field",
				},
			],
			predicate: null,
			valid: true,
			ready: true,
		},
	]);
	expect([...accumulator.dependencies.values()]).toEqual([
		{
			kind: "operatorClass",
			schema: "pg_catalog",
			name: "int4_ops",
			extension: null,
		},
		{
			kind: "operatorClass",
			schema: "pg_catalog",
			name: "text_ops",
			extension: null,
		},
	]);
});

test("pure index reducer rejects orphan terms without cross-table name aliasing", () => {
	const accumulator = state();
	reduceCatalogTableConstraintsAndIndexes(
		"collaboration",
		{ name: "messages" },
		[{ name: "id", nullable: false }],
		{
			constraints: [primaryKey],
			indexes: [index()],
			indexTerms: [term(), term({ index: "orphan_idx" })],
		},
		accumulator,
	);

	expect(accumulator.objects).toHaveLength(1);
	expect(accumulator.unsupportedObjects).toEqual([
		{
			kind: "other",
			qualifiedIdentity: "collaboration.orphan_idx",
			attachedTo: "collaboration.messages",
		},
	]);
});

test("pure index reducer rejects a shuffled complete term set", () => {
	const accumulator = state();
	reduceCatalogTableConstraintsAndIndexes(
		"collaboration",
		{ name: "messages" },
		[
			{ name: "id", nullable: false },
			{ name: "body", nullable: true },
		],
		{
			constraints: [{ ...primaryKey, fields: ["id", "body"] }],
			indexes: [index({ keyTermCount: 2, totalTermCount: 2 })],
			indexTerms: [
				term({ field: "body", position: 2 }),
				term({ field: "id", position: 1 }),
			],
		},
		accumulator,
	);

	expect(accumulator.objects).toEqual([]);
	expect(accumulator.unsupportedObjects).toEqual([
		{
			kind: "other",
			qualifiedIdentity: "collaboration.messages.messages_pk",
			attachedTo: "collaboration.messages",
		},
	]);
});

test("pure index reducer fails missing, duplicate, and reordered terms closed", () => {
	for (const indexTerms of [[], [term(), term()], [term({ position: 2 })]]) {
		const accumulator = state();
		reduceCatalogTableConstraintsAndIndexes(
			"collaboration",
			{ name: "messages" },
			[{ name: "id", nullable: false }],
			{ constraints: [primaryKey], indexes: [index()], indexTerms },
			accumulator,
		);
		expect(accumulator.objects).toEqual([]);
		expect(accumulator.unsupportedObjects).toEqual([
			{
				kind: "other",
				qualifiedIdentity: "collaboration.messages.messages_pk",
				attachedTo: "collaboration.messages",
			},
		]);
	}
});
