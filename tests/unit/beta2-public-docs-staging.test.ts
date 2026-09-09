import { expect, test } from "bun:test";
import { resolve } from "node:path";

const docsRoot = resolve(import.meta.dir, "../../apps/docs/content/docs/v4");

async function page(name: string): Promise<string> {
	return Bun.file(resolve(docsRoot, name)).text();
}

test("native React Query tutorials are discoverable and retain preview staging", async () => {
	const navigation = await Bun.file(resolve(docsRoot, "meta.json")).json();
	const overview = await page("react-query.mdx");
	for (const name of ["react-query-basic", "react-query-start"]) {
		expect(navigation.pages).toContain(name);
		expect(overview).toContain(`./${name}`);
		const source = (await page(`${name}.mdx`)).replace(/\s+/gu, " ");
		expect(source).toContain("beta.2 preview");
		expect(source).toContain("Beta.2 is not published.");
	}
});

test("public beta.2 guides state version availability and expose the exact preview inventory", async () => {
	const [index, openTelemetry, reactiveQueries, inventory, navigation] =
		await Promise.all([
			page("index.mdx"),
			page("opentelemetry.mdx"),
			page("reactive-query-resources.mdx"),
			page("beta2-release.mdx"),
			Bun.file(resolve(docsRoot, "meta.json")).json() as Promise<{
				pages: string[];
			}>,
		]);

	for (const source of [index, openTelemetry, reactiveQueries, inventory]) {
		const prose = source.replace(/\s+/gu, " ");
		expect(prose).toContain("beta.2 preview");
		expect(prose).toContain("Beta.2 is not published.");
		expect(prose).toContain(
			"[frozen beta.1 inventory](/docs/v4/beta1-release)",
		);
	}

	const overview = index.replace(/\s+/gu, " ");
	expect(overview).toContain(
		"six executable Definition kinds: Query, Mutation, Action, Route, Reaction, and Job",
	);
	expect(overview).not.toContain(
		"three executable Definition kinds: Query, Mutation, and Reaction",
	);
	expect(overview).toContain("[Review the beta.2 preview inventory]");
	expect(navigation.pages).toContain("beta2-release");
	expect(inventory).toContain("`questpie@4.0.0-beta.2`");
	expect(inventory).toContain("`questpie/react-query`");
	expect(inventory).not.toContain("`questpie/react`");
	expect(navigation.pages).toContain("react-query");
	expect(inventory).toContain("`questpie-opentelemetry@4.0.0-beta.2`");
	expect(inventory).not.toContain("`@questpie/react`");
	expect(inventory).not.toContain("`@questpie/opentelemetry`");
});
