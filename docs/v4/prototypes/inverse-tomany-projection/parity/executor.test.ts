import { expect, test } from "bun:test";

import { inverseListSql } from "../postgres/proof-kernel";
import {
	createLinkedInverseKernel,
	createWatch,
	invokeDirect,
	invokeGeneratedNetworkClient,
} from "./executor";

const rows = [
	{
		root_id: "t1",
		root_title: "first",
		root_ordinal: 1,
		child_id: "c1",
		child_body: "hello",
		child_body_allowed: true,
		child_created_at: 1,
		child_ordinal: 1,
	},
];
const input = { rootFirst: 1, childFirst: 1, resultBytes: 1_048_576 };

test("direct, generated network, and watch enter one linked kernel", () => {
	const kernel = createLinkedInverseKernel();
	expect(kernel.statementSql).toBe(inverseListSql);
	const direct = invokeDirect(kernel, rows, input);
	const network = invokeGeneratedNetworkClient(kernel, rows, input);
	const watch = createWatch(kernel, rows, input).read();
	expect(network).toEqual(direct);
	expect(watch.result).toEqual(direct);
	expect(watch.plan.collections).toContain("collection:comments");
});

test("direct and generated network normalize limits, cancellation, and hostile rows identically", () => {
	const kernel = createLinkedInverseKernel();
	const cases = [
		{
			rows: [rows[0]!, rows[0]!, rows[0]!],
			input,
			expected: { kind: "failure", code: "QUERY_LIMIT" },
		},
		{
			rows: [{ ...rows[0]!, child_ordinal: 2 }],
			input,
			expected: { kind: "failure", code: "INTERNAL" },
		},
	] as const;
	for (const candidate of cases) {
		expect(invokeDirect(kernel, candidate.rows, candidate.input)).toEqual(
			candidate.expected,
		);
		expect(
			invokeGeneratedNetworkClient(kernel, candidate.rows, candidate.input),
		).toEqual(candidate.expected);
	}
	const controller = new AbortController();
	controller.abort(new Error("cancelled"));
	const cancelled = { ...input, signal: controller.signal };
	expect(invokeDirect(kernel, rows, cancelled)).toEqual({
		kind: "failure",
		code: "CANCELLED",
	});
	expect(invokeGeneratedNetworkClient(kernel, rows, cancelled)).toEqual({
		kind: "failure",
		code: "CANCELLED",
	});
});
