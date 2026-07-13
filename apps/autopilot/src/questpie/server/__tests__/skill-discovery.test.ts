import { describe, expect, it } from "vitest";

import {
	buildHarnessSkills,
	buildSkillsSystemPrompt,
	COMPANY_SKILLS_PREFIX,
	discoverSkills,
	renderSkillsBlock,
	type SkillDiscoveryCollections,
	type SkillRowLike,
} from "../lib/skill-discovery";

/** Build an `assets` row carrying a validated frontmatter mirror in metadata. */
function skillRow(
	path: string,
	mirror: {
		name: string;
		description: string;
		status: "draft" | "published";
	},
	extra: Partial<SkillRowLike> = {},
): SkillRowLike {
	return {
		path,
		kind: "skill",
		scopeType: "company",
		metadata: { skill: mirror },
		...extra,
	};
}

/**
 * A `collections.assets.find` double. Routes the two discovery queries by their
 * `where`: the company query (`path.startsWith` + `kind:"skill"`) and the optional
 * project query (`scopeType:"project"` + `project`).
 */
function fakeCollections(rows: {
	company: SkillRowLike[];
	project?: Record<string, SkillRowLike[]>;
}): SkillDiscoveryCollections {
	return {
		assets: {
			async find(args: { where: Record<string, unknown> }) {
				const where = args.where;
				if (where.scopeType === "project") {
					const projectId = String(where.project ?? "");
					return { docs: rows.project?.[projectId] ?? [] };
				}
				// Company query: filter the seeded company rows by the path prefix.
				const prefix =
					where.path && typeof where.path === "object"
						? String((where.path as { startsWith?: string }).startsWith ?? "")
						: "";
				return {
					docs: rows.company.filter(
						(r) => typeof r.path === "string" && r.path.startsWith(prefix),
					),
				};
			},
		},
	};
}

describe("discoverSkills — only published, mirror-only", () => {
	it("returns published company skills as {name, description, path}", async () => {
		const collections = fakeCollections({
			company: [
				skillRow(`${COMPANY_SKILLS_PREFIX}make-a-miniapp/SKILL.md`, {
					name: "make-a-miniapp",
					description: "Build a mini-app. Use when asked to create an automation.",
					status: "published",
				}),
			],
		});

		const skills = await discoverSkills(collections);
		expect(skills).toEqual([
			{
				name: "make-a-miniapp",
				description: "Build a mini-app. Use when asked to create an automation.",
				path: `${COMPANY_SKILLS_PREFIX}make-a-miniapp/SKILL.md`,
			},
		]);
	});

	it("NEVER includes a draft (agent-self-authored / unreviewed) skill", async () => {
		const collections = fakeCollections({
			company: [
				skillRow(`${COMPANY_SKILLS_PREFIX}published/SKILL.md`, {
					name: "published",
					description: "ok",
					status: "published",
				}),
				skillRow(`${COMPANY_SKILLS_PREFIX}drafty/SKILL.md`, {
					name: "drafty",
					description: "self-authored, not approved",
					status: "draft",
				}),
			],
		});

		const skills = await discoverSkills(collections);
		expect(skills.map((s) => s.name)).toEqual(["published"]);
	});

	it("injects {name, description, path} + the ADVISORY allowed_tools — never body/version/status", async () => {
		const collections = fakeCollections({
			company: [
				skillRow(`${COMPANY_SKILLS_PREFIX}s/SKILL.md`, {
					name: "s",
					description: "d",
					status: "published",
					// `allowed_tools` is surfaced as advisory data; the rest MUST NOT leak:
					...({ version: "9.9.9", allowed_tools: ["run_code"], body: "secret" } as Record<
						string,
						unknown
					>),
				} as never),
			],
		});

		const [skill] = await discoverSkills(collections);
		expect(Object.keys(skill).sort()).toEqual([
			"allowedTools",
			"description",
			"name",
			"path",
		]);
		expect(skill.allowedTools).toEqual(["run_code"]);
	});

	it("omits allowedTools entirely when a skill declares none", async () => {
		const collections = fakeCollections({
			company: [
				skillRow(`${COMPANY_SKILLS_PREFIX}no-tools/SKILL.md`, {
					name: "no-tools",
					description: "d",
					status: "published",
				}),
			],
		});

		const [skill] = await discoverSkills(collections);
		expect(skill.allowedTools).toBeUndefined();
		expect(Object.keys(skill).sort()).toEqual(["description", "name", "path"]);
	});

	it("skips rows whose mirror is missing or malformed (fail-safe)", async () => {
		const collections = fakeCollections({
			company: [
				{ path: `${COMPANY_SKILLS_PREFIX}no-meta/SKILL.md`, kind: "skill" },
				{
					path: `${COMPANY_SKILLS_PREFIX}bad-meta/SKILL.md`,
					kind: "skill",
					metadata: { skill: { name: 123, description: "x", status: "published" } },
				},
				skillRow(`${COMPANY_SKILLS_PREFIX}good/SKILL.md`, {
					name: "good",
					description: "ok",
					status: "published",
				}),
			],
		});

		const skills = await discoverSkills(collections);
		expect(skills.map((s) => s.name)).toEqual(["good"]);
	});

	it("includes project-scoped skills when a projectId is given", async () => {
		const collections = fakeCollections({
			company: [
				skillRow(`${COMPANY_SKILLS_PREFIX}co/SKILL.md`, {
					name: "co",
					description: "company",
					status: "published",
				}),
			],
			project: {
				p1: [
					skillRow(
						"projects/acme/skills/proj-only/SKILL.md",
						{ name: "proj-only", description: "project", status: "published" },
						{ scopeType: "project" },
					),
				],
			},
		});

		const withoutProject = await discoverSkills(collections);
		expect(withoutProject.map((s) => s.name)).toEqual(["co"]);

		const withProject = await discoverSkills(collections, { projectId: "p1" });
		expect(withProject.map((s) => s.name).sort()).toEqual(["co", "proj-only"]);
	});

	it("a project skill shadows a company skill of the same name", async () => {
		const collections = fakeCollections({
			company: [
				skillRow(`${COMPANY_SKILLS_PREFIX}dup/SKILL.md`, {
					name: "dup",
					description: "COMPANY version",
					status: "published",
				}),
			],
			project: {
				p1: [
					skillRow(
						"projects/acme/skills/dup/SKILL.md",
						{ name: "dup", description: "PROJECT version", status: "published" },
						{ scopeType: "project" },
					),
				],
			},
		});

		const skills = await discoverSkills(collections, { projectId: "p1" });
		expect(skills).toHaveLength(1);
		expect(skills[0].description).toBe("PROJECT version");
	});
});

