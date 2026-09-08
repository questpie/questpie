import { MutationObserver, QueryClient } from "@tanstack/query-core";

import { createClient } from "./generated/client";
import { createQueryAdapter } from "./generated/client.react-query";

// Compare the candidate's retirement fence with native cache cleanup alone.
// This diagnostic is not an acceptance gate; mutation-lifetime.test.ts asserts it.
const id = "018f5f6e-5f2c-7b41-a854-3d9a6b6b7131";
async function inspect(mode: "dispose" | "remove" | "reset-and-remove") {
	const received = Promise.withResolvers<Request>();
	const response = Promise.withResolvers<Response>();
	const client = createClient({
		baseUrl: "https://proof.invalid",
		fetch: (async (request: Request) => {
			received.resolve(request);
			return response.promise;
		}) as typeof fetch,
	});
	const cache = new QueryClient();
	const adapter = createQueryAdapter(
		client.withContext({ companyId: id }),
		cache,
	);
	let callbacksAfterRetirement = 0;
	let retired = false;
	const observer = new MutationObserver(cache, {
		...adapter.mutations["tasks.transition"].options(),
		onSuccess: () => {
			if (retired) callbacksAfterRetirement++;
		},
	});
	const unsubscribe = observer.subscribe(() => {});
	const completion = observer
		.mutate({
			id,
			expectedVersion: 1,
			targetStatus: "done",
		})
		.then(
			(result) => ({ kind: "result" as const, result }),
			(error: unknown) => ({ kind: "error" as const, error }),
		);
	try {
		const request = await received.promise;
		if (mode === "dispose") await adapter.dispose();
		retired = true;
		if (mode === "reset-and-remove") observer.reset();
		if (mode !== "dispose") {
			for (const mutation of cache.getMutationCache().getAll()) {
				cache.getMutationCache().remove(mutation);
			}
		}
		response.resolve(
			new Response(
				JSON.stringify({
					callId: request.headers.get("Idempotency-Key"),
					result: {
						id,
						title: "Old authority result",
						updatedAt: "2026-09-08T10:00:00.000Z",
					},
				}),
				{ headers: { "content-type": "application/json; charset=utf-8" } },
			),
		);
		const result = await completion;
		return {
			mode,
			observerExposesLateResult:
				observer.getCurrentResult().data?.title === "Old authority result",
			completionExposesLateResult:
				result.kind === "result" &&
				result.result.title === "Old authority result",
			completionRejected: result.kind === "error",
			callbacksAfterRetirement,
			retainedMutations: cache.getMutationCache().getAll().length,
		};
	} finally {
		unsubscribe();
		observer.reset();
		await adapter.dispose();
		cache.clear();
	}
}

const observations = [];
for (const mode of ["dispose", "remove", "reset-and-remove"] as const) {
	observations.push(await inspect(mode));
}
console.log(
	JSON.stringify(
		{
			diagnostic: "pending-mutation-retirement",
			acceptance: false,
			observations,
		},
		null,
		2,
	),
);
