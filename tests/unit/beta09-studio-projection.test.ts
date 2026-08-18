import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
	explainRunExecutable,
	projectStudioCatalog,
	projectStudioExplain,
} from "../../apps/studio/src/projection";
import {
	studioExplainDigest,
	studioProjectionDigest,
} from "./helpers/studio-digest";

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

	// A migration carries its source, so the identity is a member rather than
	// the element itself.
	const migrations = catalog.migrations.map((entry) => entry.identity);
	expect(migrations).toContain("000001_create-collaboration");
	expect([...migrations].sort()).toEqual(migrations);
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

/**
 * Criterion 15: a stale build is explained.
 *
 * A run whose executable was retired sits at `ready` with an append-only
 * history that says only `accepted`. The claim refusal writes nothing — it
 * returns from a transaction that has only selected — so the durable log cannot
 * say why the run is not progressing. The only witness is the compiled
 * contract, which is what makes explanation primary rather than decorative.
 *
 * The explanation is a join, so it belongs beside the projection rather than in
 * the kernel: no schema changes, and it works for a run the kernel has already
 * refused without recording anything.
 */
test("a run pinned to a retired executable is explained, not shown as healthy", () => {
	const reactions = artifact("reaction-projection.json");
	const live = JSON.parse(reactions) as {
		reactions: readonly { identity: string; contractDigest: string }[];
	};
	const known = live.reactions[0]!;

	const current = explainRunExecutable(
		{ resource: known.identity, executableDigest: known.contractDigest },
		{ "reaction-projection.json": reactions },
	);
	expect(current.compatible).toBe(true);
	expect(current.reason).toBeNull();

	const retired = explainRunExecutable(
		{ resource: known.identity, executableDigest: "0".repeat(64) },
		{ "reaction-projection.json": reactions },
	);
	expect(retired.compatible).toBe(false);
	// The run pins bytes this build no longer carries, which is why no worker
	// claims it and why its history stops at `accepted`.
	expect(retired.reason).toBe("executableRetired");
	expect(retired.expectedDigest).toBe(known.contractDigest);

	const unknown = explainRunExecutable(
		{ resource: "reaction:removed", executableDigest: known.contractDigest },
		{ "reaction-projection.json": reactions },
	);
	expect(unknown.compatible).toBe(false);
	// A different failure: the Reaction itself is gone from the build, not just
	// its bytes, and an operator needs those told apart.
	expect(unknown.reason).toBe("resourceAbsent");
	expect(unknown.expectedDigest).toBeNull();
});

/**
 * Criterion 7 said `relational-nondisclosure.json` must join the verified set,
 * and the reconciliation recorded it as not built because the artifact is named
 * nowhere in `artifact-files.ts`. That reading was wrong: verification is not
 * per-name. It walks the whole inventory and refuses any file whose bytes do
 * not match, so every artifact is covered by the act of being in the build.
 *
 * Driven against the real generated set rather than a hand-built one. A
 * synthetic inventory kept failing on other preconditions, which is the trap of
 * injecting a construct the production path never produces.
 */
test("tampering with the nondisclosure artifact is refused at startup", async () => {
	const { verifyRuntimeArtifactFiles } =
		await import("../../packages/runtime/src/application/artifact-files");
	const build = JSON.parse(artifact("runtime-build.json")) as {
		inventory: readonly { path: string }[];
	};
	const files = Object.fromEntries(
		build.inventory.map((item) => [item.path, artifact(item.path)]),
	);
	const artifacts = { runtimeBuild: build } as never;

	// The real build verifies as it stands.
	expect(() => verifyRuntimeArtifactFiles(artifacts, files)).not.toThrow();

	// One flipped character in the nondisclosure proof is refused, so it cannot
	// drift from the build that produced it even though nothing reads it.
	const path = "relational-nondisclosure.json";
	expect(files[path]).toContain("outcomeOnly");
	expect(() =>
		verifyRuntimeArtifactFiles(artifacts, {
			...files,
			[path]: files[path]!.replace("outcomeOnly", "outcomeOnlY"),
		}),
	).toThrow(/digest does not match/);
});

/**
 * Criterion 10: every rendered fact carries its source.
 *
 * `freshness-and-provenance.md` decided per-answer provenance over a global
 * freshness header, and named the load-bearing half: **a fact with no source is
 * not rendered.** A catalog whose provenance sat on the container rather than
 * on the fact would satisfy the letter and lose the property, because Studio
 * lifts facts out of the catalog into detail views — and the whole point is
 * that a joined view is never presented as one authoritative record.
 *
 * So the assertion is per fact, not per catalog, and it names the artifact each
 * fact actually came from rather than merely asserting the key exists.
 */
test("every projected fact names the artifact it came from", () => {
	const catalog = projectStudioCatalog(artifacts);

	expect(catalog.resources.length).toBeGreaterThan(0);
	for (const resource of catalog.resources)
		expect(resource.provenance).toEqual({
			source: "artifact",
			artifact: "manifest.json",
		});

	expect(catalog.operations.length).toBeGreaterThan(0);
	for (const operation of catalog.operations)
		expect(operation.provenance).toEqual({
			source: "artifact",
			artifact: "operation-contracts.json",
		});

	expect(catalog.migrations.length).toBeGreaterThan(0);
	for (const migration of catalog.migrations)
		expect(migration.provenance).toEqual({
			source: "artifact",
			artifact: "committed-migrations.json",
		});

	const explain = projectStudioExplain({
		"relational-explain.json": artifact("relational-explain.json"),
		"collection-operation-explain.json": artifact(
			"collection-operation-explain.json",
		),
	});
	expect(explain.policies.length).toBeGreaterThan(0);
	for (const policy of explain.policies)
		expect(policy.provenance).toEqual({
			source: "artifact",
			artifact: "relational-explain.json",
		});

	expect(explain.operations.length).toBeGreaterThan(0);
	for (const operation of explain.operations)
		expect(operation.provenance).toEqual({
			source: "artifact",
			artifact: "collection-operation-explain.json",
		});
});
