import { describe, expect, it } from "bun:test";

import { createClient, getTxid } from "../../src/client/index.js";

describe("client mutation transaction metadata", () => {
	it("attaches the response txid across collection and global mutations", async () => {
		const client = createClient<any>({
			baseURL: "http://localhost:3000",
			useSuperJSON: false,
			fetch: async () =>
				new Response(JSON.stringify({ id: "one", success: true }), {
					headers: {
						"Content-Type": "application/json",
						"X-Questpie-Txid": "901",
					},
				}),
		});

		const results = await Promise.all([
			client.collections.posts.create({ id: "one" }),
			client.collections.posts.update({ id: "one", data: { title: "x" } }),
			client.collections.posts.delete({ id: "one" }),
			client.collections.posts.restore({ id: "one" }),
			client.collections.posts.updateMany({ where: {}, data: { title: "x" } }),
			client.collections.posts.updateBatch({
				updates: [{ id: "one", data: { title: "x" } }],
			}),
			client.collections.posts.deleteMany({ where: {} }),
			client.globals.settings.update({ title: "x" }),
		]);

		expect(results.map(getTxid)).toEqual(Array(8).fill("901"));
	});
});
