import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { copyFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { createQueryAdapter } from "questpie/react-query";

async function prepareFactoryClients(directory: string) {
	await copyFile(
		join(import.meta.dir, "ordinary-client.ts"),
		join(directory, "client.ts"),
	);
	await copyFile(join(import.meta.dir, "app.ts"), join(directory, "app.ts"));
}

test("a separately bundled generated client works with the public generic factory", async () => {
	const directory = await mkdtemp(
		join(import.meta.dir, "factory-seam-output-"),
	);
	const cache = new QueryClient();
	const id = "018f5f6e-5f2c-7b41-a854-3d9a6b6b7131";
	const requests: Request[] = [];
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(request) {
			requests.push(request);
			const mutation = request.method === "POST";
			const input = mutation ? await request.json() : undefined;
			const reject = input?.input?.targetStatus === "reject";
			return Response.json(
				{
					callId: decodeURIComponent(
						request.headers.get(
							mutation ? "Idempotency-Key" : "Questpie-Call-Id",
						)!,
					),
					...(reject
						? {
								error: {
									code: "VERSION_CONFLICT",
									payload: { currentVersion: 3 },
								},
							}
						: {
								result: {
									id,
									title: "Factory",
									updatedAt: "2026-09-08T10:00:00.000Z",
								},
							}),
				},
				{
					status: reject ? 409 : 200,
					headers: { "content-type": "application/json; charset=utf-8" },
				},
			);
		},
	});
	let adapter: ReturnType<typeof createQueryAdapter> | undefined;
	try {
		await prepareFactoryClients(directory);
		const clientBuild = await Bun.build({
			entrypoints: [join(directory, "client.ts")],
			target: "browser",
		});
		const factoryBuild = await Bun.build({
			entrypoints: [fileURLToPath(import.meta.resolve("questpie/react-query"))],
			target: "browser",
		});
		expect(clientBuild.success).toBe(true);
		expect(factoryBuild.success).toBe(true);
		await Bun.write(
			join(directory, "client.bundle.mjs"),
			clientBuild.outputs[0]!,
		);
		await Bun.write(
			join(directory, "factory.bundle.mjs"),
			factoryBuild.outputs[0]!,
		);
		const clientModule = await import(join(directory, "client.bundle.mjs"));
		const factoryModule: typeof import("questpie/react-query") = await import(
			join(directory, "factory.bundle.mjs")
		);
		const scope = clientModule
			.createClient({ baseUrl: server.url.origin })
			.withContext({ companyId: id });
		expect(Object.keys(factoryModule)).toEqual(["createQueryAdapter"]);
		expect(clientModule.getClientProjection).toBeUndefined();
		expect(Object.keys(scope).sort()).toEqual([
			"actions",
			"context",
			"mutations",
			"queries",
			"withContext",
		]);
		expect(Object.isFrozen(scope)).toBe(true);
		const symbols = Object.getOwnPropertySymbols(scope);
		expect(symbols).toHaveLength(1);
		expect(
			Object.getOwnPropertyDescriptor(scope, symbols[0]!)?.enumerable,
		).toBe(false);
		adapter = factoryModule.createQueryAdapter(scope, cache);
		const result = await cache.fetchQuery(
			adapter.queries["tasks.detail"]!.options({ id } as never),
		);
		expect(result).toMatchObject({
			id,
			title: "Factory",
			updatedAt: new Date("2026-09-08T10:00:00.000Z"),
		});
		expect(requests).toHaveLength(1);
		const observer = new MutationObserver(
			cache,
			adapter.mutations["tasks.transition"]!.options(),
		);
		const unsubscribe = observer.subscribe(() => {});
		try {
			await expect(
				observer.mutate({
					id,
					expectedVersion: 1,
					targetStatus: "done",
				} as never),
			).resolves.toMatchObject({
				updatedAt: new Date("2026-09-08T10:00:00.000Z"),
			});
			expect(observer.getCurrentResult().isSuccess).toBe(true);
			const failure = await observer
				.mutate({ id, expectedVersion: 1, targetStatus: "reject" } as never)
				.catch((error: unknown) => error);
			expect(adapter.mutations["tasks.transition"]!.isError(failure)).toBe(
				true,
			);
			expect(failure).toMatchObject({
				code: "VERSION_CONFLICT",
				payload: { currentVersion: 3 },
			});
			expect(requests).toHaveLength(3);
		} finally {
			unsubscribe();
			observer.reset();
		}
	} finally {
		await adapter?.dispose();
		cache.clear();
		await server.stop(true);
		await rm(directory, { recursive: true, force: true });
	}
});

test("core and generated browser bundles resolve no React or TanStack runtime", async () => {
	const directory = await mkdtemp(
		join(import.meta.dir, "factory-seam-output-"),
	);
	try {
		await prepareFactoryClients(directory);
		for (const entrypoint of [
			join(directory, "client.ts"),
			fileURLToPath(import.meta.resolve("questpie")),
		]) {
			const forbidden: string[] = [];
			const build = await Bun.build({
				entrypoints: [entrypoint],
				target: "browser",
				plugins: [
					{
						name: "reject-optional-ui-dependencies",
						setup(builder) {
							builder.onResolve(
								{ filter: /@tanstack|(^|\/)react(?:-dom)?($|\/)/ },
								(args) => {
									forbidden.push(args.path);
									throw new Error("OPTIONAL_UI_DEPENDENCY_RESOLVED");
								},
							);
						},
					},
				],
			});
			expect(build.success).toBe(true);
			expect(forbidden).toEqual([]);
			expect(build.outputs[0]!.size).toBeGreaterThan(0);
		}
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("incompatible capability versions fail before invoking their reader", () => {
	const cache = new QueryClient();
	let reads = 0;
	const scope = {};
	Object.defineProperty(scope, Symbol.for("questpie.client-scope.v1"), {
		value: {
			version: "incompatible",
			read() {
				reads++;
				throw new Error("READER_MUST_NOT_RUN");
			},
		},
	});
	try {
		expect(() => createQueryAdapter(scope as never, cache)).toThrow(
			"CLIENT_PROJECTION_INCOMPATIBLE",
		);
		expect(reads).toBe(0);
		expect(cache.getQueryCache().getAll()).toHaveLength(0);
	} finally {
		cache.clear();
	}
});

test("the public factory rejects an incompatible scope before opening work", () => {
	const cache = new QueryClient();
	try {
		expect(() => createQueryAdapter({} as never, cache)).toThrow(
			"CLIENT_PROJECTION_INCOMPATIBLE",
		);
		expect(cache.getQueryCache().getAll()).toHaveLength(0);
		expect(cache.getMutationCache().getAll()).toHaveLength(0);
	} finally {
		cache.clear();
	}
});
