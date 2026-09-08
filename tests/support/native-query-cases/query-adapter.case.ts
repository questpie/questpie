import { expect, test } from "bun:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
	MutationObserver,
	QueryClient,
	QueryObserver,
} from "@tanstack/react-query";
import {
	attachClientScope,
	readClientScope,
} from "questpie/internal/client-projection";
import { createQueryAdapter } from "questpie/react-query";

import { createClient } from "#questpie/test-client";

test("the superseded ordinal projection is rejected instead of receiving a hydration fallback", async () => {
	const cache = new QueryClient();
	const client = createClient({ baseUrl: "https://proof.invalid" });
	const scope = client.withContext({ companyId: id });
	const legacy = {
		...readClientScope(scope),
		version: "questpie.client-projection.prototype.v1",
	};
	let created: ReturnType<typeof createQueryAdapter> | undefined;
	try {
		expect(() => {
			created = Reflect.apply(createQueryAdapter, undefined, [
				attachClientScope({}, () => legacy as never),
				cache,
			]);
		}).toThrow("CLIENT_PROJECTION_INCOMPATIBLE");
	} finally {
		await created?.dispose();
		cache.clear();
	}
});

test("the replaced projection and readiness spelling are rejected without compatibility paths", () => {
	const cache = new QueryClient();
	const client = createClient({ baseUrl: "https://proof.invalid" });
	const scope = client.withContext({ companyId: id });
	const source = readClientScope(scope);
	try {
		expect(() =>
			Reflect.apply(createQueryAdapter, undefined, [
				attachClientScope(
					{},
					() =>
						({
							...source,
							version: "questpie.client-projection.prototype.v2",
						}) as never,
				),
				cache,
			]),
		).toThrow("CLIENT_PROJECTION_INCOMPATIBLE");
		expect(() =>
			Reflect.apply(createQueryAdapter, undefined, [
				scope,
				cache,
				{ liveReady: Promise.resolve() },
			]),
		).toThrow("QUERY_BINDING_INVALID");
	} finally {
		cache.clear();
	}
});

test("separately bundled adapter copies cannot alias inputs or evict each other's Query cache", async () => {
	const bundle = await Bun.build({
		entrypoints: [fileURLToPath(import.meta.resolve("questpie/react-query"))],
		target: "browser",
	});
	if (!bundle.success || !bundle.outputs[0])
		throw new Error("Independent adapter bundle failed");
	const copyPath = join(import.meta.dir, "independent-adapter.js");
	await Bun.write(copyPath, bundle.outputs[0]);
	const copy: typeof import("questpie/react-query") = await import(copyPath);
	const client = createClient({ baseUrl: "https://proof.invalid" });
	const cache = new QueryClient();
	const scope = client.withContext({ companyId: id });
	const first = createQueryAdapter(scope, cache);
	const second = copy.createQueryAdapter(scope, cache);
	try {
		const one = first.queries["tasks.detail"].options({
			id,
			asOf: new Date(date),
		});
		const two = second.queries["tasks.detail"].options({ id });
		expect(one.queryKey).not.toEqual(two.queryKey);
		const secondValue = {
			id,
			title: "Second copy",
			updatedAt: new Date(date),
		};
		cache.setQueryData(two.queryKey, () => secondValue);
		await first.dispose();
		expect(cache.getQueryData(two.queryKey)?.title).toBe("Second copy");
	} finally {
		await first.dispose();
		await second.dispose();
		cache.clear();
	}
});

const id = "018f5f6e-5f2c-7b41-a854-3d9a6b6b7131";
const date = "2026-09-08T10:00:00.000Z";

