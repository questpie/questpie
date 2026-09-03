import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { compileApplication } from "@questpie/compiler";

const fixtureRoot = resolve(import.meta.dir, "../../fixtures/collaboration");

test("publishes one Policy-aware channel detail inverse message list", async () => {
	const compilation = await compileApplication({
		applicationRoot: fixtureRoot,
	});
	const contracts = JSON.parse(
		compilation.generatedFiles["operation-contracts.json"] ?? "null",
	) as {
		operations: readonly Readonly<{
			identity: string;
			output: unknown;
		}>[];
	};
	const detail = contracts.operations.find(
		({ identity }) => identity === "query:channels.detail",
	);
	if (!detail) expect.unreachable();

	expect(JSON.stringify(detail.output)).toContain('"messages"');
	expect(JSON.stringify(detail.output)).toContain('"optional"');

	const projection = JSON.parse(
		compilation.generatedFiles["query-projection.json"] ?? "null",
	) as {
		queries: readonly Readonly<{
			template: Readonly<{
				from: string;
				select: readonly Readonly<{ kind: string; key: string }>[];
			}>;
			templateVersion: number;
		}>[];
	};
	const detailPlan = projection.queries.find(
		({ template }) =>
			template.from === "collection:channels" &&
			template.select.some(
				({ kind, key }) => kind === "inverseList" && key === "messages",
			),
	);

	expect(detailPlan?.templateVersion).toBe(2);

	const declarations = compilation.generatedFiles["client.ts"] ?? "";
	expect(declarations).toContain(
		'"channels.detail": WatchableQueryMethod<Readonly<{ readonly "id": string; }>, Readonly<{ readonly "id": string; readonly "messages": ReadonlyArray<Readonly<{ readonly "authorMembershipId": string; readonly "body"?: string;',
	);
	const watchability = JSON.parse(
		compilation.generatedFiles["query-watchability.json"] ?? "null",
	) as {
		queries: readonly Readonly<{
			query: string;
			watchable: boolean;
			possibleObservationSlots: readonly Readonly<{
				collections?: readonly string[];
				tokens: readonly string[];
			}>[];
		}>[];
	};
	const detailWatch = watchability.queries.find(
		({ query }) => query === "query:channels.detail",
	);
	expect(detailWatch?.watchable).toBe(true);
	expect(
		detailWatch?.possibleObservationSlots.some(
			({ collections, tokens }) =>
				collections?.includes("collection:messages") === true &&
				tokens.includes("orderingBoundary") &&
				tokens.includes("policyEvidencePoint") &&
				tokens.includes("relationMiss"),
		),
	).toBe(true);
});

test("executes the Collaboration channel detail through the generated Live Query client", async () => {
	const tracer = await readFile(
		resolve(fixtureRoot, "tracer/client.ts"),
		"utf8",
	);

	expect(tracer).toMatch(
		/client\.queries\["channels\.detail"\]\.observe\(\{\s+id: tracerIds\.channel,/,
	);
	expect(tracer).toContain("let inverseReady = false;");
	expect(tracer).toMatch(
		/!recoveryMode \|\|\s+connections < 2 \|\|\s+!inverseReady \|\|\s+!messagePageObservedExpected/,
	);
	expect(tracer).toContain('fetch("/__questpie_tracer/complete-recovery")');
});
