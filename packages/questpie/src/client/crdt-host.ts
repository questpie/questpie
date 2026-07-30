/**
 * The seam between `createClient()` and the CRDT client.
 *
 * This module exists so `client/index.ts` can hand the CRDT factory everything
 * it needs WITHOUT importing any CRDT implementation code. It carries a symbol
 * and two types — nothing that survives to the bundle beyond the symbol itself.
 *
 * Why the indirection: `createClient()` used to call `createCrdtClientAPI()`
 * directly, which pulled the entire 164 KB client-side CRDT implementation into
 * every browser bundle. That is not tree-shakeable — `sideEffects: false` is
 * already declared and `dist/client.mjs` is a 1.4 KB re-export barrel, but
 * neither helps when the coupling is a real call site. Measured before the
 * change: importing only `createClient` produced a 639,619-byte bundle;
 * additionally importing `createCrdtClientAPI` produced 639,649 — a 30-byte
 * difference, i.e. CRDT was present either way.
 *
 * The realtime session is passed through rather than re-created, so a CRDT
 * client still shares the single SSE/Pusher connection the app already has.
 * Opening a second one would break the "one realtime connection" invariant the
 * realtime-v3 work was built around.
 */

import type {
	CrdtClientExchangePort,
	CrdtClientRealtimeSessionPort,
	CrdtClientRuntimeConfig,
} from "./crdt/types.js";

/**
 * Where `createClient()` parks the handle below. A registered symbol keeps it
 * off the public type surface and out of `Object.keys`/spread, while staying
 * readable across module instances.
 */
export const CRDT_CLIENT_HOST = Symbol.for("questpie.crdt.clientHost");

/**
 * Everything `createCrdtClient()` needs from an existing client. Mirrors the
 * subset of `CrdtClientHostConfig` that `createClient()` can supply; the caller
 * adds `runtime` on top.
 */
export type CrdtClientHostHandle = Readonly<{
	baseURL: string;
	basePath: string;
	fetcher: typeof fetch;
	defaultHeaders?: Readonly<Record<string, string>>;
	getAuthHeaders?: () =>
		| Record<string, string>
		| undefined
		| Promise<Record<string, string> | undefined>;
	realtimeSession?: CrdtClientRealtimeSessionPort;
	/** Whatever the app passed as `createClient({ crdt })`, used as the default. */
	runtime?: CrdtClientRuntimeConfig;
	/** @internal Test/deep-module injection. */
	exchange?: CrdtClientExchangePort;
}>;

/** A client carrying the handle. Structural, so no import cycle. */
export type CrdtClientHostCarrier = {
	[CRDT_CLIENT_HOST]?: CrdtClientHostHandle;
};

/**
 * Read the handle off a client, or explain precisely what went wrong. The
 * failure mode this guards is a client from a different `questpie` copy (two
 * versions in the tree), where the registered symbol matches but the handle was
 * never attached.
 */
export function readCrdtClientHost(client: unknown): CrdtClientHostHandle {
	const handle = (client as CrdtClientHostCarrier | null)?.[CRDT_CLIENT_HOST];
	if (!handle) {
		throw new Error(
			"createCrdtClient() expects a client built by questpie's createClient(). " +
				"The value passed in carries no CRDT host handle — check that it is the " +
				"client itself (not a wrapper or a plain object), and that only one copy " +
				"of `questpie` is installed.",
		);
	}
	return handle;
}
