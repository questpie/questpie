import { expect, test } from "bun:test";

import { runNativeQueryCases } from "../support/native-query-client";

test("production adapter uses native Router Query hydration and serializer", async () => {
	const result = await runNativeQueryCases([
		"router-upstream",
		"router-generated-identity",
	]);
	expect(result.tests).toBe(6);
	expect(result.assertions).toBe(38);
}, 120_000);
