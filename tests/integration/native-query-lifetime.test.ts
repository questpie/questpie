import { expect, test } from "bun:test";

import { runNativeQueryCases } from "../support/native-query-client";

test("production native lifetime and invalidation preserve the generated consumer contracts", async () => {
	const result = await runNativeQueryCases([
		"generated-client",
		"generated-live",
		"mutation-lifetime",
		"invalidation",
		"query-adapter",
		"userland-optimism",
	]);
	expect(result).toEqual({ tests: 52, assertions: 243 });
}, 120_000);
