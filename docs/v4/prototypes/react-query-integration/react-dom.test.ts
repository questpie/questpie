import { afterAll, beforeAll, expect, test } from "bun:test";

import {
	environmentManager,
	QueryClient,
	QueryClientProvider,
	useMutation,
	useQuery,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { JSDOM } from "jsdom";
import {
	act,
	Component,
	createElement,
	StrictMode,
	Suspense,
	type ReactNode,
} from "react";

import { createClient } from "./generated/client";
import { createQueryAdapter } from "./generated/client.react-query";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
	url: "https://proof.invalid",
});
const previous = new Map<string, PropertyDescriptor | undefined>();
const wasServer = environmentManager.isServer();
beforeAll(() => {
	for (const [key, value] of Object.entries({
		window: dom.window,
		document: dom.window.document,
		navigator: dom.window.navigator,
		IS_REACT_ACT_ENVIRONMENT: true,
	})) {
		previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
		Object.defineProperty(globalThis, key, {
			configurable: true,
			writable: true,
			value,
		});
	}
	environmentManager.setIsServer(() => false);
});
afterAll(() => {
	environmentManager.setIsServer(() => wasServer);
	for (const [key, descriptor] of previous) {
		if (descriptor) Object.defineProperty(globalThis, key, descriptor);
		else Reflect.deleteProperty(globalThis, key);
	}
	dom.window.close();
});

const id = "018f5f6e-5f2c-7b41-a854-3d9a6b6b7131";
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
function setup() {
	const calls: string[] = [];
	const client = createClient({
		baseUrl: "https://proof.invalid",
		fetch: (async (request: Request) => {
			calls.push(request.method);
			return new Response(
				JSON.stringify({
					callId: request.headers.get(
						request.method === "GET" ? "Questpie-Call-Id" : "Idempotency-Key",
					),
					result: {
						id,
						title:
							request.method === "GET" ? "Protected task" : "Committed task",
						updatedAt: "2026-09-08T10:00:00.000Z",
					},
				}),
				{ headers: { "content-type": "application/json; charset=utf-8" } },
			);
		}) as typeof fetch,
	});
	const cache = new QueryClient({
		defaultOptions: { queries: { staleTime: Infinity } },
	});
	const adapter = createQueryAdapter(
		client.withContext({ companyId: id }),
		cache,
	);
	const host = dom.window.document.createElement("main");
	dom.window.document.body.append(host);
	return { adapter, cache, calls, host };
}

test("StrictMode consumes native Query selectors and Mutation options, then retires Query data", async () => {
	const { createRoot } = await import("react-dom/client");
	const { adapter, cache, calls, host } = setup();
	const options = adapter.queries["tasks.detail"].options({ id });
	const mutationOptions = adapter.mutations["tasks.transition"].options();
	const root = createRoot(host);
	function Task() {
		const query = useQuery({
			...options,
			select: (value) => value?.title ?? "Missing",
		});
		const mutation = useMutation(mutationOptions);
		return createElement(
			"section",
			null,
			createElement(
				"p",
				null,
				query.isError ? "Retired" : (query.data ?? "Loading"),
			),
			createElement(
				"button",
				{
					onClick: () =>
						mutation.mutate({ id, expectedVersion: 1, targetStatus: "done" }),
				},
				"Complete",
			),
			createElement("output", null, mutation.data?.title ?? "Not submitted"),
		);
	}
	try {
		await act(async () => {
			root.render(
				createElement(
					StrictMode,
					null,
					createElement(
						QueryClientProvider,
						{ client: cache },
						createElement(Task),
					),
				),
			);
		});
		await act(async () => {
			await cache.fetchQuery(options);
			await flush();
		});
		expect(host.textContent).toContain("Protected task");
		await act(async () => {
			host
				.querySelector("button")!
				.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
			await flush();
		});
		expect(host.textContent).toContain("Committed task");
		expect(calls.filter((method) => method === "POST")).toHaveLength(1);
		const callsBeforeRetirement = calls.length;
		await act(async () => {
			await adapter.dispose();
			await flush();
		});
		expect(host.textContent).not.toContain("Protected task");
		expect(host.textContent).not.toContain("Committed task");
		// Removing the Query lets the retained native observer rebuild once. Its
		// guarded queryFn rejects; the next notification delivers the terminal error.
		await act(async () => {
			await flush();
		});
		expect(host.textContent).not.toContain("Protected task");
		expect(host.textContent).toContain("Retired");
		expect(calls).toHaveLength(callsBeforeRetirement);
	} finally {
		await act(async () => {
			root.unmount();
		});
		await adapter.dispose();
		cache.clear();
		host.remove();
	}
}, 3_000);

class Boundary extends Component<
	{ children?: ReactNode },
	{ failed: boolean }
> {
	state = { failed: false };
	static getDerivedStateFromError() {
		return { failed: true };
	}
	render() {
		return this.state.failed
			? createElement("p", null, "Access ended")
			: this.props.children;
	}
}

test("native Suspense switches to its error boundary when its scope is retired", async () => {
	const { createRoot } = await import("react-dom/client");
	const { adapter, cache, host } = setup();
	const caught: unknown[] = [];
	const root = createRoot(host, {
		onCaughtError: (error) => {
			caught.push(error);
		},
	});
	const options = adapter.queries["tasks.detail"].options({ id });
	function Task() {
		const query = useSuspenseQuery(options);
		return createElement("p", null, query.data?.title);
	}
	try {
		await act(async () => {
			root.render(
				createElement(
					QueryClientProvider,
					{ client: cache },
					createElement(
						Boundary,
						null,
						createElement(
							Suspense,
							{ fallback: "Loading" },
							createElement(Task),
						),
					),
				),
			);
		});
		await act(async () => {
			await cache.fetchQuery(options);
			await flush();
		});
		expect(host.textContent).toContain("Protected task");
		await act(async () => {
			await adapter.dispose();
			await flush();
		});
		expect(host.textContent).not.toContain("Protected task");
		expect(host.textContent).toContain("Access ended");
		expect(caught).toHaveLength(1);
	} finally {
		await act(async () => {
			root.unmount();
		});
		await adapter.dispose();
		cache.clear();
		host.remove();
	}
}, 3_000);
