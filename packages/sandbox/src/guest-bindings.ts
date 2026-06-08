/**
 * Guest bindings proxy — the UNTRUSTED-side typed surface a sandboxed mini-app
 * uses to call the app's primitives WITHOUT importing the app.
 *
 * Design: `.private/knowledge-miniapps-mvp.md` §13 (TRUSTED vs UNTRUSTED) + §14
 * (the primitive surface). Mirrors the server `ctx` names (consistent-naming
 * principle) so guest code reads like a server handler:
 *
 *   const orders = await globalThis.questpie.collections.orders.find({ where });
 *   const note   = await globalThis.questpie.files.read({ path });
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

/**
 * Per-collection access surface. Reads (`find`/`findOne`) are always available;
 * writes (`create`/`update`/`delete`) are dispatched ONLY where the host wires a
 * safe handler (the `document_store` store-grant clamp, or a collection with an
 * explicit write rule — Decision 8 / §7). An ungranted/unwired call rejects host-side.
 */
export interface GuestCollection {
	find(args?: unknown): Promise<unknown>;
	findOne(args?: unknown): Promise<unknown>;
	create(args?: unknown): Promise<unknown>;
	update(args?: unknown): Promise<unknown>;
	delete(args?: unknown): Promise<unknown>;
}

/**
 * Sugar surface for ONE `document_store` namespace. Every op auto-injects
 * `store: <name>`; the host still clamps to the run's granted stores (the sugar is
 * a convenience, NOT a second enforcement path — `questpie.store.posts.create(x)`
 * is exactly `questpie.collections.document_store.create({ ...x, store:"posts" })`).
 */
export interface GuestStore {
	find(args?: Record<string, unknown>): Promise<unknown>;
	findOne(args?: Record<string, unknown>): Promise<unknown>;
	create(args: { key: string; data?: unknown }): Promise<unknown>;
	update(args: {
		where?: unknown;
		data?: Record<string, unknown>;
	}): Promise<unknown>;
	delete(args?: { where?: unknown }): Promise<unknown>;
}

/** The `globalThis.questpie` surface handed to untrusted guest code. */
export interface GuestBindings {
	/** Files (file-as-DB), scoped by the run's `capabilities.files`. */
	files: {
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
	/** Per-collection read/write access, scoped by `capabilities.data.collections`. */
	collections: Record<string, GuestCollection>;
	/**
	 * Per-namespace `document_store` sugar, scoped by `capabilities.data.stores`.
	 * `questpie.store.<name>.<op>` injects `store:<name>` onto the underlying
	 * `collections.document_store.<op>` call.
	 */
	store: Record<string, GuestStore>;
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
	const files: GuestBindings["files"] = {
		read: (args) => hostCall("files.read", args),
		write: (args) => hostCall("files.write", args),
		list: (args) => hostCall("files.list", args ?? {}),
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
					create: (args) => hostCall(`collections.${name}.create`, args ?? {}),
					update: (args) => hostCall(`collections.${name}.update`, args ?? {}),
					delete: (args) => hostCall(`collections.${name}.delete`, args ?? {}),
				};
			},
		},
	) as Record<string, GuestCollection>;

	// `store.<name>` sugar → `collections.document_store.<op>` scoped to ONE store.
	// CREATE injects a top-level `store` (the row field the host stamps/validates);
	// FIND/UPDATE/DELETE inject `where.store` (so the call targets only that store —
	// the host then ANDs it with `store ∈ granted`). Enforcement stays HOST-SIDE
	// (the store-grant clamp); this is a pure convenience, so an ungranted store
	// still rejects host-side.
	const store = new Proxy(
		{},
		{
			get(_t, name: string | symbol): GuestStore | undefined {
				if (typeof name !== "string") return undefined;
				const withStoreWhere = (args: Record<string, unknown>) => {
					const where =
						args.where && typeof args.where === "object"
							? { ...(args.where as Record<string, unknown>), store: name }
							: { store: name };
					return { ...args, where };
				};
				const ds = (op: string, args: unknown) =>
					hostCall(`collections.document_store.${op}`, args);
				return {
					find: (args = {}) => ds("find", withStoreWhere(args)),
					findOne: (args = {}) => ds("findOne", withStoreWhere(args)),
					create: (args) => ds("create", { ...(args ?? {}), store: name }),
					update: (args) => ds("update", withStoreWhere(args ?? {})),
					delete: (args = {}) => ds("delete", withStoreWhere(args)),
				};
			},
		},
	) as Record<string, GuestStore>;

	return { files, collections, store };
}
