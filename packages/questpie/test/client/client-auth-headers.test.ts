import { afterEach, describe, expect, it } from "bun:test";

import { createClient } from "../../src/client/index.js";

async function waitFor(assertion: () => boolean, timeoutMs = 3000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (assertion()) return;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error("Timed out waiting for assertion");
}

describe("client dynamic auth headers", () => {
	const originalFetch = globalThis.fetch;
	const originalXMLHttpRequest = globalThis.XMLHttpRequest;

	afterEach(() => {
		globalThis.fetch = originalFetch;
		globalThis.XMLHttpRequest = originalXMLHttpRequest;
	});

	it("resolves fresh auth headers for every data request", async () => {
		const authorizationHeaders: Array<string | null> = [];
		let token = 0;
		const client = createClient<any>({
			baseURL: "http://localhost:3000",
			headers: { Authorization: "Bearer static" },
			getAuthHeaders: async () => ({
				Authorization: `Bearer data-${++token}`,
			}),
			fetch: async (_input, init) => {
				authorizationHeaders.push(
					new Headers(init?.headers).get("Authorization"),
				);
				return Response.json({ docs: [], totalDocs: 0 });
			},
		});

		await client.collections.posts.find();
		await client.collections.posts.find();

		expect(authorizationHeaders).toEqual(["Bearer data-1", "Bearer data-2"]);
	});

	it("resolves fresh auth headers for every upload while retaining cookies", async () => {
		const requests: Array<{
			headers: Record<string, string>;
			withCredentials: boolean;
		}> = [];

		class FakeXMLHttpRequest extends EventTarget {
			upload = new EventTarget();
			status = 200;
			responseText = JSON.stringify({ ok: true });
			withCredentials = false;
			private headers: Record<string, string> = {};

			open() {}

			setRequestHeader(name: string, value: string) {
				this.headers[name] = value;
			}

			send() {
				requests.push({
					headers: { ...this.headers },
					withCredentials: this.withCredentials,
				});
				queueMicrotask(() => this.dispatchEvent(new Event("load")));
			}

			abort() {
				this.dispatchEvent(new Event("abort"));
			}
		}

		globalThis.XMLHttpRequest =
			FakeXMLHttpRequest as unknown as typeof XMLHttpRequest;

		const file = new File(["image"], "photo.jpg", { type: "image/jpeg" });
		const cookieClient = createClient<any>({
			baseURL: "http://localhost:3000",
		});
		await cookieClient.collections.assets.upload(file);

		let token = 0;
		const client = createClient<any>({
			baseURL: "http://localhost:3000",
			getAuthHeaders: () => ({
				Authorization: `Bearer upload-${++token}`,
			}),
		});
		await client.collections.assets.upload(file);
		await client.collections.assets.upload(file);

		expect(requests).toEqual([
			{
				headers: {},
				withCredentials: true,
			},
			{
				headers: { Authorization: "Bearer upload-1" },
				withCredentials: true,
			},
			{
				headers: { Authorization: "Bearer upload-2" },
				withCredentials: true,
			},
		]);
	});

	it("resolves fresh auth headers for realtime discovery and every connection", async () => {
		const requests: Array<{
			authorization: string | null;
			credentials: RequestCredentials | undefined;
		}> = [];

		globalThis.fetch = (async (_input, init) => {
			let controller!: ReadableStreamDefaultController<Uint8Array>;
			const body = new ReadableStream<Uint8Array>({
				start(streamController) {
					controller = streamController;
				},
			});
			init?.signal?.addEventListener("abort", () => controller.close());
			requests.push({
				authorization: new Headers(init?.headers).get("Authorization"),
				credentials: init?.credentials,
			});
			return new Response(body, {
				status: 200,
				headers: { "Content-Type": "text/event-stream" },
			});
		}) as typeof fetch;

		let token = 0;
		const client = createClient<any>({
			baseURL: "http://localhost:3000",
			getAuthHeaders: () => ({
				Authorization: `Bearer realtime-${++token}`,
			}),
		});

		const stopFirst = client.collections.posts.live({}, () => {});
		await waitFor(() => requests.length === 2);
		stopFirst();
		await waitFor(() => client.realtime.topicCount === 0);
		client.realtime.destroy();

		const stopSecond = client.collections.posts.live({}, () => {});
		await waitFor(() => requests.length === 4);
		stopSecond();
		client.realtime.destroy();

		expect(requests).toEqual([
			{
				authorization: "Bearer realtime-1",
				credentials: "include",
			},
			{
				authorization: "Bearer realtime-2",
				credentials: "include",
			},
			{
				authorization: "Bearer realtime-3",
				credentials: "include",
			},
			{
				authorization: "Bearer realtime-4",
				credentials: "include",
			},
		]);
	});
});
