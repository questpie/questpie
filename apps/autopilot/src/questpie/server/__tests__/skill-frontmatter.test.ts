import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { scanServerModule } from "../apps/actions-scan";
import { parseInlineManifest } from "../apps/manifest";
import {
	KNOWN_SKILL_TOOLS,
	parseSkillFrontmatter,
	SKILL_DESCRIPTION_MAX,
	SKILL_NAME_MAX,
	SkillFrontmatterError,
} from "../lib/skill-frontmatter";

/** A minimal valid SKILL.md body for a given frontmatter block. */
function doc(frontmatter: string, body = "\n# Body\n\nProcedure here.\n"): string {
	return `---\n${frontmatter}\n---\n${body}`;
}

describe("parseSkillFrontmatter — valid documents", () => {
	it("parses a full published skill (scalars + inline + block arrays)", () => {
		const fm = parseSkillFrontmatter(
			doc(
				[
					"name: make-a-miniapp",
					"description: Build a mini-app inside Autopilot. Use when the user asks to create an automation.",
					"version: 1.0.0",
					"status: published",
					"allowed_tools: [knowledge_read, knowledge_write, run_code]",
					"triggers:",
					"  - create an app",
					"  - build a tool",
					"references:",
					"  - server.template.ts",
				].join("\n"),
			),
		);

		expect(fm.name).toBe("make-a-miniapp");
		expect(fm.description).toContain("Build a mini-app");
		expect(fm.version).toBe("1.0.0");
		expect(fm.status).toBe("published");
		expect(fm.allowed_tools).toEqual(["knowledge_read", "knowledge_write", "run_code"]);
		expect(fm.triggers).toEqual(["create an app", "build a tool"]);
		expect(fm.references).toEqual(["server.template.ts"]);
	});

	it("accepts the minimal required fields (name + description + status)", () => {
		const fm = parseSkillFrontmatter(
			doc("name: ok-skill\ndescription: Does a thing when asked.\nstatus: draft"),
		);
		expect(fm.name).toBe("ok-skill");
		expect(fm.status).toBe("draft");
		expect(fm.allowed_tools).toBeUndefined();
	});

	it("supports quoted scalars and a trailing comment", () => {
		const fm = parseSkillFrontmatter(
			doc(
				[
					'name: "quoted-name"',
					"description: A described skill # inline comment is stripped",
					"status: published",
				].join("\n"),
			),
		);
		expect(fm.name).toBe("quoted-name");
		expect(fm.description).toBe("A described skill");
	});

	it("tolerates a single leading newline before the opening fence", () => {
		const fm = parseSkillFrontmatter(
			`\n---\nname: lead-nl\ndescription: ok\nstatus: published\n---\nbody`,
		);
		expect(fm.name).toBe("lead-nl");
	});

	it("accepts the empty-inline-array form", () => {
		const fm = parseSkillFrontmatter(
			doc("name: empties\ndescription: ok\nstatus: draft\nallowed_tools: []"),
		);
		expect(fm.allowed_tools).toEqual([]);
	});
});

describe("parseSkillFrontmatter — limit enforcement", () => {
	it(`rejects a name over ${SKILL_NAME_MAX} chars`, () => {
		const longName = "a".repeat(SKILL_NAME_MAX + 1);
		expect(() =>
			parseSkillFrontmatter(
				doc(`name: ${longName}\ndescription: ok\nstatus: draft`),
			),
		).toThrow(SkillFrontmatterError);
	});

	it(`rejects a description over ${SKILL_DESCRIPTION_MAX} chars`, () => {
		const longDesc = "x".repeat(SKILL_DESCRIPTION_MAX + 1);
		expect(() =>
			parseSkillFrontmatter(
				doc(`name: ok\ndescription: ${longDesc}\nstatus: draft`),
			),
		).toThrow(/description/);
	});

	it("accepts a name + description exactly at the limit", () => {
		const name = "a".repeat(SKILL_NAME_MAX);
		const desc = "x".repeat(SKILL_DESCRIPTION_MAX);
		const fm = parseSkillFrontmatter(
			doc(`name: ${name}\ndescription: ${desc}\nstatus: published`),
		);
		expect(fm.name.length).toBe(SKILL_NAME_MAX);
		expect(fm.description.length).toBe(SKILL_DESCRIPTION_MAX);
	});

	it("rejects a non-lowercase-hyphen name", () => {
		for (const bad of ["Make_App", "make app", "MakeApp", "-leading", "trailing-"]) {
			expect(() =>
				parseSkillFrontmatter(doc(`name: ${bad}\ndescription: ok\nstatus: draft`)),
			).toThrow(SkillFrontmatterError);
		}
	});

	it("rejects an unknown status", () => {
		expect(() =>
			parseSkillFrontmatter(doc("name: ok\ndescription: ok\nstatus: live")),
		).toThrow(SkillFrontmatterError);
	});

	it("rejects an allowed_tools entry outside the known vocabulary", () => {
		expect(() =>
			parseSkillFrontmatter(
				doc(
					"name: ok\ndescription: ok\nstatus: published\nallowed_tools: [files_read, rm_rf]",
				),
			),
		).toThrow(/unknown tool/);
	});

	it("only admits tools from KNOWN_SKILL_TOOLS (real MCP tool names)", () => {
		// Sanity: the make-a-miniapp tools are all in the vocabulary.
		for (const t of ["knowledge_read", "knowledge_write", "run_code"]) {
			expect(KNOWN_SKILL_TOOLS.has(t)).toBe(true);
		}
		// The old fictional `files_*` tool names are NOT agent-facing MCP tools.
		for (const t of ["files_read", "files_write", "files_list"]) {
			expect(KNOWN_SKILL_TOOLS.has(t)).toBe(false);
		}
	});

	it("rejects an unknown frontmatter key (strict schema, fail-closed)", () => {
		expect(() =>
			parseSkillFrontmatter(
				doc("name: ok\ndescription: ok\nstatus: draft\nroot_access: true"),
			),
		).toThrow(SkillFrontmatterError);
	});
});

