import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

const PUBLIC_SKILL = "skills/questpie";
const PUBLIC_GUIDES = "apps/docs/content";
const EXPECTED_PUBLIC_FILES = [
	"SKILL.md",
	"references/application-authoring.md",
	"references/data-policy-and-lifecycle.md",
	"references/jobs-and-observability.md",
	"references/operations-http-openapi-and-mcp.md",
	"references/query-resources-react-and-relations.md",
] as const;
const INTERNAL_POINTERS = [
	".agents/",
	"HANDOFF.md",
	"SPEC.md",
	"CONTEXT.md",
	"docs/adr/",
	"fixtures/",
	"/home/",
] as const;
const ALLOWED_IMPORTS = new Set([
	"#questpie/app",
	"#questpie/client",
	"questpie",
	"questpie/react",
	"questpie-opentelemetry",
]);

function fail(message: string): never {
	throw new Error(`skill check: ${message}`);
}

function filesBelow(root: string, directory = root): string[] {
	return readdirSync(directory, { withFileTypes: true })
		.flatMap((entry) => {
			const path = resolve(directory, entry.name);
			if (entry.isSymbolicLink()) fail(`${relative(root, path)} is a symlink`);
			if (entry.isDirectory()) return filesBelow(root, path);
			if (!entry.isFile())
				fail(`${relative(root, path)} is not a regular file`);
			return [relative(root, path).split(sep).join("/")];
		})
		.sort();
}

function markdownProse(source: string): string {
	let fence: "`" | "~" | null = null;
	return source
		.split("\n")
		.map((line) => {
			const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
			if (marker) {
				const kind = marker[0] as "`" | "~";
				if (fence === null) fence = kind;
				else if (fence === kind) fence = null;
				return "";
			}
			return fence === null ? line : "";
		})
		.join("\n");
}

export function validatePublicQuestpieSkill(
	root = resolve(PUBLIC_SKILL),
): void {
	if (!existsSync(root)) fail(`${PUBLIC_SKILL} is missing`);
	const actualFiles = filesBelow(root);
	if (actualFiles.join("\n") !== [...EXPECTED_PUBLIC_FILES].sort().join("\n"))
		fail(`unexpected public files:\n${actualFiles.join("\n")}`);

	for (const relativePath of actualFiles) {
		const path = resolve(root, relativePath);
		if (!lstatSync(path).isFile()) fail(`${relativePath} is not a file`);
		const source = readFileSync(path, "utf8");
		if (!source.endsWith("\n")) fail(`${relativePath} lacks a final newline`);
		for (const pointer of INTERNAL_POINTERS) {
			if (source.includes(pointer))
				fail(`${relativePath} contains internal pointer ${pointer}`);
		}

		for (const match of markdownProse(source).matchAll(
			/\[[^\]]+\]\(([^)]+)\)/g,
		)) {
			const target = match[1];
			if (target.startsWith("https://")) {
				const url = new URL(target);
				if (
					url.hostname !== "questpie.com" ||
					!url.pathname.startsWith("/docs/v4/") ||
					url.search !== "" ||
					url.hash !== ""
				)
					fail(`${relativePath} has non-versioned public link ${target}`);
				if (!existsSync(resolve(PUBLIC_GUIDES, `${url.pathname.slice(1)}.mdx`)))
					fail(`${relativePath} has missing public guide ${target}`);
				continue;
			}
			if (/^[a-z][a-z0-9+.-]*:/i.test(target))
				fail(`${relativePath} has unsupported link ${target}`);
			const resolved = resolve(path, "..", target);
			const withinRoot = relative(root, resolved);
			if (withinRoot.startsWith(`..${sep}`) || withinRoot === "..")
				fail(`${relativePath} has escaping reference ${target}`);
			if (!existsSync(resolved))
				fail(`${relativePath} has missing reference ${target}`);
		}

		for (const match of source.matchAll(
			/from\s+["']([^"']+)["']|import\s+["']([^"']+)["']/g,
		)) {
			const specifier = match[1] ?? match[2];
			if (!specifier.startsWith(".") && !ALLOWED_IMPORTS.has(specifier))
				fail(`${relativePath} imports unsupported package ${specifier}`);
		}
	}
}

function validateFormat(skill: string): void {
	const result = Bun.spawnSync(
		["bun", "node_modules/skills-ref/dist/cli.js", "validate", skill],
		{ stderr: "inherit", stdout: "inherit" },
	);
	if (result.exitCode !== 0) fail(`${skill} failed skills-ref validation`);
}

if (import.meta.main) {
	validateFormat(".agents/skills/questpie-v4");
	validateFormat(PUBLIC_SKILL);
	validatePublicQuestpieSkill();
	console.log("skill check: contributor and portable public skills are valid");
}
