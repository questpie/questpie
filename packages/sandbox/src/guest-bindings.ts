/**
 * Guest bindings proxy — the UNTRUSTED-side typed surface a sandboxed mini-app
 * uses to call the app's primitives WITHOUT importing the app.
 *
 * Design: `.private/knowledge-miniapps-mvp.md` §13 (TRUSTED vs UNTRUSTED) + §14
 * (the primitive surface). Mirrors the server `ctx` names (consistent-naming
 * principle) so guest code reads like a server handler:
 *
 *   const orders = await globalThis.questpie.collections.orders.find({ where });
 *   const note   = await globalThis.questpie.knowledge.read({ path });
 *
 * Every method just does `await hostCall(method, args)`. `hostCall` is INJECTED
 * (it writes a framed RPC to the supervisor over stdio and awaits the brokered
 * result) — this module holds NO transport and NO secrets, so it is pure and
 * unit-testable with a fake `hostCall`. The guest never sees the per-run token
 * or a broker URL; the only thing it can do is call these methods, which the
 * trusted host broker enforces per call (default-deny).
 *
 * This file is plain TS (no Deno globals) so it typechecks + unit-tests in Bun;
 * `guest-entry.ts` (Deno) imports it and supplies the real stdio `hostCall`.
 */

/** Transport: send one binding RPC, resolve with its brokered value or reject. */
export type HostCall = (method: string, args: unknown) => Promise<unknown>;

/** Read-query surface for a single collection (MVP). */
export interface GuestCollection {
	find(args?: unknown): Promise<unknown>;
	findOne(args?: unknown): Promise<unknown>;
}

/** The `globalThis.questpie` surface handed to untrusted guest code. */
export interface GuestBindings {
	/** Knowledge (file-as-DB), scoped by the run's `capabilities.knowledge`. */
	knowledge: {
		read(args: { path: string; scope?: unknown }): Promise<unknown>;
		write(args: {
			path: string;
			content: string;
			title?: string;
			mime_type?: string;
			scope?: unknown;
		}): Promise<unknown>;
		list(args?: { path?: string; scope?: unknown }): Promise<unknown>;
	};
	/** Per-collection read access, scoped by `capabilities.data.collections`. */
	collections: Record<string, GuestCollection>;
}

/**
 * Build the guest bindings proxy over an injected {@link HostCall}.
 *
 * `collections` is a Proxy so any collection NAME resolves to a `{ find,
 * findOne }` shim — capability enforcement for the specific collection happens
 * HOST-SIDE in the broker (the guest can't pre-know which names are granted, and
 * the proxy must not leak that). An out-of-scope collection call simply rejects
 * when the host denies it.
 */
export function buildGuestBindings(hostCall: HostCall): GuestBindings {
	const knowledge: GuestBindings["knowledge"] = {
		read: (args) => hostCall("knowledge.read", args),
		write: (args) => hostCall("knowledge.write", args),
		list: (args) => hostCall("knowledge.list", args ?? {}),
	};

	const collections = new Proxy(
		{},
		{
			get(_t, name: string | symbol): GuestCollection | undefined {
				if (typeof name !== "string") return undefined;
				return {
					find: (args) => hostCall(`collections.${name}.find`, args ?? {}),
					findOne: (args) =>
						hostCall(`collections.${name}.findOne`, args ?? {}),
				};
			},
		},
	) as Record<string, GuestCollection>;

	return { knowledge, collections };
}
