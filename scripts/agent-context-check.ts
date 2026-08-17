import { existsSync, readFileSync } from "node:fs";

type Branch = "design" | "proof" | "implementation";

const EXPECTED: Record<Branch, string[]> = {
	design: [
		"HANDOFF.md",
		".agents/skills/questpie-v4/SKILL.md",
		".agents/skills/questpie-v4/references/design.md",
		"SPEC.md",
		"CONTEXT.md",
		"docs/adr/README.md",
		"docs/v4/research/framework-api-atlas/DECISION-MAP.md",
	],
	proof: [
		"HANDOFF.md",
		".agents/skills/questpie-v4/SKILL.md",
		".agents/skills/questpie-v4/references/proof.md",
		"docs/v4/research/framework-api-atlas/PROOF-MAP.md",
	],
	implementation: [
		"HANDOFF.md",
		".agents/skills/questpie-v4/SKILL.md",
		".agents/skills/questpie-v4/references/implementation.md",
		"SPEC.md",
		"docs/v4/implementation-gates.md",
	],
};

function fail(message: string): never {
	console.error(`agent context: ${message}`);
	process.exit(1);
}

for (const [branch, paths] of Object.entries(EXPECTED) as Array<
	[Branch, string[]]
>) {
	for (const path of paths) {
		if (!existsSync(path) || readFileSync(path, "utf8").trim() === "")
			fail(`${branch} cannot load ${path}`);
	}
}

const agents = readFileSync("AGENTS.md", "utf8");
const router = readFileSync(".agents/skills/questpie-v4/SKILL.md", "utf8");
const proof = readFileSync(
	".agents/skills/questpie-v4/references/proof.md",
	"utf8",
);
const implementation = readFileSync(
	".agents/skills/questpie-v4/references/implementation.md",
	"utf8",
);
if (
	!agents.includes(".agents/skills/questpie-v4/SKILL.md") ||
	!agents.includes("HANDOFF.md")
)
	fail("root AGENTS does not trigger the router and handoff");
for (const reference of ["design.md", "proof.md", "implementation.md"]) {
	if (!router.includes(reference)) fail(`router does not expose ${reference}`);
}
if (!proof.includes("bun run review:accept"))
	fail("proof branch cannot locate acceptance command");
for (const required of [
	"review:accept:v2",
	"review:accept:verify",
	"NO_RESULT",
]) {
	if (!proof.includes(required))
		fail(`proof branch does not pin acceptance protocol member ${required}`);
}
if (!implementation.includes("bun run check:changed"))
	fail("implementation branch cannot locate TDD command");

console.log(
	"agent context: design, proof, and implementation branches locate authority and commands",
);
