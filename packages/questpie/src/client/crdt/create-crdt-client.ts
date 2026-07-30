/**
 * `createCrdtClient(client)` — the explicit way to get a CRDT API.
 *
 * It takes the client you already built and reuses its realtime session, so a
 * collaborative app still holds exactly one SSE/Pusher connection. Nothing here
 * opens a second one.
 *
 * This replaces the old `client.crdt` member. `createClient()` constructed the
 * CRDT API eagerly, which meant the whole client-side CRDT implementation
 * (~164 KB) landed in every browser bundle regardless of whether the app opened
 * a document. Making it a separate factory in a separate entrypoint is what
 * takes it off the default path — export reshuffling alone could not, because
 * the coupling was a real call inside `createClient()`.
 */

import type {
	CrdtClientAPI,
	CrdtRegistryShape,
} from "../../server/modules/core/integrated/crdt/types.js";
import { readCrdtClientHost } from "../crdt-host.js";
import type { QuestpieApp, QuestpieClient } from "../index.js";
import { createCrdtClientAPI } from "./index.js";
import type { CrdtClientRuntimeConfig } from "./types.js";

/**
 * The CRDT registry for an app, with the same fallback `client.crdt` used to
 * apply — so migrating a call site is a rename, not a retyping exercise.
 */
type CrdtRegistryFor<TApp extends QuestpieApp> =
	NonNullable<TApp["crdt"]> extends CrdtRegistryShape
		? NonNullable<TApp["crdt"]>
		: { collections: {}; globals: {} };

export interface CreateCrdtClientOptions {
	/**
	 * Overrides whatever was passed as `createClient({ crdt })`. Omit to inherit
	 * the client's own configuration.
	 */
	runtime?: CrdtClientRuntimeConfig;
}

/**
 * Build a CRDT API on top of an existing Questpie client.
 *
 * ```ts
 * import { createClient } from "questpie/client";
 * import { createCrdtClient } from "questpie/crdt";
 *
 * const client = createClient({ baseURL });
 * const crdt = createCrdtClient(client);
 *
 * const article = crdt.collections.articles.document({ id: articleId });
 * ```
 *
 * Calling it more than once on the same client yields independent API objects
 * that share the client's connection — cheap, but prefer building it once and
 * passing it around, so document coordination stays in one coordinator.
 */
export function createCrdtClient<TApp extends QuestpieApp>(
	client: QuestpieClient<TApp>,
	options?: CreateCrdtClientOptions,
): CrdtClientAPI<CrdtRegistryFor<TApp>> {
	const host = readCrdtClientHost(client);
	return createCrdtClientAPI({
		baseURL: host.baseURL,
		basePath: host.basePath,
		fetcher: host.fetcher,
		defaultHeaders: host.defaultHeaders,
		getAuthHeaders: host.getAuthHeaders,
		realtimeSession: host.realtimeSession,
		exchange: host.exchange,
		runtime: options?.runtime ?? host.runtime,
	}) as CrdtClientAPI<CrdtRegistryFor<TApp>>;
}