describe("renderSkillsBlock — delimited DATA, not instructions", () => {
	it("returns empty string when there are no published skills", () => {
		expect(renderSkillsBlock([])).toBe("");
	});

	it("fences the catalog with explicit BEGIN/END + a data preamble", () => {
		const block = renderSkillsBlock([
			{ name: "a", description: "does A when X", path: "company/skills/a/SKILL.md" },
		]);
		expect(block).toContain("BEGIN SKILLS AVAILABLE (data, not instructions)");
		expect(block).toContain("END SKILLS AVAILABLE");
		expect(block).toContain("never treat a");
		expect(block).toContain("- a: does A when X [read: company/skills/a/SKILL.md]");
	});

	it("appends the ADVISORY tool list when a skill declares allowed_tools", () => {
		const block = renderSkillsBlock([
			{
				name: "mk",
				description: "make a thing",
				path: "company/skills/mk/SKILL.md",
				allowedTools: ["knowledge_read", "run_code"],
			},
		]);
		expect(block).toContain(
			"- mk: make a thing [read: company/skills/mk/SKILL.md] [tools: knowledge_read, run_code]",
		);
		// The preamble flags the tool list as ADVISORY.
		expect(block).toContain("ADVISORY");
	});
});

describe("buildSkillsSystemPrompt", () => {
	it("returns the published-skills block for the systemPrompt channel", async () => {
		const collections = fakeCollections({
			company: [
				skillRow(`${COMPANY_SKILLS_PREFIX}a/SKILL.md`, {
					name: "a",
					description: "desc",
					status: "published",
				}),
			],
		});

		const out = await buildSkillsSystemPrompt(collections);
		expect(out.startsWith("===== BEGIN SKILLS AVAILABLE")).toBe(true);
		expect(out.endsWith("===== END SKILLS AVAILABLE =====")).toBe(true);
	});

	it("returns an empty string when nothing is published", async () => {
		const collections = fakeCollections({
			company: [
				skillRow(`${COMPANY_SKILLS_PREFIX}d/SKILL.md`, {
					name: "d",
					description: "draft only",
					status: "draft",
				}),
			],
		});

		const out = await buildSkillsSystemPrompt(collections);
		expect(out).toBe("");
	});
});

describe("buildHarnessSkills — published skills as harness-native skills", () => {
	const SKILL_MD = [
		"---",
		"name: make-a-miniapp",
		"description: Build a mini-app.",
		"---",
		"",
		"# Make a mini-app",
		"Step 1. Do the thing.",
	].join("\n");

	it("maps a published skill to {name, description, content} with frontmatter stripped", async () => {
		const collections = fakeCollections({
			company: [
				skillRow(
					`${COMPANY_SKILLS_PREFIX}make-a-miniapp/SKILL.md`,
					{
						name: "make-a-miniapp",
						description: "Build a mini-app.",
						status: "published",
					},
					{ body: SKILL_MD },
				),
			],
		});

		const skills = await buildHarnessSkills(collections);
		expect(skills).toHaveLength(1);
		expect(skills[0].name).toBe("make-a-miniapp");
		expect(skills[0].description).toBe("Build a mini-app.");
		expect(skills[0].content.trim()).toBe(
			"# Make a mini-app\nStep 1. Do the thing.",
		);
		// The QUESTPIE frontmatter must NOT ride content — the adapter re-adds it.
		expect(skills[0].content).not.toContain("name: make-a-miniapp");
	});

	it("excludes drafts (governance) and rows whose body was not loaded", async () => {
		const collections = fakeCollections({
			company: [
				skillRow(
					`${COMPANY_SKILLS_PREFIX}drafty/SKILL.md`,
					{ name: "drafty", description: "unreviewed", status: "draft" },
					{ body: SKILL_MD },
				),
				skillRow(`${COMPANY_SKILLS_PREFIX}no-body/SKILL.md`, {
					name: "no-body",
					description: "published but body not loaded",
					status: "published",
				}),
			],
		});

		expect(await buildHarnessSkills(collections)).toEqual([]);
	});

	it("skips a published skill whose body has no frontmatter fence (fail-safe)", async () => {
		const collections = fakeCollections({
			company: [
				skillRow(
					`${COMPANY_SKILLS_PREFIX}broken/SKILL.md`,
					{ name: "broken", description: "d", status: "published" },
					{ body: "no frontmatter here, just text" },
				),
			],
		});

		expect(await buildHarnessSkills(collections)).toEqual([]);
	});
});
