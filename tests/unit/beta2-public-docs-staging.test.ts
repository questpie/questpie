import { expect, test } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
const docsRoot = resolve(import.meta.dir, "../../apps/docs/content/docs/v4");
const page = (name: string) => readFile(resolve(docsRoot, name), "utf8");

test("navigation separates the cumulative tutorial from API lookup and resolves every public link", async () => {
	const navigation = JSON.parse(await page("meta.json"));
	expect(navigation.root).toBe(true);
	const entries = navigation.pages.filter(
		(name: string) => !name.startsWith("---"),
	);
	const linked: string[] = [];
	for (const name of entries) {
		const meta = Bun.file(resolve(docsRoot, name, "meta.json"));
		if (await meta.exists()) {
			const group = await meta.json();
			expect(group.defaultOpen).toBe(false);
			for (const child of group.pages)
				linked.push(resolve(docsRoot, name, `${child}.mdx`));
		} else linked.push(resolve(docsRoot, `${name}.mdx`));
	}
	expect(entries).toEqual([
		"index",
		"installation",
		"concepts",
		"tutorial",
		"guides",
		"reference",
		"versions",
	]);
	expect(new Set(linked).size).toBe(linked.length);
	const files = (await readdir(docsRoot))
		.filter((name) => name.endsWith(".mdx"))
		.map((name) => resolve(docsRoot, name));
	expect([...linked].sort()).toEqual(files.sort());
	for (const name of (await readdir(docsRoot)).filter((name) =>
		name.endsWith(".mdx"),
	)) {
		const source = await page(name);
		for (const match of source.matchAll(
			/\]\((?:\/docs\/v4\/|\.\/)([a-z0-9-]+)(?:#[^)]+)?\)/gu,
		))
			expect(
				await Bun.file(resolve(docsRoot, `${match[1]}.mdx`)).exists(),
				`${name}: ${match[0]}`,
			).toBe(true);
	}
	const overview = await page("index.mdx");
	for (const target of [
		"installation",
		"schema-lifecycle",
		"clients",
		"auth",
		"uploads",
		"custom-logic",
		"escape-hatches",
		"ecosystem",
		"api-reference",
	])
		expect(overview).toContain(`(/docs/v4/${target})`);
});

test("release documentation targets beta.2 and retains exact package identity", async () => {
	for (const name of [
		"index.mdx",
		"installation.mdx",
		"react-query-basic.mdx",
		"react-query-start.mdx",
		"opentelemetry.mdx",
		"reactive-query-resources.mdx",
		"beta2-release.mdx",
	]) {
		const source = (await page(name)).replace(/\s+/gu, " ");
		expect(source).toContain("4.0.0-beta.2");
		expect(source).not.toContain("not published");
		expect(source).not.toContain("beta.2 preview");
	}
	const inventory = await page("beta2-release.mdx");
	for (const identity of [
		"questpie@4.0.0-beta.2",
		"questpie/react-query",
		"questpie-opentelemetry@4.0.0-beta.2",
	])
		expect(inventory).toContain(identity);
	expect(inventory).not.toContain("`questpie/react`");
});
