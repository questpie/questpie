import { describe, expect, it } from "bun:test";

import {
	resolveCrdtDesiredManifest,
	serializeCrdtManifestArtifact,
	updateCrdtManifestArtifact,
	validateCrdtManifestArtifact,
} from "../../../src/server/modules/core/integrated/crdt/manifest.js";

const owner = {
	kind: 1 as const,
	key: "articles",
	identityVersion: 1,
};

describe("checked-in CRDT owner manifest", () => {
	it("assigns durable identities only through the generator and is no-diff", () => {
		const ids = uuidSequence();
		const first = updateCrdtManifestArtifact({
			namespace: "acme-cms",
			declarations: [declaration(["title", "tags", "content"])],
			createStableFieldId: ids.next,
		});
		const second = updateCrdtManifestArtifact({
			namespace: "acme-cms",
			declarations: [declaration(["content", "tags", "title"])],
			previous: first,
			createStableFieldId: ids.next,
		});

		expect(serializeCrdtManifestArtifact(second)).toBe(
			serializeCrdtManifestArtifact(first),
		);
		expect(ids.count()).toBe(3);
		expect(
			first.owners[0]?.schemas[0]?.fields.map((entry) => entry.sourcePath),
		).toEqual(["content", "tags", "title"]);
		expect(
			first.owners[0]?.schemas[0]?.fields.map((entry) => entry.fieldSlot),
		).toEqual([1, 2, 3]);
	});

	it("preserves IDs and appends one generation for add or explicit rename", () => {
		const ids = uuidSequence();
		const first = updateCrdtManifestArtifact({
			namespace: "acme-cms",
			declarations: [declaration(["title"])],
			createStableFieldId: ids.next,
		});
		const additive = updateCrdtManifestArtifact({
			namespace: "acme-cms",
			declarations: [declaration(["title", "tags"])],
			previous: first,
			createStableFieldId: ids.next,
		});
		const renamed = updateCrdtManifestArtifact({
			namespace: "acme-cms",
			declarations: [declaration(["headline", "tags"])],
			previous: additive,
			renames: [{ owner, from: "title", to: "headline" }],
			createStableFieldId: ids.next,
		});

		const schemas = renamed.owners[0]!.schemas;
		expect(schemas).toHaveLength(3);
		expect(schemas[1]?.predecessorFingerprint).toBe(schemas[0]?.fingerprint);
		expect(schemas[2]?.predecessorFingerprint).toBe(schemas[1]?.fingerprint);
		expect(schemas[2]?.fields[0]).toMatchObject({
			stableFieldId: schemas[0]?.fields[0]?.stableFieldId,
			fieldSlot: schemas[0]?.fields[0]?.fieldSlot,
			sourcePath: "headline",
		});
		expect(schemas[1]?.fields[1]?.fieldSlot).toBe(2);
		expect(ids.count()).toBe(2);
	});

	it("fails closed when runtime declarations are missing, stale, or drifted", () => {
		const artifact = updateCrdtManifestArtifact({
			namespace: "acme-cms",
			declarations: [declaration(["title", "tags"])],
			createStableFieldId: uuidSequence().next,
		});

		expect(() =>
			resolveCrdtDesiredManifest(artifact, declaration(["title"])),
		).toThrow("manifest is stale");
		expect(() =>
			resolveCrdtDesiredManifest(
				artifact,
				declaration(["title", "tags"], {
					title: field("text", "questpie.other-text/v1"),
				}),
			),
		).toThrow("manifest is stale");
		expect(() =>
			resolveCrdtDesiredManifest(artifact, {
				owner: { ...owner, key: "missing" },
				fields: { title: field("text") },
			}),
		).toThrow("manifest is missing owner");
	});

	it("detects hand edits and binds owner, engine, codec, and predecessor", () => {
		const artifact = updateCrdtManifestArtifact({
			namespace: "acme-cms",
			declarations: [declaration(["title"])],
			createStableFieldId: uuidSequence().next,
		});
		const serialized = serializeCrdtManifestArtifact(artifact);
		const tampered = JSON.parse(serialized);
		tampered.owners[0].schemas[0].fields[0].engineVersion = 2;
		expect(() => validateCrdtManifestArtifact(tampered)).toThrow(
			"schema fingerprint is invalid",
		);

		const desired = resolveCrdtDesiredManifest(
			JSON.parse(serialized),
			declaration(["title"]),
		);
		expect(desired.namespace).toBe("acme-cms");
		expect(desired.owner).toEqual(owner);
		expect(desired.version).toBe(1);
		expect(desired.fingerprint).toHaveLength(32);
		expect(desired.fields[0]).toMatchObject({
			engineId: "questpie.test-text/v1",
			engineVersion: 1,
		});
	});

	it("rejects implicit field or owner deletion and incompatible changes", () => {
		const ids = uuidSequence();
		const first = updateCrdtManifestArtifact({
			namespace: "acme-cms",
			declarations: [declaration(["title", "tags"])],
			createStableFieldId: ids.next,
		});
		expect(() =>
			updateCrdtManifestArtifact({
				namespace: "acme-cms",
				declarations: [declaration(["title"])],
				previous: first,
				createStableFieldId: ids.next,
			}),
		).toThrow("explicit generated migration");
		expect(() =>
			updateCrdtManifestArtifact({
				namespace: "acme-cms",
				declarations: [],
				previous: first,
				createStableFieldId: ids.next,
			}),
		).toThrow("owner removal");
		expect(() =>
			updateCrdtManifestArtifact({
				namespace: "acme-cms",
				declarations: [
					declaration(["title", "tags"], {
						title: field("set"),
					}),
				],
				previous: first,
				createStableFieldId: ids.next,
			}),
		).toThrow("field contract change");
	});
});

function declaration(
	paths: readonly string[],
	overrides: Readonly<Record<string, ReturnType<typeof field>>> = {},
) {
	return {
		owner,
		fields: Object.fromEntries(
			paths.map((path) => [
				path,
				overrides[path] ?? field(path === "tags" ? "set" : "text"),
			]),
		),
	};
}

function field(
	format: "text" | "set",
	engineId = `questpie.test-${format}/v1`,
) {
	return {
		format,
		formatVersion: 1,
		engineId,
		engineVersion: 1,
		codecFingerprint: (format === "text" ? "11" : "22").repeat(32),
	};
}

function uuidSequence() {
	let value = 0;
	return {
		next: () =>
			`00000000-0000-4000-8000-${(++value).toString(16).padStart(12, "0")}`,
		count: () => value,
	};
}