test("a throwing Query cleanup subscriber cannot retain another owned Query or disturb a separate scope", async () => {
	const client = createClient({
		baseUrl: "https://proof.invalid",
		fetch: (async (request: Request) =>
			Response.json(
				{
					callId: request.headers.get(
						request.method === "GET" ? "Questpie-Call-Id" : "Idempotency-Key",
					),
					result: { id, title: "Protected result", updatedAt: date },
				},
				{ headers: { "content-type": "application/json; charset=utf-8" } },
			)) as typeof fetch,
	});
	const cache = new QueryClient();
	const adapter = createQueryAdapter(
		client.withContext({ companyId: id }),
		cache,
	);
	const other = createQueryAdapter(
		client.withContext({ companyId: id }),
		cache,
	);
	const firstOptions = adapter.queries["tasks.detail"].options({ id });
	const secondOptions = adapter.queries["tasks.summary"].options({ id });
	const otherOptions = other.queries["tasks.detail"].options({ id });
	await Promise.all([
		cache.fetchQuery(firstOptions),
		cache.fetchQuery(secondOptions),
		cache.fetchQuery(otherOptions),
	]);
	const mutation = new MutationObserver(
		cache,
		adapter.mutations["tasks.transition"].options(),
	);
	await mutation.mutate({ id, expectedVersion: 1, targetStatus: "done" });
	const first = new QueryObserver(cache, { ...firstOptions, enabled: false });
	const sibling = new QueryObserver(cache, { ...firstOptions, enabled: false });
	const second = new QueryObserver(cache, { ...secondOptions, enabled: false });
	let closing = false;
	const stopFirst = first.subscribe(() => {
		if (closing) throw new Error("Application Query subscriber failure");
	});
	const stopSecond = second.subscribe(() => {});
	const stopSibling = sibling.subscribe(() => {});
	try {
		expect(second.getCurrentResult().data?.title).toBe("Protected result");
		expect(sibling.getCurrentResult().data?.title).toBe("Protected result");
		closing = true;
		await expect(adapter.dispose()).rejects.toThrow();
		expect(first.getCurrentResult().data).toBeUndefined();
		expect(sibling.getCurrentResult().data).toBeUndefined();
		expect(second.getCurrentResult().data).toBeUndefined();
		expect(cache.getQueryData(firstOptions.queryKey)).toBeUndefined();
		expect(cache.getQueryData(secondOptions.queryKey)).toBeUndefined();
		expect(cache.getQueryCache().getAll()).toHaveLength(1);
		expect(mutation.getCurrentResult().data).toBeUndefined();
		expect(cache.getMutationCache().getAll()).toHaveLength(0);
		expect(cache.getQueryData(otherOptions.queryKey)?.title).toBe(
			"Protected result",
		);
		await expect(cache.fetchQuery(secondOptions)).rejects.toThrow(
			"SCOPE_RETIRED",
		);
	} finally {
		closing = false;
		stopFirst();
		stopSibling();
		stopSecond();
		first.destroy();
		sibling.destroy();
		second.destroy();
		mutation.reset();
		await adapter.dispose();
		await other.dispose();
		cache.clear();
	}
});

test("retiring one scope clears retained Query observers without touching another scope or reopening transport", async () => {
	let calls = 0;
	const client = createClient({
		baseUrl: "https://proof.invalid",
		fetch: (async (request: Request) => {
			calls++;
			return new Response(
				JSON.stringify({
					callId: decodeURIComponent(request.headers.get("Questpie-Call-Id")!),
					result: { id, title: "Protected task", updatedAt: date },
				}),
				{ headers: { "content-type": "application/json; charset=utf-8" } },
			);
		}) as typeof fetch,
	});
	const cache = new QueryClient();
	const scope = client.withContext({ companyId: id });
	const adapter = createQueryAdapter(scope, cache);
	const other = createQueryAdapter(
		client.withContext({ companyId: id }),
		cache,
	);
	const options = adapter.queries["tasks.detail"].options({ id });
	const otherOptions = other.queries["tasks.detail"].options({ id });
	const oldMutation = adapter.mutations["tasks.transition"].options();
	await cache.fetchQuery(options);
	await cache.fetchQuery(otherOptions);
	const observer = new QueryObserver(cache, { ...options, enabled: false });
	const stop = observer.subscribe(() => {});
	try {
		expect(observer.getCurrentResult().data?.title).toBe("Protected task");
		await adapter.dispose();
		expect(observer.getCurrentResult().data).toBeUndefined();
		expect(cache.getQueryData(options.queryKey)).toBeUndefined();
		expect(cache.getQueryData(otherOptions.queryKey)?.title).toBe(
			"Protected task",
		);
		expect(createQueryAdapter(scope, cache)).toBe(adapter);
		expect(() => adapter.queries["tasks.detail"].options({ id })).toThrow(
			"SCOPE_RETIRED",
		);
		await expect(cache.fetchQuery(options)).rejects.toThrow("SCOPE_RETIRED");
		await expect(
			new MutationObserver(cache, oldMutation).mutate({
				id,
				expectedVersion: 2,
				targetStatus: "done",
			}),
		).rejects.toThrow("SCOPE_RETIRED");
		expect(calls).toBe(2);
	} finally {
		stop();
		await adapter.dispose();
		await other.dispose();
		cache.clear();
	}
});

