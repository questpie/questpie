import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
	projectStudioCatalog,
	projectStudioExplain,
	studioExplainDigest,
	studioProjectionDigest,
} from "../../apps/studio/src/projection";

/**
 * BETA-09's first required artifact is an *independent* Studio projection
 * producer. Independent means it derives from the canonical artifact bytes the
 * Runtime already digest-verifies, not from the compiler's in-process objects —
 * otherwise a divergence introduced in one path is invisible to the other and a
 * parity assertion passes while proving nothing.
 *
 * These drive the real compiled fixture artifacts. An earlier revision fed the
 * producer synthetic objects shaped the way the producer expected, which passed
 * while projecting a shape no artifact has: `manifest.json` carries
 * `application.name` and `composition.resources`, not a flat `resources`, and a
 * committed migration is keyed by `identity`, not `name`.
 */
const generated = resolve(
	import.meta.dir,
	"../../fixtures/collaboration/.questpie/generated",
);

function artifact(path: string): string {
	return readFileSync(resolve(generated, path), "utf8");
}

const artifacts = Object.freeze({
	"manifest.json": artifact("manifest.json"),
	"operation-contracts.json": artifact("operation-contracts.json"),
	"committed-migrations.json": artifact("committed-migrations.json"),
});

test("the Studio catalog derives from the real compiled artifact bytes", () => {
	const catalog = projectStudioCatalog(artifacts);
	expect(catalog.application).toBe("collaboration");

	// Every Resource Identity is `<kind>:<name>`, and the kind is what a flat
	// catalog groups by.
	expect(catalog.resources.length).toBeGreaterThan(0);
	const kinds = new Set(catalog.resources.map((entry) => entry.kind));
	expect(kinds.has("collection")).toBe(true);
	expect(kinds.has("reaction")).toBe(true);
	for (const entry of catalog.resources)
		expect(entry.identity.startsWith(`${entry.kind}:`)).toBe(true);

	// The compiled Operation contract carries the server-only Mutation the
	// Reaction calls, so Studio can explain an Operation the wire refuses.
	const operations = catalog.operations.map((entry) => entry.identity);
	expect(operations).toContain("mutation:message.publish");
	expect(operations).toContain("mutation:message.recordDelivery");

	expect(catalog.migrations).toContain("000001_create-collaboration");
	expect([...catalog.migrations].sort()).toEqual([...catalog.migrations]);
});

test("mutating an artifact byte alone changes the projection digest", () => {
	const before = studioProjectionDigest(artifacts);
	const mutated = {
		...artifacts,
		"manifest.json": artifacts["manifest.json"].replace(
			'"collaboration"',
			'"collaboratioN"',
		),
	};
	expect(mutated["manifest.json"]).not.toBe(artifacts["manifest.json"]);
	// This is what makes the producer independent rather than nominally so: the
	// bytes are its only input, so a change in them must move the output.
	expect(studioProjectionDigest(mutated)).not.toBe(before);
});

test("the projection is canonical: input key order cannot change it", () => {
	const reordered = {
		"committed-migrations.json": artifacts["committed-migrations.json"],
		"operation-contracts.json": artifacts["operation-contracts.json"],
		"manifest.json": artifacts["manifest.json"],
	};
	expect(studioProjectionDigest(reordered)).toBe(
		studioProjectionDigest(artifacts),
	);
});

/**
 * The explain lane. `studio-purpose.md` decides the entrance is the compiled
 * contract, and explain artifacts are exactly that: compiler output describing
 * how the application was lowered. They are public contract rather than
 * operational fact, so they carry no disclosure question — which is why this
 * lane is buildable while the operational one is not.
 *
 * Provenance is the point. A Policy or a Collection Operation is only
 * explicable if Studio can say where it came from, so the projection keeps the
 * origin the compiler recorded and drops everything else.
 */
test("the explain projection carries identity and origin from the compiler", () => {
	const explained = projectStudioExplain({
		"relational-explain.json": artifact("relational-explain.json"),
		"collection-operation-explain.json": artifact(
			"collection-operation-explain.json",
		),
	});

	expect(explained.policies.length).toBeGreaterThan(0);
	for (const entry of explained.policies) {
		expect(entry.identity.startsWith("policy:")).toBe(true);
		expect(entry.target.startsWith("collection:")).toBe(true);
	}
	const messagePolicy = explained.policies.find(
		(entry) => entry.identity === "policy:messages.default",
	);
	expect(messagePolicy?.target).toBe("collection:messages");

	expect(explained.operations.length).toBeGreaterThan(0);
	for (const entry of explained.operations)
		expect(entry.identity.length).toBeGreaterThan(0);
});

test("the explain projection is canonical and byte-stable", () => {
	const input = {
		"relational-explain.json": artifact("relational-explain.json"),
		"collection-operation-explain.json": artifact(
			"collection-operation-explain.json",
		),
	};
	expect(studioExplainDigest(input)).toBe(studioExplainDigest({ ...input }));
	const mutated = {
		...input,
		"relational-explain.json": input["relational-explain.json"].replace(
			"policy:messages.default",
			"policy:messages.defaulT",
		),
	};
	expect(studioExplainDigest(mutated)).not.toBe(studioExplainDigest(input));
});
