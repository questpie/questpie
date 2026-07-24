import { describe, expect, it } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	createCrdtManifestDeclarations,
	writeCrdtManifestFile,
} from "../../../src/cli/commands/crdt-manifest.js";
import { createDeterministicTextEngine } from "../../../src/server/modules/core/integrated/crdt/deterministic-engine.js";

describe("questpie crdt:manifest", () => {
	it("atomically writes a deterministic artifact and leaves no diff on rerun", async () => {
		const rootDir = await mkdtemp(join(tmpdir(), "questpie-crdt-manifest-"));
		try {
			const ids = uuidSequence();
			const declarations = [
				{
					owner: {
						kind: 1 as const,
						key: "articles",
						identityVersion: 1,
					},
					fields: {
						title: contract("text"),
						tags: contract("set"),
					},
				},
			];
			const first = await writeCrdtManifestFile({
				rootDir,
				namespace: "acme-cms",
				declarations,
				createStableFieldId: ids.next,
			});
			const bytes = await readFile(first.path, "utf8");
			const second = await writeCrdtManifestFile({
				rootDir,
				namespace: "acme-cms",
				declarations: declarations.toReversed(),
				createStableFieldId: ids.next,
			});

			expect(first.changed).toBe(true);
			expect(second.changed).toBe(false);
			expect(await readFile(second.path, "utf8")).toBe(bytes);
			expect(await readdir(rootDir)).toEqual(["crdt.manifest.json"]);
			expect(ids.count()).toBe(2);
		} finally {
			await rm(rootDir, { recursive: true, force: true });
		}
	});

	it("derives collection and global contracts from the registry and engines", () => {
		const declarations = createCrdtManifestDeclarations({
			registry: {
				collections: {
					articlesApi: {
						ownerName: "articles",
						fields: {
							title: { format: "text" },
							tags: { format: "set", conflict: "add-wins" },
						},
					},
				},
				globals: {
					siteSettingsApi: {
						ownerName: "site-settings",
						fields: { content: { format: "text" } },
					},
				},
			},
			config: {
				namespace: "acme-cms",
				engines: { text: createDeterministicTextEngine() },
			},
		});

		expect(
			declarations.map((entry) => [
				entry.owner.kind,
				entry.owner.key,
				Object.keys(entry.fields),
			]),
		).toEqual([
			[1, "articles", ["tags", "title"]],
			[2, "site-settings", ["content"]],
		]);
		expect(declarations[0]?.fields.tags?.engineId).toBe(
			"questpie.deterministic-add-wins-set/v1",
		);
		expect(declarations[0]?.fields.title?.engineId).toBe(
			"questpie.deterministic-text/v1",
		);
	});

	it("requires a text engine only when a registered field uses text", () => {
		expect(() =>
			createCrdtManifestDeclarations({
				registry: {
					collections: {
						articles: {
							ownerName: "articles",
							fields: { title: { format: "text" } },
						},
					},
					globals: {},
				},
				config: { namespace: "acme-cms" },
			}),
		).toThrow("requires a configured text engine");
	});
});

function contract(format: "text" | "set") {
	return {
		format,
		formatVersion: 1,
		engineId: `questpie.test-${format}/v1`,
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
