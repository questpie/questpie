import { describe, expect, it } from "bun:test";

import { surfaceRecognisedPostgresErrors } from "../../../src/server/modules/core/integrated/auth/adapter-postgres-errors.js";

/** The shape Drizzle throws: SQL in the message, the driver error in `cause`. */
function drizzleQueryError(cause: object) {
	return Object.assign(
		new Error('Failed query: select "id" from "oauthResource"'),
		{ cause },
	);
}

function adapterThrowing(error: unknown) {
	const schemaCheckKey = {};
	const adapter = {
		schemaCheckKey,
		findOne: async () => {
			throw error;
		},
	};
	return { adapter, factory: () => adapter };
}

describe("surfaceRecognisedPostgresErrors", () => {
	it("rethrows Bun SQL's undefined-table error, whose SQLSTATE is in errno", async () => {
		// Bun 1.4 reports `code: "ERR_POSTGRES_SERVER_ERROR"` and the SQLSTATE in `errno`.
		const postgres = Object.assign(
			new Error('relation "oauthResource" does not exist'),
			{ code: "ERR_POSTGRES_SERVER_ERROR", errno: "42P01" },
		);
		const { factory } = adapterThrowing(drizzleQueryError(postgres));
		const adapter = surfaceRecognisedPostgresErrors(factory)({});

		await expect(adapter.findOne()).rejects.toBe(postgres);
	});

	it("rethrows node-postgres and PGlite errors, whose SQLSTATE is in code", async () => {
		const postgres = Object.assign(
			new Error(
				'duplicate key value violates unique constraint "oauthResource_identifier"',
			),
			{ code: "23505" },
		);
		const { factory } = adapterThrowing(drizzleQueryError(postgres));
		const adapter = surfaceRecognisedPostgresErrors(factory)({});

		await expect(adapter.findOne()).rejects.toBe(postgres);
	});

	it("keeps Drizzle's error for every other failure", async () => {
		const wrapped = drizzleQueryError(
			Object.assign(new Error("permission denied"), {
				code: "ERR_POSTGRES_SERVER_ERROR",
				errno: "42501",
			}),
		);
		const { factory } = adapterThrowing(wrapped);
		const adapter = surfaceRecognisedPostgresErrors(factory)({});

		await expect(adapter.findOne()).rejects.toBe(wrapped);
	});

	it("returns the same adapter object, so Better Auth's identity-keyed schema check still finds it", () => {
		const { adapter, factory } = adapterThrowing(new Error("unused"));
		expect(surfaceRecognisedPostgresErrors(factory)({})).toBe(adapter);
	});
});
