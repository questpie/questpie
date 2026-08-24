import { expect, test } from "bun:test";

import {
	catalogColumnsStatement,
	catalogConstraintsStatement,
	catalogIndexesStatement,
	catalogIndexTermsStatement,
	catalogRelationsStatement,
} from "../../packages/compiler/src/schema/postgres/catalog-reader-statements";

test("catalog statements are fixed whole-schema descriptors", () => {
	for (const statement of [
		catalogRelationsStatement,
		catalogColumnsStatement,
		catalogConstraintsStatement,
		catalogIndexesStatement,
		catalogIndexTermsStatement,
	]) {
		expect(statement.parameterCount).toBe(1);
		expect(statement.parameters("application_schema")).toEqual([
			"application_schema",
		]);
		expect(statement.text).toContain("n.nspname = $1");
		expect(statement.text).not.toMatch(
			/(?:relname|attname|conname)\s*=\s*\$2/u,
		);
		expect(Object.isFrozen(statement)).toBe(true);
	}
});

test("catalog relation decoder closes cardinality and scalar shapes", () => {
	expect(
		catalogRelationsStatement.decode({
			command: "SELECT",
			rowCount: 1,
			rows: [["messages", "r", false, "p", "d", false, false]],
		}),
	).toEqual([
		{
			name: "messages",
			kind: "r",
			inheritanceInvolved: false,
			persistence: "p",
			replicaIdentity: "d",
			rowSecurityEnabled: false,
			rowSecurityForced: false,
		},
	]);

	for (const result of [
		{
			command: "UPDATE",
			rowCount: 1,
			rows: [["messages", "r", false, "p", "d", false, false]],
		},
		{
			command: "SELECT",
			rowCount: 2,
			rows: [["messages", "r", false, "p", "d", false, false]],
		},
		{
			command: "SELECT",
			rowCount: 1,
			rows: [["messages", "r", false, "p", "d", false]],
		},
		{
			command: "SELECT",
			rowCount: 1,
			rows: [["messages", "r", 0, "p", "d", false, false]],
		},
	])
		expect(() => catalogRelationsStatement.decode(result)).toThrow(
			"invalid catalog.relations result",
		);
});

test("catalog decoders reject malformed nested and nullable values", () => {
	expect(() =>
		catalogColumnsStatement.decode({
			command: "SELECT",
			rowCount: 1,
			rows: [
				[
					"messages",
					"id",
					"int4",
					"pg_catalog",
					null,
					null,
					false,
					null,
					null,
					null,
					null,
					"",
					"",
					null,
					null,
					null,
				],
			],
		}),
	).not.toThrow();
	expect(() =>
		catalogConstraintsStatement.decode({
			command: "SELECT",
			rowCount: 1,
			rows: [
				[
					"messages",
					"messages_pk",
					"p",
					["id"],
					null,
					null,
					[],
					"a",
					"a",
					"s",
					0,
					null,
					true,
					false,
					false,
					true,
					false,
					true,
					0,
					false,
				],
			],
		}),
	).not.toThrow();
	expect(() =>
		catalogIndexesStatement.decode({
			command: "SELECT",
			rowCount: 1,
			rows: [
				[
					"messages",
					"messages_id_idx",
					"btree",
					false,
					true,
					true,
					null,
					false,
					1,
					1,
					false,
					false,
					null,
				],
			],
		}),
	).not.toThrow();
	expect(() =>
		catalogIndexTermsStatement.decode({
			command: "SELECT",
			rowCount: 1,
			rows: [
				[
					"messages",
					"messages_id_idx",
					"id",
					"int4_ops",
					"pg_catalog",
					true,
					null,
					null,
					null,
					0,
					1,
				],
			],
		}),
	).not.toThrow();

	expect(() =>
		catalogConstraintsStatement.decode({
			command: "SELECT",
			rowCount: 1,
			rows: [
				[
					"messages",
					"messages_pk",
					"p",
					["id", 1],
					null,
					null,
					[],
					"a",
					"a",
					"s",
					0,
					null,
					true,
					false,
					false,
					true,
					false,
					true,
					0,
					false,
				],
			],
		}),
	).toThrow("invalid catalog.constraints result");
	expect(() =>
		catalogIndexTermsStatement.decode({
			command: "SELECT",
			rowCount: 1,
			rows: [
				[
					"messages",
					"messages_id_idx",
					"id",
					"int4_ops",
					"pg_catalog",
					true,
					null,
					null,
					null,
					0,
					0,
				],
			],
		}),
	).toThrow("invalid catalog.index-terms result");
});
