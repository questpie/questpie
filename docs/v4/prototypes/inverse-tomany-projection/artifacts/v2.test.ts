import { expect, test } from "bun:test";

import { inverseListSql } from "../postgres/proof-kernel";
import {
	linkArtifacts,
	projectArtifacts,
	recursiveV1Vector,
	templateDigest,
	v1Vector,
	v2Vector,
} from "./v2";

const v1Digest =
	"be4ea5622f602349eb0e485fa43ddb42c3f19a3e39d11c57d32fa4aa40473aa9";
const v2Digest =
	"dcec680988639ba61a9e189cb456f61d2f7718c0f1a0bd79eb3a1e2105e9add9";
const recursiveV1Digest =
	"c6046924729230a8b64756017f8e58c56289791d562340a6a0aed813c06b1b8f";

test("v1 stays byte-stable while v2 binds the inverse list", () => {
	expect(templateDigest(v1Vector)).toBe(v1Digest);
	expect(templateDigest(recursiveV1Vector)).toBe(recursiveV1Digest);
	expect(templateDigest(v2Vector)).toBe(v2Digest);
	const v1 = projectArtifacts(v1Vector);
	const v2 = projectArtifacts(v2Vector);
	const recursiveV1 = projectArtifacts(recursiveV1Vector);
	expect(v1.query.version).toBe(1);
	expect(v1.plans.version).toBe(1);
	expect(v2.query.version).toBe(2);
	expect(v2.plans.version).toBe(2);
	expect(recursiveV1.query.version).toBe(1);
	expect(recursiveV1.plans.version).toBe(1);
	expect(v2.plans.plans[0]?.statement?.sql).toBe(inverseListSql);
	expect(v2.plans.plans[0]?.statement?.parameterOrder).toEqual([
		"tenant",
		"afterId",
		"first",
		"childFirst",
	]);
	expect(v2.plans.plans[0]?.statement?.parameterBindings[1]).toEqual({
		name: "afterId",
		source: {
			kind: "decodedCursorOrder",
			parameter: "after",
			field: "collection:tickets/field:id",
			templateDigest: templateDigest(v2Vector),
		},
	});
	expect(v2.appContract).toEqual({
		comments: [
			{ key: "id", optional: false },
			{ key: "body", optional: true },
			{ key: "createdAt", optional: false },
		],
	});
	expect(() => linkArtifacts(v1)).not.toThrow();
	expect(() => linkArtifacts(recursiveV1)).not.toThrow();
	expect(() => linkArtifacts(v2)).not.toThrow();
});

test("readiness rejects forged versions, digests, inverse identity, ordinals, columns, and build binding", () => {
	const original = projectArtifacts(v2Vector);
	const forged = (patch: Readonly<Record<string, unknown>>) =>
		({ ...original, ...patch }) as typeof original;
	expect(() =>
		linkArtifacts(forged({ plans: { ...original.plans, version: 1 } })),
	).toThrow("version mismatch");
	expect(() =>
		linkArtifacts(
			forged({
				query: {
					...original.query,
					queries: [
						{ ...original.query.queries[0]!, templateDigest: "0".repeat(64) },
					],
				},
			}),
		),
	).toThrow("template digest mismatch");
	expect(() =>
		linkArtifacts(
			forged({
				plans: {
					...original.plans,
					plans: [
						{ ...original.plans.plans[0]!, ordinalColumns: ["root_ordinal"] },
					],
				},
			}),
		),
	).toThrow("ordinal columns");
	expect(() =>
		linkArtifacts(
			forged({
				plans: {
					...original.plans,
					plans: [
						{
							...original.plans.plans[0]!,
							resultColumns: [
								...original.plans.plans[0]!.resultColumns,
								"secret",
							],
						},
					],
				},
			}),
		),
	).toThrow("result column");
	expect(() =>
		linkArtifacts(
			forged({
				plans: {
					...original.plans,
					plans: [
						{
							...original.plans.plans[0]!,
							statement: {
								...original.plans.plans[0]!.statement!,
								sql: "SELECT 1",
							},
						},
					],
				},
			}),
		),
	).toThrow("SQL/template mismatch");
	const wrongSource = structuredClone(v2Vector);
	const list = wrongSource.select.find(
		(selection) => selection.kind === "toManyList",
	);
	if (!list || list.kind !== "toManyList") expect.unreachable();
	Object.assign(list, { source: "collection:auditEntries" });
	expect(() => linkArtifacts(projectArtifacts(wrongSource))).toThrow(
		"unresolved inverse list",
	);
	expect(() =>
		linkArtifacts(forged({ runtimeBuildDigest: "f".repeat(64) })),
	).toThrow("Runtime Build digest mismatch");
});
