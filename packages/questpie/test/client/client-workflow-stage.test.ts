import { beforeEach, describe, expect, it } from "bun:test";
import { createClient } from "../../src/client/index.js";

type CapturedCall = {
	url: URL;
	method: string;
	body?: string;
};

function toUrl(input: RequestInfo | URL): URL {
	if (typeof input === "string") return new URL(input);
	if (input instanceof URL) return input;
	return new URL(input.url);
}

describe("client workflow stage query propagation", () => {
	let calls: CapturedCall[];
	let client: ReturnType<typeof createClient<any>>;

	beforeEach(() => {
		calls = [];

		client = createClient<any>({
			baseURL: "http://localhost:3000",
			basePath: "/",
			fetch: async (input, init) => {
				calls.push({
					url: toUrl(input),
					method: (init?.method ?? "GET").toUpperCase(),
					body: typeof init?.body === "string" ? init.body : undefined,
				});

				return new Response(JSON.stringify({ ok: true, count: 0, docs: [] }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			},
		});
	});

	it("forwards stage for collection reads", async () => {
		await client.collections.posts.find({ stage: "review", limit: 1 });
		await client.collections.posts.findOne({
			where: { id: "post-1" },
			stage: "review",
		});

		expect(calls[0]?.url.pathname).toBe("/posts");
		expect(calls[0]?.url.searchParams.get("stage")).toBe("review");

		expect(calls[1]?.url.pathname).toBe("/posts/post-1");
		expect(calls[1]?.url.searchParams.get("stage")).toBe("review");
	});

	it("forwards stage for collection write/version endpoints", async () => {
		await client.collections.posts.create(
			{ title: "Draft" },
			{ stage: "draft" },
		);
		await client.collections.posts.update(
			{ id: "post-1", data: { title: "Review" } },
			{ stage: "review" },
		);
		await client.collections.posts.revertToVersion(
			{ id: "post-1", version: 1 },
			{ stage: "published" },
		);

		expect(calls[0]?.url.pathname).toBe("/posts");
		expect(calls[0]?.url.searchParams.get("stage")).toBe("draft");

		expect(calls[1]?.url.pathname).toBe("/posts/post-1");
		expect(calls[1]?.url.searchParams.get("stage")).toBe("review");

		expect(calls[2]?.url.pathname).toBe("/posts/post-1/revert");
		expect(calls[2]?.url.searchParams.get("stage")).toBe("published");
	});

	it("sends correct request for collection transitionStage", async () => {
		await client.collections.posts.transitionStage(
			{ id: "post-1", stage: "published" },
			{ locale: "en" },
		);

		expect(calls[0]?.url.pathname).toBe("/posts/post-1/transition");
		expect(calls[0]?.method).toBe("POST");
		expect(calls[0]?.url.searchParams.get("locale")).toBe("en");
		// Body is SuperJSON-encoded by default: { json: { stage: "published" } }
		const body = JSON.parse(calls[0]?.body ?? "{}");
		expect(body.json.stage).toBe("published");
	});

	it("sends correct request for global transitionStage", async () => {
		await client.globals.siteSettings.transitionStage(
			{ stage: "published" },
			{ locale: "en" },
		);

		expect(calls[0]?.url.pathname).toBe("/globals/siteSettings/transition");
		expect(calls[0]?.method).toBe("POST");
		expect(calls[0]?.url.searchParams.get("locale")).toBe("en");
		const body = JSON.parse(calls[0]?.body ?? "{}");
		expect(body.json.stage).toBe("published");
	});

	it("forwards stage for global endpoints", async () => {
		await client.globals.siteSettings.get({ stage: "review" });
		await client.globals.siteSettings.update(
			{ siteName: "Updated" },
			{ stage: "published" },
		);
		await client.globals.siteSettings.findVersions({ stage: "review" });
		await client.globals.siteSettings.revertToVersion(
			{ version: 1 },
			{ stage: "draft" },
		);

		expect(calls[0]?.url.pathname).toBe("/globals/siteSettings");
		expect(calls[0]?.url.searchParams.get("stage")).toBe("review");

		expect(calls[1]?.url.pathname).toBe("/globals/siteSettings");
		expect(calls[1]?.url.searchParams.get("stage")).toBe("published");

		expect(calls[2]?.url.pathname).toBe("/globals/siteSettings/versions");
		expect(calls[2]?.url.searchParams.get("stage")).toBe("review");

		expect(calls[3]?.url.pathname).toBe("/globals/siteSettings/revert");
		expect(calls[3]?.url.searchParams.get("stage")).toBe("draft");
	});
});
