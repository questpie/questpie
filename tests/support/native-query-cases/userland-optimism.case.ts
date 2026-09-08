import { expect, test } from "bun:test";

import {
	MutationObserver,
	QueryClient,
	QueryObserver,
} from "@tanstack/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createQueryAdapter } from "questpie/react-query";

import { createClient } from "#questpie/test-client";
import type { GeneratedClientScope } from "#questpie/test-client";

// Application UI, not a framework overlay: keep current authorized data separate
// from pending intent. No Operation DTO or cache key is restated by the author.
export function usePendingTaskTransition(
	scope: GeneratedClientScope,
	cache: QueryClient,
	id: string,
) {
	const adapter = createQueryAdapter(scope, cache);
	const current = useQuery(adapter.queries["tasks.detail"].options({ id }));
	const operation = adapter.mutations["tasks.transition"];
	const transition = useMutation({
		...operation.options(),
		onMutate: (variables) => ({ requestedStatus: variables.targetStatus }),
		onSuccess: (result, variables, intent) => {
			result.updatedAt.toISOString();
			// @ts-expect-error generated timestamp results are Dates, not wire strings
			const wireTimestamp: string = result.updatedAt;
			void wireTimestamp;
			variables.expectedVersion.toFixed();
			intent.requestedStatus.toUpperCase();
			// @ts-expect-error native onMutate context preserves its inferred string
			intent.requestedStatus.toFixed();
		},
		onError: (error, variables, intent) => {
			variables.expectedVersion.toFixed();
			intent?.requestedStatus.toUpperCase();
			if (operation.isError(error)) error.payload.currentVersion.toFixed();
			// @ts-expect-error arbitrary transport failure is not a declared error
			void error.payload.currentVersion;
		},
		onSettled: (_result, _error, _variables, intent) => {
			intent?.requestedStatus.toUpperCase();
		},
	});
	const base = current.isSuccess ? current.data : undefined;
	return {
		base,
		pendingStatus:
			base && transition.isPending && transition.variables.id === base.id
				? transition.variables.targetStatus
				: undefined,
		transition,
	};
}

const id = "018f5f6e-5f2c-7b41-a854-3d9a6b6b7131";
const date = "2026-09-08T10:00:00.000Z";

function externalPeer() {
	let title: string | null = "Current authorized task";
	let queryDenied = false;
	let mutationCalls = 0;
	const requests = new Map<number, Request>();
	const received = new Map<
		number,
		ReturnType<typeof Promise.withResolvers<void>>
	>();
	const responses = new Map<
		number,
		ReturnType<typeof Promise.withResolvers<Response>>
	>();
	const pending = (version: number) => {
		if (!received.has(version))
			received.set(version, Promise.withResolvers<void>());
		if (!responses.has(version))
			responses.set(version, Promise.withResolvers<Response>());
		return {
			received: received.get(version)!,
			response: responses.get(version)!,
		};
	};
	const reply = (request: Request, body: object, status = 200) =>
		new Response(
			JSON.stringify({
				callId: request.headers.get(
					request.method === "GET" ? "Questpie-Call-Id" : "Idempotency-Key",
				),
				...body,
			}),
			{
				status,
				headers: { "content-type": "application/json; charset=utf-8" },
			},
		);
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(request) {
			if (request.method === "GET" && queryDenied)
				return reply(
					request,
					{ error: { code: "UNAUTHENTICATED", retryable: false } },
					401,
				);
			if (request.method === "GET")
				return reply(request, {
					result: title === null ? null : { id, title, updatedAt: date },
				});
			const body = await request.json();
			mutationCalls++;
			const version = body.input.expectedVersion;
			requests.set(version, request);
			const command = pending(version);
			command.received.resolve();
			return command.response.promise;
		},
	});
	return {
		baseUrl: server.url.toString(),
		get mutationCalls() {
			return mutationCalls;
		},
		setTitle(value: string | null) {
			title = value;
			queryDenied = false;
		},
		denyQuery() {
			queryDenied = true;
		},
		wait(version: number) {
			return pending(version).received.promise;
		},
		settle(version: number, body: object, status = 200) {
			const request = requests.get(version);
			if (!request) throw new Error("Mutation did not reach the HTTP peer");
			pending(version).response.resolve(reply(request, body, status));
		},
		async close() {
			for (const [version, request] of requests)
				pending(version).response.resolve(
					reply(
						request,
						{
							error: {
								code: "VERSION_CONFLICT",
								payload: { currentVersion: 3 },
							},
						},
						409,
					),
				);
			await server.stop(true);
		},
	};
}

