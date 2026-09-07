import { expect, test } from "bun:test";

import { parseAcceptanceDiffLines } from "../../.agents/skills/questpie-v4/scripts/acceptance-diff-lines";

test("maps complete ordinary diff sides without changing any bytes", () => {
	const diff = [
		"diff --git a/src/app.ts b/src/app.ts",
		"index 0123..4567 100644",
		"--- a/src/app.ts",
		"+++ b/src/app.ts",
		"@@ -2,2 +2,3 @@ example",
		" context",
		"-old",
		"+new",
		"+extra",
		"",
	].join("\n");
	const parsed = parseAcceptanceDiffLines(diff);
	expect(parsed.map((line) => line.text).join("\n")).toBe(diff);
	expect(parsed.filter((line) => line.path)).toEqual([
		{
			text: " context",
			path: "src/app.ts",
			kind: "context",
			oldLine: 2,
			newLine: 2,
		},
		{ text: "-old", path: "src/app.ts", kind: "removed", oldLine: 3 },
		{ text: "+new", path: "src/app.ts", kind: "added", newLine: 3 },
		{ text: "+extra", path: "src/app.ts", kind: "added", newLine: 4 },
	]);
});

test.each([
	["quoted paths", 'diff --git "a/src/app.ts" "b/src/app.ts"'],
	["traversal", "diff --git a/../app.ts b/../app.ts"],
	["rename", "diff --git a/old.ts b/new.ts"],
	["absolute", "diff --git a//src/app.ts b//src/app.ts"],
	["unicode", "diff --git a/src/é.ts b/src/é.ts"],
])("keeps %s ineligible", (_label, header) => {
	const diff = [
		header,
		"--- a/src/app.ts",
		"+++ b/src/app.ts",
		"@@ -1 +1 @@",
		"-old",
		"+new",
		"",
	].join("\n");
	expect(
		parseAcceptanceDiffLines(diff).every((line) => line.path === undefined),
	).toBe(true);
});

test.each([
	["truncated", ["@@ -1 +1 @@", "-old"]],
	["overflow", ["@@ -1 +1 @@", "-old", "+new", "+extra"]],
	["bad header", ["@@ -0 +1 @@", "-old", "+new"]],
	["unsafe integer", ["@@ -9007199254740992 +1 @@", "-old", "+new"]],
	[
		"unknown metadata",
		["not standard metadata", "@@ -1 +1 @@", "-old", "+new"],
	],
])("does not authorize any line from a %s section", (_label, body) => {
	const diff = [
		"diff --git a/src/app.ts b/src/app.ts",
		"--- a/src/app.ts",
		"+++ b/src/app.ts",
		...body,
		"",
	].join("\n");
	expect(
		parseAcceptanceDiffLines(diff).every((line) => line.path === undefined),
	).toBe(true);
	expect(
		parseAcceptanceDiffLines(diff)
			.map((line) => line.text)
			.join("\n"),
	).toBe(diff);
});
