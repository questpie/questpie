import { expect, test } from "bun:test";

import { linkPostgresCollectionOperationPlans } from "../../packages/runtime/src/mutation";
import { runtimePostgresProgramFixture } from "../support/beta06-runtime-postgres-program";

const compilation = runtimePostgresProgramFixture();

test("links compiler-owned PostgreSQL get/create plans to Collection Operations", async () => {
	const { artifact, operations } = await compilation;
	const linked = linkPostgresCollectionOperationPlans({ artifact, operations });

	expect(linked.plans.map(({ identity }) => identity)).toEqual([
		"mutation:messageEvents.create",
		"mutation:messages.create",
		"query:channels.get",
		"query:spaces.get",
	]);
	const create = linked.byIdentity.get("mutation:messages.create");
	if (create?.member !== "create") throw new Error("missing create plan");
	expect(create.operation.normalizerProgram).toEqual(create.normalizerProgram);
	expect(create.operation.serverValueProgram).toEqual(
		create.serverValueProgram,
	);
	expect(create.candidatePolicy.freshAfterRowLockWait).toBe(true);
	expect(create.limits).toEqual({
		rows: 100,
		durationMilliseconds: 5_000,
	});

	const get = linked.byIdentity.get("query:channels.get");
	if (get?.member !== "get") throw new Error("missing get plan");
	expect(get.lifecycle.slice(0, 2)).toEqual([
		"keyedRowLock",
		"freshPolicyRead",
	]);
	expect(get.lock.sql).toContain("FOR UPDATE");
	expect(get.read.sql).not.toContain("FOR UPDATE");
});
