import { describe, expect, test } from "bun:test";

import dbService from "../../src/server/modules/core/services/db";

describe("db service", () => {
	test("uses custom drizzle client factories without Bun SQL", async () => {
		const schema = { posts: { name: "posts" } };
		const drizzle = { marker: "custom-drizzle" };
		let receivedSchema: unknown;
		let cleanedUp = false;

		const app = {
			config: {
				db: {
					create: ({ schema }: { schema: unknown }) => {
						receivedSchema = schema;
						return {
							drizzle,
							connectionString: "postgres://direct.example/db",
							close: () => {
								cleanedUp = true;
							},
						};
					},
				},
			},
			getSchema: () => schema,
			_pgConnectionString: undefined,
			_dbCleanup: undefined,
		};

		const create = dbService.state.create;
		expect(create).toBeTypeOf("function");

		const result = await create!({ app });

		expect(result).toBe(drizzle);
		expect(receivedSchema).toBe(schema);
		expect(app._pgConnectionString).toBe("postgres://direct.example/db");
		expect(cleanedUp).toBe(false);

		await app._dbCleanup?.();

		expect(cleanedUp).toBe(true);
	});

	test("uses prebuilt custom drizzle clients", async () => {
		const drizzle = { marker: "prebuilt-drizzle" };
		const cleanup = () => {};
		const app = {
			config: {
				db: {
					drizzle,
					connectionString: "postgres://direct.example/db",
					close: cleanup,
				},
			},
			getSchema: () => ({}),
			_pgConnectionString: undefined,
			_dbCleanup: undefined,
		};

		const result = await dbService.state.create!({ app });

		expect(result).toBe(drizzle);
		expect(app._pgConnectionString).toBe("postgres://direct.example/db");
		expect(app._dbCleanup).toBe(cleanup);
	});
});
