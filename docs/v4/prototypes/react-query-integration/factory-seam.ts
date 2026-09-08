import type { QueryClient } from "@tanstack/query-core";

import { type ClientScope, readClientScope } from "./factory-seam-contract";
import type { Projection } from "./projection-contract";
import { bindProjection, type BindingOptions } from "./query-adapter";

/** Candidate public factory; the descriptor remains an internal concern. */
export function createQueryAdapter<Source extends Projection>(
	scope: ClientScope<Source>,
	cache: QueryClient,
	options?: BindingOptions,
): ReturnType<typeof bindProjection<Source>> {
	return bindProjection(readClientScope(scope), cache, options);
}
