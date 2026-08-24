import { expect, test } from "bun:test";

import { readCatalogSchemaSets } from "../../packages/compiler/src/schema/postgres/catalog-reader-sets";
import {
	catalogColumnsStatement,
	catalogConstraintsStatement,
	catalogIndexesStatement,
	catalogIndexTermsStatement,
	catalogRelationsStatement,
} from "../../packages/compiler/src/schema/postgres/catalog-reader-statements";

test("whole-schema reader executes exactly five fixed descriptors in order", async () => {
	const executions: { text: string; parameters: readonly unknown[] }[] = [];
	const rows = Object.assign([] as (readonly unknown[])[], {
		command: "SELECT",
		count: 0,
	});
	const sql = {
		unsafe(text: string, parameters: readonly unknown[]) {
			executions.push({ text, parameters });
			return { values: async () => rows };
		},
	};

	await expect(
		readCatalogSchemaSets(sql, "application_schema"),
	).resolves.toEqual({
		relations: [],
		columns: [],
		constraints: [],
		indexes: [],
		indexTerms: [],
	});
	const statements = [
		catalogRelationsStatement,
		catalogColumnsStatement,
		catalogConstraintsStatement,
		catalogIndexesStatement,
		catalogIndexTermsStatement,
	];
	expect(executions).toEqual(
		statements.map((statement) => ({
			text: statement.text,
			parameters: statement.parameters("application_schema"),
		})),
	);
	expect(executions).toHaveLength(5);
});

test("whole-schema reader stops at the first malformed descriptor result", async () => {
	let executions = 0;
	const sql = {
		unsafe() {
			executions += 1;
			const rows = Object.assign([] as (readonly unknown[])[], {
				command: executions === 3 ? "UPDATE" : "SELECT",
				count: 0,
			});
			return { values: async () => rows };
		},
	};

	await expect(
		readCatalogSchemaSets(sql, "application_schema"),
	).rejects.toThrow("invalid catalog.constraints result");
	expect(executions).toBe(3);
});