test("generated error narrowing preserves declared payload types and leaves transport failures unknown", async () => {
	const arbitrary = new Error("Synthetic transport failure");
	let response: "declared" | "transport" | "invalid" = "declared";
	const client = createClient({
		baseUrl: "https://proof.invalid",
		fetch: (async (request: Request): Promise<Response> => {
			if (response === "transport") throw arbitrary;
			return new Response(
				JSON.stringify({
					callId: decodeURIComponent(request.headers.get("Idempotency-Key")!),
					error: {
						code: "VERSION_CONFLICT",
						payload: {
							currentVersion: response === "declared" ? 3 : "invalid",
						},
					},
				}),
				{
					status: 409,
					headers: { "content-type": "application/json; charset=utf-8" },
				},
			);
		}) as typeof fetch,
	});
	const cache = new QueryClient();
	const adapter = createQueryAdapter(
		client.withContext({ companyId: id }),
		cache,
	);
	const operation = adapter.mutations["tasks.transition"];
	const observer = new MutationObserver(cache, operation.options());
	const input = { id, expectedVersion: 2, targetStatus: "done" };
	try {
		const declared: unknown = await observer
			.mutate(input)
			.catch((error: unknown) => error);
		expect(operation.isError(declared)).toBe(true);
		if (!operation.isError(declared))
			throw new Error("Expected generated declared error");
		const currentVersion: number = declared.payload.currentVersion;
		expect(currentVersion).toBe(3);
		response = "transport";
		const transport: unknown = await observer
			.mutate(input)
			.catch((error: unknown) => error);
		expect(transport).toBe(arbitrary);
		expect(operation.isError(transport)).toBe(false);
		response = "invalid";
		const malformed: unknown = await observer
			.mutate(input)
			.catch((error: unknown) => error);
		expect(operation.isError(malformed)).toBe(false);
	} finally {
		await adapter.dispose();
		cache.clear();
	}
});

test("native Mutation options keep independent call identities for concurrent uses of one variables object", async () => {
	const calls: string[] = [];
	const client = createClient({
		baseUrl: "https://proof.invalid",
		fetch: (async (request: Request) => {
			const callId = decodeURIComponent(
				request.headers.get("Idempotency-Key")!,
			);
			calls.push(callId);
			return new Response(
				JSON.stringify({
					callId,
					result: { id, title: "Task moved", updatedAt: date },
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
	try {
		const options = adapter.mutations["tasks.transition"].options();
		const observer = new MutationObserver(cache, options);
		const variables = { id, expectedVersion: 2, targetStatus: "done" };
		const first = observer.mutate(variables);
		const second = observer.mutate(variables);
		const results = await Promise.all([first, second]);
		expect(calls).toHaveLength(2);
		expect(calls[0]).not.toBe(calls[1]);
		expect(results[0]?.updatedAt.toISOString()).toBe(date);
		expect(options.retry).toBe(false);
	} finally {
		await adapter.dispose();
		cache.clear();
	}
});

test("binding is idempotent, equivalent codec inputs share keys, and equal Context scopes remain separate", async () => {
	const client = createClient({
		baseUrl: "https://proof.invalid",
		fetch: (async (_request: Request): Promise<Response> => {
			throw new Error("unexpected transport");
		}) as typeof fetch,
	});
	const cache = new QueryClient();
	const scope = client.withContext({ companyId: id });
	const adapter = createQueryAdapter(scope, cache);
	const other = createQueryAdapter(
		client.withContext({ companyId: id }),
		cache,
	);
	try {
		expect(createQueryAdapter(scope, cache)).toBe(adapter);
		const first = adapter.queries["tasks.detail"].options({
			id,
			asOf: new Date(date),
		});
		const reordered = adapter.queries["tasks.detail"].options({
			asOf: new Date(date),
			id,
		});
		expect(first.queryKey).toEqual(reordered.queryKey);
		expect(
			other.queries["tasks.detail"].options({ id, asOf: new Date(date) })
				.queryKey,
		).not.toEqual(first.queryKey);
		expect(
			adapter.queries["tasks.detail"].options({
				id,
				asOf: new Date("2026-09-08T10:00:00.001Z"),
			}).queryKey,
		).not.toEqual(first.queryKey);
		expect(() =>
			// @ts-expect-error Explicit undefined is not a codec-valid optional input.
			adapter.queries["tasks.detail"].options({ id, asOf: undefined }),
		).toThrow("PROTOCOL_UNSUPPORTED");
	} finally {
		await adapter.dispose();
		await other.dispose();
		cache.clear();
	}
});

test("generated Query options capture codec input once without repeating a key or DTO", async () => {
	const requests: Request[] = [];
	const client = createClient({
		baseUrl: "https://proof.invalid",
		fetch: (async (request: Request) => {
			requests.push(request);
			return new Response(
				JSON.stringify({
					callId: decodeURIComponent(request.headers.get("Questpie-Call-Id")!),
					result: { id, title: "Task", updatedAt: date },
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
	try {
		const input = { id, asOf: new Date(date) };
		const options = adapter.queries["tasks.detail"].options(input);
		input.asOf.setUTCFullYear(2040);
		const result = await cache.fetchQuery(options);
		expect(result?.updatedAt.toISOString()).toBe(date);
		expect(new URL(requests[0]!.url).searchParams.get("asOf")).toBe(date);
		expect(JSON.stringify(options.queryKey)).not.toContain(id);
		expect(JSON.stringify(options.queryKey)).not.toContain(date);
	} finally {
		await adapter.dispose();
		cache.clear();
	}
});
