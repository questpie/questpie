import { expect, test } from "bun:test";
import { cp, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { InfiniteQueryObserver, QueryClient } from "@tanstack/query-core";

import { compileApplication } from "../../../../packages/compiler/src/index";
import { bindProjection } from "./query-adapter";
import { instrumentClient } from "./render-projection";

test("compiled cursor names drive native pagination without granting page-shaped handlers a paging capability", async () => {
	const temporary = await mkdtemp(
		join(tmpdir(), "questpie-renamed-pagination-"),
	);
	const fixture = join(temporary, "desk");
	const cache = new QueryClient();
	let dispose: (() => Promise<void>) | undefined;
	let observer: InfiniteQueryObserver | undefined;
	try {
		const original = resolve(
			import.meta.dir,
			"../../../../fixtures/team-support-desk",
		);
		await cp(original, fixture, {
			recursive: true,
			filter: (path) =>
				!["node_modules", ".questpie"].some((name) =>
					path.split("/").includes(name),
				),
		});
		await symlink(
			join(original, "node_modules"),
			join(fixture, "node_modules"),
			"dir",
		);
		const queryPath = join(fixture, "src/tickets/queries.ts");
		const source = await Bun.file(queryPath).text();
		expect(
			source.match(/after: codec.nullable\(codec.cursor\(\)\)/g),
		).toHaveLength(1);
		await Bun.write(
			queryPath,
			source
				.replace(
					"after: codec.nullable(codec.cursor())",
					"continuation: codec.nullable(codec.cursor())",
				)
				.replace("after: parameters.after", "after: parameters.continuation") +
				`

export const pageShapedHandler = defineQuery({
	name: "tickets.pageShapedHandler",
	network: true,
	input: codec.object({ continuation: codec.nullable(codec.cursor()) }),
	output: codec.object({
		nodes: codec.array(ticketSummaryCodec),
		pageInfo: codec.object({ endCursor: codec.nullable(codec.text()), hasNextPage: codec.boolean() }),
	}),
	handler: async () => ({ nodes: [], pageInfo: { endCursor: null, hasNextPage: false } }),
});
`,
		);
		const compiled = await compileApplication({
			applicationRoot: fixture,
			outputDirectory: join(fixture, ".questpie/generated"),
		});
		const operations = JSON.parse(
			compiled.generatedFiles["operation-contracts.json"]!,
		);
		const http = JSON.parse(
			compiled.generatedFiles["operation-http-contract.json"]!,
		);
		const exposed = new Set(
			http.operations.map((entry: { identity: string }) => entry.identity),
		);
		const queries = JSON.parse(
			compiled.generatedFiles["query-projection.json"]!,
		).queries;
		const pages = queries
			.filter(
				(query: {
					identity: string | null;
					template: { page: { kind: string } };
				}) =>
					query.identity !== null &&
					exposed.has(query.identity) &&
					query.template.page.kind === "forwardCursor",
			)
			.map(
				(query: {
					identity: string;
					template: { page: { after: { parameter: string } } };
				}) => ({
					identity: query.identity,
					after: query.template.page.after.parameter,
				}),
			);
		expect(pages).toContainEqual({
			identity: "query:tickets.queue",
			after: "continuation",
		});
		expect(
			pages.some(
				(page: { identity: string }) =>
					page.identity === "query:tickets.pageShapedHandler",
			),
		).toBe(false);
		const resources: Parameters<typeof instrumentClient>[1] =
			operations.operations
				.filter((entry: { identity: string }) => exposed.has(entry.identity))
				.map((entry: { identity: string }) => ({
					identity: entry.identity,
					kind: entry.identity.slice(0, entry.identity.indexOf(":")),
					name: entry.identity.slice(entry.identity.indexOf(":") + 1),
					contract: { ...entry, exposure: "network" },
				}));
		const generatedPath = join(fixture, ".questpie/generated/client.ts");
		await Bun.write(
			generatedPath,
			instrumentClient(
				compiled.generatedFiles["client.ts"]!,
				resources,
				[],
				pages,
			),
		);
		const { createClient, getClientProjection } = await import(generatedPath);
		const requests: URL[] = [];
		const client = createClient({
			baseUrl: "https://proof.invalid",
			fetch: async (request: Request) => {
				requests.push(new URL(request.url));
				return new Response(
					JSON.stringify({
						callId: request.headers.get("Questpie-Call-Id"),
						result: {
							nodes: [],
							pageInfo: {
								endCursor: "next-position",
								hasNextPage: requests.length === 1,
							},
						},
					}),
					{ headers: { "content-type": "application/json; charset=utf-8" } },
				);
			},
		});
		const id = "018f5f6e-5f2c-7b41-a854-3d9a6b6b7131";
		const projection = getClientProjection(
			client.withContext({ membershipId: id, organizationId: id }),
		);
		const adapter = bindProjection(projection, cache);
		dispose = adapter.dispose;
		expect(adapter.queries["tickets.pageShapedHandler"]).not.toHaveProperty(
			"infiniteOptions",
		);
		// This dynamically compiled fixture proves runtime projection, not static DTO inference.
		const queue = adapter.queries["tickets.queue"];
		if (
			!queue ||
			!("infiniteOptions" in queue) ||
			typeof queue.infiniteOptions !== "function"
		)
			throw new Error("Compiled root Query has no infinite capability");
		const options = queue.infiniteOptions({
			first: 1,
			statuses: null,
			teamIds: null,
		});
		observer = new InfiniteQueryObserver(cache, options);
		await observer.fetchNextPage();
		await observer.fetchNextPage();
		await observer.fetchNextPage();
		expect(requests.map((url) => url.pathname)).toEqual([
			"/_questpie/query/tickets.queue",
			"/_questpie/query/tickets.queue",
		]);
		expect(requests.map((url) => url.searchParams.get("continuation"))).toEqual(
			["~null", "next-position"],
		);
		expect(requests.some((url) => url.searchParams.has("after"))).toBe(false);
		expect(observer.getCurrentResult().data?.pageParams).toEqual([
			null,
			"next-position",
		]);
	} finally {
		observer?.destroy();
		await dispose?.();
		cache.clear();
		await rm(temporary, { recursive: true, force: true });
	}
}, 60_000);
