import { expect, test } from "bun:test";
import { resolve } from "node:path";

import { compileApplication } from "@questpie/compiler";

import {
	canonicalBytes,
	contentDigest,
} from "../../packages/compiler/src/canonical";
import { projectRelationalNondisclosure } from "../../packages/compiler/src/relational";

const fixtureRoot = resolve(import.meta.dir, "../../fixtures/collaboration");

test("joins nondisclosure outcomes to exact Policy, Query, and lowering digests", () => {
	const policyProgram = {
		format: "questpie.policy-program",
		version: 1,
		identity: "policy:messages.default",
		target: "collection:messages",
		attachment: { kind: "default", requiredForNormalDataAccess: true },
		operations: {},
	} as const;
	const queryDigest = "a".repeat(64);
	const policyProgramDigest =
		"7606e61481f278e3c16148bfea3fdc2dc0decc87445521177ee9a58315ea5177";
	const plan = {
		format: "questpie.postgres-query-plan",
		version: 1,
		queryDigest,
		templateDigest: queryDigest,
		policy: policyProgram.identity,
		policyProgramDigest,
		nondisclosure: {
			keyedLookup: {
				sql: "SELECT CASE WHEN FALSE THEN 'found' ELSE 'notFound' END AS \"qp_key_outcome\";\n",
				parameters: [{ kind: "key", position: 1, postgresType: "uuid" }],
				keyField: "collection:messages/field:id",
				outcomeColumn: "qp_key_outcome",
			},
		},
	};

	const transcript = projectRelationalNondisclosure({
		policyProjection: {
			format: "questpie.policy-projection",
			version: 1,
			policies: [{ program: policyProgram }],
		},
		queryProjection: {
			format: "questpie.query-projection",
			version: 1,
			queries: [{ digest: queryDigest, policy: policyProgram.identity }],
		},
		postgresQueryPlans: {
			format: "questpie.postgres-query-plans",
			version: 1,
			plans: [plan],
		},
	});

	expect(transcript.queries[0]?.keyedLookup).toEqual({
		proofPlanDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
		keyField: "collection:messages/field:id",
		outcomeColumn: "qp_key_outcome",
		disclosure: "outcomeOnly",
		outcomes: { authorized: "found", unavailable: "notFound" },
	});
	expect(canonicalBytes(transcript)).not.toContain("missingKey");
	expect(canonicalBytes(transcript)).not.toContain("policyInvisibleKey");

	expect(() =>
		projectRelationalNondisclosure({
			policyProjection: {
				format: "questpie.policy-projection",
				version: 1,
				policies: [{ program: policyProgram }],
			},
			queryProjection: {
				format: "questpie.query-projection",
				version: 1,
				queries: [{ digest: queryDigest, policy: policyProgram.identity }],
			},
			postgresQueryPlans: {
				format: "questpie.postgres-query-plans",
				version: 1,
				plans: [{ ...plan, policyProgramDigest: "b".repeat(64) }],
			},
		}),
	).toThrow("does not preserve its Policy digest");
});

test("emits and inventories the exact collaboration nondisclosure transcript", async () => {
	const compilation = await compileApplication({
		applicationRoot: fixtureRoot,
	});
	const bytes = compilation.generatedFiles["relational-nondisclosure.json"];
	if (!bytes) throw new Error("expected relational nondisclosure artifact");
	const checksums = JSON.parse(
		compilation.generatedFiles["internal/checksums.json"] ?? "null",
	) as { files: readonly { path: string; digest: string }[] };

	expect(checksums.files).toContainEqual({
		path: "relational-nondisclosure.json",
		digest: contentDigest(bytes),
	});
	expect(bytes).toMatchSnapshot();
});
