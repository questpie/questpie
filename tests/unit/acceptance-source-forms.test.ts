import { expect, test } from "bun:test";

import { findAcceptanceGitDiffSecret } from "../../.agents/skills/questpie-v4/scripts/acceptance-packet-secrets";
import { maskAcceptanceSourceForms } from "../../.agents/skills/questpie-v4/scripts/acceptance-source-forms";

const field = "password";

function addedDiff(source: string, path = "web/auth.tsx"): string {
	const lines = source.split("\n");
	return [
		`diff --git a/${path} b/${path}`,
		"--- /dev/null",
		`+++ b/${path}`,
		`@@ -0,0 +1,${lines.length} @@`,
		...lines.map((line) => `+${line}`),
		"",
	].join("\n");
}

test("does not load a source blob when no lowercase password word is present", () => {
	const diff = addedDiff("export const title = 'Support desk';");
	expect(
		maskAcceptanceSourceForms(diff, () => {
			throw new Error("Unnecessary source read");
		}),
	).toBe(diff);
});

test("permits a password reference without admitting calls or literal values", () => {
	const source = `const input = { ${field}: identity.password };`;
	expect(
		findAcceptanceGitDiffSecret(addedDiff(source), () => source),
	).toBeNull();
});

test("permits a typed password parameter only from the exact committed source", () => {
	const source = `async function signIn(${field}: string): Promise<void> {}\n`;
	const diff = [
		"diff --git a/web/auth.tsx b/web/auth.tsx",
		"--- /dev/null",
		"+++ b/web/auth.tsx",
		"@@ -0,0 +1 @@",
		`+${source.trimEnd()}`,
		"",
	].join("\n");
	expect(findAcceptanceGitDiffSecret(diff)).not.toBeNull();
	expect(findAcceptanceGitDiffSecret(diff, () => source)).toBeNull();
});

test("verifies both committed sides of a context line before allowing its source form", () => {
	const source = `async function signIn(${field}: string): Promise<void> {}`;
	const diff = [
		"diff --git a/web/auth.tsx b/web/auth.tsx",
		"--- a/web/auth.tsx",
		"+++ b/web/auth.tsx",
		"@@ -1 +1 @@",
		` ${source}`,
		"",
	].join("\n");
	expect(() =>
		maskAcceptanceSourceForms(diff, (_path, side) =>
			side === "base" ? "different base source" : source,
		),
	).toThrow("source line mismatch");
});

test.each([
	["yaml", `${field}: identity.password`, "auth.yaml"],
	["comment", `// ${field}: identity.password`, "auth.ts"],
	["string", `const prose = "${field}: identity.password";`, "auth.ts"],
	["call", `const input = { ${field}: identity.password() };`, "auth.ts"],
	[
		"fallback",
		`const input = { ${field}: identity.password ?? other.password };`,
		"auth.ts",
	],
	["optional", `const input = { ${field}: identity?.password };`, "auth.ts"],
	["computed", `const input = { ${field}: identity["password"] };`, "auth.ts"],
	[
		"optional ancestor",
		`const input = { ${field}: identity?.user.password };`,
		"auth.ts",
	],
	[
		"invalid source",
		`const input = { ${field}: identity.password }; const = ;`,
		"auth.ts",
	],
])("does not exempt %s source text", (_label, source, path) => {
	expect(
		findAcceptanceGitDiffSecret(addedDiff(source!, path), () => source!),
	).not.toBeNull();
});

test("does not exempt literal credentials, including a typed parameter default", () => {
	const value = ["synthetic", "negative", "only"].join("-");
	for (const source of [
		`async function signIn(${field}: string = ${JSON.stringify(value)}): Promise<void> {}`,
		`const input = { ${field}: ${JSON.stringify(value)} };`,
		`const input = { ${field}: identity.password, ${"clientSecret"}: ${JSON.stringify(value)} };`,
	])
		expect(
			findAcceptanceGitDiffSecret(addedDiff(source), () => source),
		).not.toBeNull();
});

test("preserves every non-key character, UTF-16 width, CRLF and packet bytes", () => {
	const source = `// ž 🐱\r\nconst input = { ${field}: identity.password };\r`;
	const diff = addedDiff(source);
	const before = diff;
	const shadow = maskAcceptanceSourceForms(diff, () => source);
	expect(shadow).toBe(diff.replace("{ password:", "{         :"));
	expect(shadow.length).toBe(diff.length);
	expect(diff).toBe(before);
});

test("reads the base blob for deleted source forms and preserves missing-newline metadata", () => {
	const source = `const input = { ${field}: identity.password };`;
	const diff = [
		"diff --git a/auth.ts b/auth.ts",
		"--- a/auth.ts",
		"+++ /dev/null",
		"@@ -1 +0,0 @@",
		`-${source}`,
		"\\ No newline at end of file",
		"",
	].join("\n");
	const sides: string[] = [];
	expect(
		findAcceptanceGitDiffSecret(diff, (_path, side) => {
			sides.push(side);
			return source;
		}),
	).toBeNull();
	expect(sides).toEqual(["base"]);
	expect(maskAcceptanceSourceForms(diff, () => source)).toContain(
		"\\ No newline at end of file",
	);
});