describe("parseSkillFrontmatter — malformed input fails closed", () => {
	it("rejects a body with no frontmatter fence", () => {
		expect(() => parseSkillFrontmatter("# Just markdown, no frontmatter")).toThrow(
			/must open with a `---`/,
		);
	});

	it("rejects an unterminated frontmatter block", () => {
		expect(() =>
			parseSkillFrontmatter("---\nname: ok\ndescription: ok\nstatus: draft\n# never closes"),
		).toThrow(/unterminated/);
	});

	it("rejects a prototype-pollution key in the frontmatter", () => {
		for (const bad of ["__proto__", "constructor", "prototype"]) {
			expect(() =>
				parseSkillFrontmatter(
					doc(`name: ok\ndescription: ok\nstatus: draft\n${bad}: x`),
				),
			).toThrow(/forbidden|invalid/);
		}
	});

	it("does not let a quoted __proto__ key reach Object.prototype", () => {
		// Even though the key is rejected, prove no global pollution occurred.
		try {
			parseSkillFrontmatter(
				doc('name: ok\ndescription: ok\nstatus: draft\n"__proto__": polluted'),
			);
		} catch {
			/* expected */
		}
		expect(({} as Record<string, unknown>).polluted).toBeUndefined();
	});

	it("rejects a duplicate frontmatter key", () => {
		expect(() =>
			parseSkillFrontmatter(
				doc("name: ok\ndescription: one\ndescription: two\nstatus: draft"),
			),
		).toThrow(/duplicate/);
	});

	it("rejects tabs in the frontmatter", () => {
		expect(() =>
			parseSkillFrontmatter("---\nname: ok\n\tdescription: ok\nstatus: draft\n---\nx"),
		).toThrow(/tab/);
	});

	it("rejects unexpected indentation at the top level", () => {
		expect(() =>
			parseSkillFrontmatter("---\nname: ok\n  description: ok\nstatus: draft\n---\nx"),
		).toThrow(SkillFrontmatterError);
	});

	it("rejects a YAML anchor / alias (unsupported feature)", () => {
		expect(() =>
			parseSkillFrontmatter(
				doc("name: ok\ndescription: &a anchored\nstatus: draft"),
			),
		).toThrow(/unsupported/);
	});

	it("rejects a nested map value (only flat keys allowed)", () => {
		expect(() =>
			parseSkillFrontmatter(
				doc("name: ok\ndescription: ok\nstatus: draft\ntriggers: { a: 1 }"),
			),
		).toThrow(/nested maps/);
	});

	it("rejects a non-string body", () => {
		expect(() =>
			parseSkillFrontmatter(undefined as unknown as string),
		).toThrow(SkillFrontmatterError);
	});

	it("rejects a missing required field (no description)", () => {
		expect(() =>
			parseSkillFrontmatter(doc("name: ok\nstatus: draft")),
		).toThrow(/description/);
	});
});