test("pending userland intent follows the current authorized base and disappears when it does", async () => {
	const peer = externalPeer();
	const cache = new QueryClient();
	const adapter = createQueryAdapter(
		createClient({ baseUrl: peer.baseUrl }).withContext({ companyId: id }),
		cache,
	);
	const options = adapter.queries["tasks.detail"].options({ id });
	const query = new QueryObserver(cache, options);
	const transition = new MutationObserver(cache, {
		...adapter.mutations["tasks.transition"].options(),
		onMutate: (variables) => ({ requestedStatus: variables.targetStatus }),
	});
	const stopQuery = query.subscribe(() => {});
	const stopMutation = transition.subscribe(() => {});
	let completion: Promise<unknown> | undefined;
	const view = () => {
		const current = query.getCurrentResult();
		const base = current.isSuccess ? current.data : undefined;
		const pending = transition.getCurrentResult();
		return {
			title: base?.title,
			pending:
				base && pending.isPending && pending.variables.id === base.id
					? pending.variables.targetStatus
					: undefined,
		};
	};
	try {
		await query.refetch();
		completion = transition
			.mutate({ id, expectedVersion: 1, targetStatus: "done" })
			.catch((error: unknown) => error);
		await peer.wait(1);
		expect(view()).toEqual({
			title: "Current authorized task",
			pending: "done",
		});
		expect(cache.getQueryData(options.queryKey)?.title).toBe(
			"Current authorized task",
		);
		peer.setTitle("Newer authorized task");
		await query.refetch();
		expect(view()).toEqual({ title: "Newer authorized task", pending: "done" });
		peer.denyQuery();
		await query.refetch();
		expect(query.getCurrentResult().isError).toBe(true);
		expect(query.getCurrentResult().error).toMatchObject({
			code: "UNAUTHENTICATED",
		});
		expect(cache.getQueryData(options.queryKey)?.title).toBe(
			"Newer authorized task",
		);
		expect(view()).toEqual({ title: undefined, pending: undefined });
		peer.setTitle(null);
		await query.refetch();
		expect(transition.getCurrentResult().isPending).toBe(true);
		expect(view()).toEqual({ title: undefined, pending: undefined });
		peer.settle(
			1,
			{ error: { code: "VERSION_CONFLICT", payload: { currentVersion: 3 } } },
			409,
		);
		expect(await completion).toMatchObject({ code: "VERSION_CONFLICT" });
		expect(cache.getQueryData(options.queryKey)).toBeNull();
		expect(view()).toEqual({ title: undefined, pending: undefined });
	} finally {
		await peer.close();
		await completion;
		stopQuery();
		stopMutation();
		query.destroy();
		transition.reset();
		await adapter.dispose();
		cache.clear();
	}
});

test("one rejected pending transition never restores a cache snapshot over another successful edit", async () => {
	const peer = externalPeer();
	const cache = new QueryClient();
	const adapter = createQueryAdapter(
		createClient({ baseUrl: peer.baseUrl }).withContext({ companyId: id }),
		cache,
	);
	const options = adapter.queries["tasks.detail"].options({ id });
	const query = new QueryObserver(cache, options);
	const operation = adapter.mutations["tasks.transition"];
	let rejectedIntent: string | undefined;
	const first = new MutationObserver(cache, {
		...operation.options(),
		onMutate: (variables) => ({ requestedStatus: variables.targetStatus }),
		onError: (error, _variables, intent) => {
			if (operation.isError(error)) rejectedIntent = intent?.requestedStatus;
		},
	});
	const second = new MutationObserver(cache, operation.options());
	const stop = query.subscribe(() => {});
	let pendingFirst: Promise<unknown> | undefined;
	let pendingSecond: Promise<unknown> | undefined;
	try {
		await query.refetch();
		pendingFirst = first
			.mutate({ id, expectedVersion: 1, targetStatus: "done" })
			.catch((error: unknown) => error);
		await peer.wait(1);
		pendingSecond = second
			.mutate({ id, expectedVersion: 2, targetStatus: "review" })
			.catch((error: unknown) => error);
		await peer.wait(2);
		expect(first.getCurrentResult().isPending).toBe(true);
		expect(second.getCurrentResult().isPending).toBe(true);
		peer.setTitle("Another successful edit");
		peer.settle(2, {
			result: { id, title: "Another successful edit", updatedAt: date },
		});
		await pendingSecond;
		await query.refetch();
		expect(query.getCurrentResult().data?.title).toBe(
			"Another successful edit",
		);
		peer.settle(
			1,
			{ error: { code: "VERSION_CONFLICT", payload: { currentVersion: 3 } } },
			409,
		);
		expect(await pendingFirst).toMatchObject({ code: "VERSION_CONFLICT" });
		expect(rejectedIntent).toBe("done");
		expect(first.getCurrentResult().isPending).toBe(false);
		expect(cache.getQueryData(options.queryKey)?.title).toBe(
			"Another successful edit",
		);
		expect(peer.mutationCalls).toBe(2);
	} finally {
		await peer.close();
		await Promise.all([pendingFirst, pendingSecond]);
		stop();
		query.destroy();
		first.reset();
		second.reset();
		await adapter.dispose();
		cache.clear();
	}
});

