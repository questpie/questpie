import type { QueryClient } from "@tanstack/query-core";

import type { GeneratedClientScope } from "./generated/client";
import { createQueryAdapter } from "./generated/client.react-query";

// Compile-only consumer: input/output come from the generated client, not DTOs.
export function consume(
	scope: GeneratedClientScope,
	cache: QueryClient,
	error: unknown,
) {
	const adapter = createQueryAdapter(scope, cache);
	const options = adapter.queries["tasks.detail"].options({
		id: "example",
		asOf: new Date(),
	});
	const cached = cache.getQueryData(options.queryKey);
	const sameOutput:
		| Awaited<ReturnType<(typeof scope.queries)["tasks.detail"]>>
		| undefined = cached;
	if (cached) {
		const timestamp: Date = cached.updatedAt;
		// @ts-expect-error generated timestamp output is a Date, not wire text
		const wireText: string = cached.updatedAt;
		void timestamp;
		void wireText;
	}
	adapter.queries["tasks.detail"].options({
		id: "example",
		// @ts-expect-error input codec requires a Date, not a wire string
		asOf: "2026-09-08",
	});
	// @ts-expect-error no handwritten operation alias is admitted
	adapter.queries["tasks.missing"].options({ id: "example" });
	// @ts-expect-error arbitrary transport failure has no declared payload yet
	error.payload.currentVersion;
	const mutation = adapter.mutations["tasks.transition"];
	if (mutation.isError(error)) {
		const code: "VERSION_CONFLICT" = error.code;
		const currentVersion: number = error.payload.currentVersion;
		// @ts-expect-error exact generated error payload cannot become text
		const textVersion: string = error.payload.currentVersion;
		void code;
		void currentVersion;
		void textVersion;
	}
	// @ts-expect-error no Action/Job integration is claimed by this prototype
	adapter.actions;
	return sameOutput;
}