describe("the seeded make-a-miniapp SKILL.md validates", () => {
	it("parses the real seed body into the expected published mirror", () => {
		// Read the actual seed source and extract its `SKILL_BODY` template literal,
		// so the artifact we ship is proven to pass the write-time validator (the
		// acceptance criterion "a skill file validates"). The seed escapes backtick
		// and `${` inside the literal — undo those to recover the stored body.
		const seedPath = fileURLToPath(
			new URL("../seeds/make-a-miniapp-skill.seed.ts", import.meta.url),
		);
		const src = readFileSync(seedPath, "utf8");
		const match = src.match(/const SKILL_BODY = `([\s\S]*?)`;\n/);
		expect(match).not.toBeNull();
		const body = (match as RegExpMatchArray)[1]
			.replace(/\\`/g, "`")
			.replace(/\\\$/g, "$");

		const fm = parseSkillFrontmatter(body);
		expect(fm.name).toBe("make-a-miniapp");
		expect(fm.status).toBe("published");
		expect(fm.version).toBe("1.0.0");
		expect(fm.allowed_tools).toEqual(["knowledge_read", "knowledge_write", "run_code"]);
		expect(fm.references).toContain("server.template.ts");
		expect(fm.references).toContain("examples/social-scheduler.md");
		expect(fm.description.length).toBeLessThanOrEqual(SKILL_DESCRIPTION_MAX);
		// Every declared tool is in the known vocabulary (real MCP tool names).
		for (const t of fm.allowed_tools ?? []) {
			expect(KNOWN_SKILL_TOOLS.has(t)).toBe(true);
		}
	});
});

describe("the make-a-miniapp skill teaches the REAL .app API", () => {
	/** Read the seed source once; each test extracts a template/code block. */
	function seedSource(): string {
		const seedPath = fileURLToPath(
			new URL("../seeds/make-a-miniapp-skill.seed.ts", import.meta.url),
		);
		return readFileSync(seedPath, "utf8");
	}

	/** Recover a `const NAME = \`…\`;` template literal's stored text from the seed. */
	function extractTemplate(src: string, name: string): string {
		const m = src.match(new RegExp(`const ${name} = \`([\\s\\S]*?)\`;\\n`));
		expect(m, `template literal ${name} not found`).not.toBeNull();
		return (m as RegExpMatchArray)[1].replace(/\\`/g, "`").replace(/\\\$/g, "$");
	}

	/** Pull the first fenced ```ts … ``` code block out of a markdown string. */
	function firstTsBlock(markdown: string): string {
		const m = markdown.match(/```ts\n([\s\S]*?)```/);
		expect(m, "expected a ```ts code block").not.toBeNull();
		return (m as RegExpMatchArray)[1];
	}

	/**
	 * The generated mini-app code (server.template.ts + the worked example's
	 * server.ts) must NOT instruct an agent to import a non-existent module or call
	 * a non-existent runtime helper. The guest module is loaded INTACT and runs
	 * sandboxed (`mini-app-runner.ts`), so a bare `import { … } from "questpie/…"`
	 * would fail to resolve at load time, and `defineAction` is NOT a runtime symbol
	 * (it is only a STATIC call-shape the resolver's input-schema scanner reads).
	 */
	function assertNoFictionalApi(code: string) {
		// No bare-specifier import from any `questpie` subpath (there is no
		// `questpie/miniapp`; the guest never imports the app).
		expect(code).not.toMatch(/\bimport\b[\s\S]*?from\s*["']questpie\//);
		// No CALL to `defineAction(` (the runtime symbol does not exist).
		expect(code).not.toMatch(/\bdefineAction\s*\(/);
	}

	it("server.template.ts uses plain handlers, no fictional import, and resolves", () => {
		const template = extractTemplate(seedSource(), "SERVER_TEMPLATE");
		assertNoFictionalApi(template);

		// The inline manifest must extract + validate under the REAL resolver path.
		const manifest = parseInlineManifest(template);
		expect(manifest.capabilities).toBeDefined();

		// The opt-in `actions` registry must be a static literal with the expected key.
		const scanned = scanServerModule(template);
		expect(scanned.hasManifestExport).toBe(true);
		expect(scanned.hasActionsExport).toBe(true);
		expect(scanned.actionsIsLiteral).toBe(true);
		expect(scanned.hadSpread).toBe(false);
		expect(scanned.hadComputed).toBe(false);
		expect(scanned.actionKeys).toEqual(["ping"]);
	});

	it("the worked example's server.ts matches the runnable social-scheduler app", () => {
		const example = extractTemplate(seedSource(), "EXAMPLE");
		const code = firstTsBlock(example);
		assertNoFictionalApi(code);

		const manifest = parseInlineManifest(code);
		expect(manifest.name).toBe("Social Scheduler");
		expect(manifest.capabilities.data?.collections?.projects).toEqual(["read"]);

		const scanned = scanServerModule(code);
		expect(scanned.actionsIsLiteral).toBe(true);
		// `status` is the ONLY opt-in action; `cron` is scheduled-only; `readQueue`
		// is an internal helper and is NOT in the registry.
		expect(scanned.actionKeys).toEqual(["status"]);
	});

	it("the SKILL.md body does not reference the questpie/miniapp module", () => {
		const body = extractTemplate(seedSource(), "SKILL_BODY");
		// The body MAY mention that no such module exists (negative guidance); it must
		// never present an `import { … } from "questpie/miniapp"` statement.
		expect(body).not.toMatch(/import\s*\{[^}]*\}\s*from\s*["']questpie\/miniapp["']/);
	});
});
