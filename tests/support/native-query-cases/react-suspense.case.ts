import { expect, test } from "bun:test";

import {
	QueryClient,
	QueryClientProvider,
	useSuspenseQuery,
	useSuspenseQueries,
} from "@tanstack/react-query";
import { createQueryAdapter } from "questpie/react-query";
import { createElement, Suspense } from "react";
import { renderToReadableStream } from "react-dom/server";

import { createClient } from "#questpie/test-client";

const id = "018f5f6e-5f2c-7b41-a854-3d9a6b6b7131";
const date = "2026-09-08T10:00:00.000Z";

test("native suspense streams its shell before the codec-decoded Task is ready", async () => {
	const pending = Promise.withResolvers<Response>();
	const received = Promise.withResolvers<Request>();
	let calls = 0;
	const client = createClient({
		baseUrl: "https://proof.invalid",
		fetch: (async (request: Request) => {
			calls++;
			received.resolve(request);
			return pending.promise;
		}) as typeof fetch,
	});
	const cache = new QueryClient();
	const adapter = createQueryAdapter(
		client.withContext({ companyId: id }),
		cache,
	);
	const options = adapter.queries["tasks.detail"].options({ id });
	function Detail() {
		const { data } = useSuspenseQuery(options);
		return createElement(
			"p",
			null,
			`${data?.title} ${data?.updatedAt.toISOString()}`,
		);
	}
	const controller = new AbortController();
	try {
		const stream = await renderToReadableStream(
			createElement(
				QueryClientProvider,
				{ client: cache },
				createElement(
					"main",
					null,
					createElement("h1", null, "Task proof"),
					createElement(
						Suspense,
						{ fallback: createElement("p", null, "Loading task") },
						createElement(Detail),
					),
				),
			),
			{ signal: controller.signal },
		);
		const reader = stream.getReader();
		const shell = new TextDecoder().decode((await reader.read()).value);
		expect(shell).toContain("Loading task");
		const request = await received.promise;
		pending.resolve(
			new Response(
				JSON.stringify({
					callId: request.headers.get("Questpie-Call-Id"),
					result: { id, title: "Ready task", updatedAt: date },
				}),
				{ headers: { "content-type": "application/json; charset=utf-8" } },
			),
		);
		let html = shell;
		while (true) {
			const part = await reader.read();
			if (part.done) break;
			html += new TextDecoder().decode(part.value);
		}
		expect(html).toContain(`Ready task ${date}`);
		expect(calls).toBe(1);
	} finally {
		controller.abort();
		await adapter.dispose();
		cache.clear();
	}
}, 3_000);

test("native suspense queries render distinct inferred Task results", async () => {
	let calls = 0;
	const client = createClient({
		baseUrl: "https://proof.invalid",
		fetch: (async (request: Request) => {
			calls++;
			return new Response(
				JSON.stringify({
					callId: request.headers.get("Questpie-Call-Id"),
					result: {
						id,
						title: new URL(request.url).searchParams.has("asOf")
							? "Historical task"
							: "Current task",
						updatedAt: date,
					},
				}),
				{ headers: { "content-type": "application/json; charset=utf-8" } },
			);
		}) as typeof fetch,
	});
	const cache = new QueryClient();
	const adapter = createQueryAdapter(
		client.withContext({ companyId: id }),
		cache,
	);
	function Details() {
		const results = useSuspenseQueries({
			queries: [
				adapter.queries["tasks.detail"].options({ id }),
				adapter.queries["tasks.detail"].options({ id, asOf: new Date(date) }),
			],
		});
		return createElement(
			"p",
			null,
			results.map((result) => result.data?.title).join(" / "),
		);
	}
	try {
		const stream = await renderToReadableStream(
			createElement(
				QueryClientProvider,
				{ client: cache },
				createElement(Details),
			),
		);
		const html = await new Response(stream).text();
		expect(html).toContain("Current task / Historical task");
		expect(calls).toBe(2);
	} finally {
		await adapter.dispose();
		cache.clear();
	}
}, 3_000);