test("pending callback context ends with its native observer while already disclosed application copies survive", async () => {
	const peer = externalPeer();
	const cache = new QueryClient();
	const adapter = createQueryAdapter(
		createClient({ baseUrl: peer.baseUrl }).withContext({ companyId: id }),
		cache,
	);
	const callbackEntered = Promise.withResolvers<void>();
	const callbackRelease = Promise.withResolvers<void>();
	let applicationCopy: string | undefined;
	let settledIntent: string | undefined;
	const transition = new MutationObserver(cache, {
		...adapter.mutations["tasks.transition"].options(),
		onMutate: (variables) => ({ requestedStatus: variables.targetStatus }),
		onSuccess: async (result, _variables, intent) => {
			applicationCopy = result.title;
			settledIntent = intent.requestedStatus;
			callbackEntered.resolve();
			await callbackRelease.promise;
		},
	});
	const stop = transition.subscribe(() => {});
	let completion: Promise<unknown> | undefined;
	try {
		completion = transition
			.mutate({ id, expectedVersion: 1, targetStatus: "done" })
			.catch((error: unknown) => error);
		await peer.wait(1);
		expect(transition.getCurrentResult().context).toEqual({
			requestedStatus: "done",
		});
		expect(transition.getCurrentResult().data).toBeUndefined();
		peer.settle(1, {
			result: { id, title: "Committed result", updatedAt: date },
		});
		await callbackEntered.promise;
		expect(transition.getCurrentResult().isPending).toBe(true);
		expect(transition.getCurrentResult().data).toBeUndefined();
		expect(applicationCopy).toBe("Committed result");
		expect(settledIntent).toBe("done");
		await adapter.dispose();
		expect(transition.getCurrentResult()).toMatchObject({
			isIdle: true,
			data: undefined,
			variables: undefined,
			context: undefined,
		});
		callbackRelease.resolve();
		await completion;
		expect(transition.getCurrentResult().isIdle).toBe(true);
		expect(applicationCopy).toBe("Committed result");
		expect(cache.getMutationCache().getAll()).toHaveLength(0);
	} finally {
		callbackRelease.resolve();
		await peer.close();
		await completion;
		stop();
		transition.reset();
		await adapter.dispose();
		cache.clear();
	}
});

for (const failure of ["known-commit", "unknown"] as const) {
	test(`${failure} Mutation failure is not evidence to restore an earlier authorized base`, async () => {
		const peer = externalPeer();
		const cache = new QueryClient();
		const adapter = createQueryAdapter(
			createClient({ baseUrl: peer.baseUrl }).withContext({ companyId: id }),
			cache,
		);
		const options = adapter.queries["tasks.detail"].options({ id });
		const query = new QueryObserver(cache, options);
		const transition = new MutationObserver(
			cache,
			adapter.mutations["tasks.transition"].options(),
		);
		const stop = query.subscribe(() => {});
		let completion: Promise<unknown> | undefined;
		try {
			await query.refetch();
			completion = transition
				.mutate({ id, expectedVersion: 1, targetStatus: "done" })
				.catch((error: unknown) => error);
			await peer.wait(1);
			peer.setTitle(null);
			await query.refetch();
			peer.settle(
				1,
				failure === "known-commit"
					? {
							error: {
								code: "COMMITTED_RESULT_UNAVAILABLE",
								retryable: true,
								transactionId: "17",
							},
						}
					: { unexpected: "No usable Operation outcome" },
				500,
			);
			const outcome = await completion;
			if (failure === "known-commit")
				expect(outcome).toMatchObject({ code: "COMMITTED_RESULT_UNAVAILABLE" });
			else {
				expect(outcome).toBeInstanceOf(Error);
				expect(outcome instanceof Error ? outcome.message : undefined).toBe(
					"PROTOCOL_UNSUPPORTED",
				);
			}
			expect(transition.getCurrentResult().isPending).toBe(false);
			expect(transition.getCurrentResult().data).toBeUndefined();
			expect(cache.getQueryData(options.queryKey)).toBeNull();
			expect(peer.mutationCalls).toBe(1);
		} finally {
			await peer.close();
			await completion;
			stop();
			query.destroy();
			transition.reset();
			await adapter.dispose();
			cache.clear();
		}
	});
}
