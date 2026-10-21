import { expect, test } from "bun:test";

import { queueExecutionIdentity } from "../../src/server/modules/core/integrated/queue/execution-identity.js";

test("execution identity survives credential rotation and URL versus pool configuration", () => {
	const identity = queueExecutionIdentity(
		"pg-boss",
		{ connectionString: "postgres://owner:old@db:5432/work" },
		"jobs",
	);
	expect(
		queueExecutionIdentity(
			"pg-boss",
			{
				connectionString:
					"postgresql://replacement:new@db/work?sslmode=require",
			},
			"jobs",
		),
	).toBe(identity);
	expect(
		queueExecutionIdentity(
			"pg-boss",
			{ host: "db", port: 5432, database: "work" },
			"jobs",
		),
	).toBe(identity);
	expect(identity).not.toContain("owner");
	expect(identity).not.toContain("old");
});

test("execution identity separates brokers, hosts, databases, ports and schemas", () => {
	const options = { connectionString: "postgres://owner:secret@db:5432/work" };
	const identity = queueExecutionIdentity("pg-boss", options, "jobs");
	expect(queueExecutionIdentity("graphile-worker", options, "jobs")).not.toBe(
		identity,
	);
	expect(queueExecutionIdentity("pg-boss", options, "other_jobs")).not.toBe(
		identity,
	);
	for (const target of [
		"postgres://db/other",
		"postgres://other/work",
		"postgres://db:5433/work",
	]) {
		expect(
			queueExecutionIdentity("pg-boss", { connectionString: target }, "jobs"),
		).not.toBe(identity);
	}
});
