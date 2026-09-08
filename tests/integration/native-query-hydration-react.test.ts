import { expect, test } from "bun:test";

import { runNativeQueryCases } from "../support/native-query-client";

test("production generated identity and native Suspense retain their regressions", async () => {
	const result = await runNativeQueryCases([
		"hydration-identity",
		"react-suspense",
	]);
	expect(result.tests).toBe(7);
	expect(result.assertions).toBeGreaterThan(20);
}, 120_000);

test("production public factory interoperates across independent browser bundles", async () => {
	// Bun 1.3.14 misreads an imported neutral module as EISDIR when browser
	// bundling follows the raw-client SSR suite in the same process.
	const result = await runNativeQueryCases(["factory"]);
	expect(result.tests).toBe(4);
	expect(result.assertions).toBe(27);
}, 120_000);

test("production native React DOM lifetime remains isolated from server-mode suites", async () => {
	const result = await runNativeQueryCases(["react-dom"]);
	expect(result.tests).toBe(2);
	expect(result.assertions).toBe(12);
}, 120_000);
