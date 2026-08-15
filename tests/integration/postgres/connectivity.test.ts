import { afterAll, expect, test } from "bun:test";

import { SQL } from "bun";

const sql = process.env.PGHOST ? new SQL() : undefined;

afterAll(async () => {
	await sql?.close();
});

test.skipIf(!sql)(
	"the CI PostgreSQL service is an independent durable dependency",
	async () => {
		const [result] = await sql!<{ version: string; value: number }[]>`
		select current_setting('server_version') as version, 1::integer as value
	`;
		expect(result?.value).toBe(1);
		expect(result?.version).toMatch(/^\d+\.\d+/);
		if (process.env.QUESTPIE_POSTGRES_MAJOR)
			expect(result?.version.split(".")[0]).toBe(
				process.env.QUESTPIE_POSTGRES_MAJOR,
			);
	},
);
