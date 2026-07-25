/**
 * Sandbox bindings broker — the TRUSTED host side of the untrusted bindings path.
 *
 * Design: `.private/knowledge-miniapps-mvp.md` §13 + §14.
 *
 * Responsibilities (and ONLY these — it is generic framework infra, app-agnostic):
 *   1. MINT a short-lived, opaque per-run token mapped server-side to that run's
 *      {@link ExecutorCapabilities} + a bound primitive {@link BindingTarget}.
 *      The token is opaque (a random string) → the guest can never forge or
 *      widen scope; it never even sees the token (the supervisor holds it).
 *   2. AUTHENTICATE an incoming RPC by token (unknown/expired → `unauthorized`).
 *   3. ENFORCE capabilities PER CALL via {@link checkBindingCapability}
 *      (default-deny) — BEFORE any dispatch.
 *   4. DISPATCH the in-scope call to the bound target (the same business logic
 *      the discrete MCP/knowledge tools use — supplied by the caller, NOT
 *      duplicated here) and return a structured result/error.
 *
 * The broker does NOT import the app, build `ctx`, or know about Knowledge
 * specifics — the mini-app RUNNER builds the scoped {@link BindingTarget} from
 * the real `ctx` (mirroring `buildCodeModeApi`) and registers it here when the
 * run starts. That keeps capability enforcement reusable + unit-testable with a
 * fake target, while live runs execute against the real primitives.
 */

import type { ExecutorCapabilities } from "../adapter.js";
import {
	checkBindingCapability,
	isHttpHostAllowed,
} from "./capability-check.js";
import { type HostFetchOptions, hostFetch } from "./host-fetch.js";
import {
	type BindingError,
	type BrokerRpcResponse,
	BROKER_HTTP_RESULT_CAP_BYTES,
	BROKER_NATIVE_RESULT_CAP_BYTES,
	type HttpFetchRequest,
	parseBindingMethod,
	snapshotBoundedBrokerValue,
} from "./protocol.js";

/**
 * The primitive surface the broker dispatches in-scope calls to. The runner
 * builds this from `ctx`, scoped to the run (mirrors the code-mode API).
 *
 * MVP dispatch surface — handlers are OPTIONAL: a method that is in-scope but
 * has no handler resolves to `not_implemented` (honest deferral, not a silent
 * allow). Capability ENFORCEMENT already happened before dispatch, so an absent
 * handler never widens access.
 */
export interface BindingTarget {
	files?: {
		read?(args: unknown): Promise<unknown>;
		write?(args: unknown): Promise<unknown>;
		list?(args: unknown): Promise<unknown>;
	};
	/**
	 * Per-collection accessor mirroring the binding op vocabulary
	 * (`collections.<name>.<op>`). The broker dispatches the read half
	 * (`find`/`findOne`) AND the write half (`create`/`update`/`delete`) — but ONLY
	 * to a handler the TARGET actually wires. The §7 tenant-write boundary
	 * (`mini-app-bindings.ts`) wires the write half ONLY where it is safe: the
	 * `document_store` namespaced row-filter clamp, and an OTHER collection that has
	 * its OWN explicit `.access().create/update/delete` rule (never the rule-less
	 * `!!session` fallback). Any in-scope write whose target wires no handler still
	 * resolves to `not_implemented` (fail-closed) — capability ENFORCEMENT already
	 * ran before dispatch, so an absent handler never widens access.
	 *
	 * The op names are the BINDING ops, not the underlying `ctx` CRUD names: the
	 * runner maps `update`→by-`where` update and `delete`→by-`where` delete when it
	 * builds the target (see the mini-app bindings runner), so the broker never
	 * needs to know the real CRUD signatures.
	 */
	collections?: Record<
		string,
		{
			find?(args: unknown): Promise<unknown>;
			findOne?(args: unknown): Promise<unknown>;
			create?(args: unknown): Promise<unknown>;
			update?(args: unknown): Promise<unknown>;
			delete?(args: unknown): Promise<unknown>;
		}
	>;
	/**
	 * Per-global accessor mirroring the binding op vocabulary
	 * (`globals.<name>.<op>`): `get` (read) + `set` (write). The broker dispatches
	 * ONLY `get`; `set` returns `not_implemented` (it rides the same deferred §7
	 * write boundary as collection writes). As with collections the op names are
	 * the BINDING ops. Handlers are OPTIONAL.
	 */
	globals?: Record<
		string,
		{
			get?(args: unknown): Promise<unknown>;
			set?(args: unknown): Promise<unknown>;
		}
	>;
	/**
	 * Brokered HTTP egress (`http.fetch`). UNLIKE the other families, the dispatch
	 * is TRUSTED HOST LOGIC, not a per-run business handler: the broker always
	 * runs the SSRF-safe {@link hostFetch} (resolve → validate ALL ips → pin →
	 * re-validate every redirect) — the per-app `net` allowlist was already
	 * enforced by the capability check. This member only supplies OPTIONS to that
	 * fetch (e.g. an injected DNS resolver for tests, or per-run timeout/redirect
	 * tuning). Absent → safe defaults. There is no way to wire a handler that
	 * BYPASSES the pin; the broker never calls a guest-supplied fetch function.
	 */
	http?: {
		/** Options forwarded to {@link hostFetch} (resolver, timeout, caps). */
		fetchOptions?: HostFetchOptions;
	};
}

/** A registered run: its capability scope, bound target, and expiry. */
interface RunRecord {
	capabilities: ExecutorCapabilities;
	target: BindingTarget;
	/** Epoch ms after which the token is rejected. */
	expiresAt: number;
}

/** Options when minting a per-run token. */
export interface MintTokenOptions {
	capabilities: ExecutorCapabilities;
	target: BindingTarget;
	/** Token lifetime (ms). Defaults to {@link SandboxBroker.DEFAULT_TTL_MS}. */
	ttlMs?: number;
}

/** A minted token + its revoke handle. */
export interface MintedToken {
	token: string;
	/** Revoke immediately (call when the run ends). Idempotent. */
	revoke(): void;
}

export interface SandboxBrokerDiagnosticEvent {
	readonly correlationId: string;
	readonly reason: "target_failed" | "invalid_result";
	/** Trusted-only raw failure; never copied into the broker response. */
	readonly error?: unknown;
}

export interface SandboxBrokerOptions {
	readonly mintToken?: () => string;
	readonly onDiagnostic?: (
		event: SandboxBrokerDiagnosticEvent,
	) => void | Promise<void>;
}

function brokerError(
	code: BindingError["code"],
	message: string,
	correlationId?: string,
): { ok: false; error: BindingError } {
	return {
		ok: false,
		error: { code, message, ...(correlationId ? { correlationId } : {}) },
	};
}

/**
 * In-memory per-run token broker. One instance per app process (created by the
 * executor service). Tokens live only in this process's memory — they are never
 * persisted and never leave the trusted host, so an opaque token leak is bounded
 * to a single short-lived run's already-declared scope.
 */
export class SandboxBroker {
	/** Default per-run token lifetime. */
	static readonly DEFAULT_TTL_MS = 5 * 60_000;

	private readonly runs = new Map<string, RunRecord>();
	private readonly mintToken: () => string;
	private readonly onDiagnostic?: SandboxBrokerOptions["onDiagnostic"];

	/**
	 * @param mintToken - Token generator. Defaults to a CSPRNG hex string. Inject
	 *   a deterministic generator in tests.
	 */
	constructor(options?: (() => string) | SandboxBrokerOptions) {
		this.mintToken =
			typeof options === "function"
				? options
				: (options?.mintToken ?? defaultTokenFactory);
		this.onDiagnostic =
			typeof options === "function" ? undefined : options?.onDiagnostic;
	}

	/** Number of live (registered, not yet revoked) runs — for tests/metrics. */
	get size(): number {
		return this.runs.size;
	}

	/**
	 * Mint a per-run scoped token. Returns the opaque token and a `revoke()` to
	 * call when the run ends. The token maps (server-side only) to the run's
	 * capabilities + bound primitive target.
	 */
	mint(options: MintTokenOptions): MintedToken {
		const ttl = options.ttlMs ?? SandboxBroker.DEFAULT_TTL_MS;
		// Avoid an astronomically small chance of collision by re-rolling.
		let token = this.mintToken();
		while (this.runs.has(token)) token = this.mintToken();

		this.runs.set(token, {
			capabilities: options.capabilities,
			target: options.target,
			expiresAt: Date.now() + ttl,
		});

		let revoked = false;
		return {
			token,
			revoke: () => {
				if (revoked) return;
				revoked = true;
				this.runs.delete(token);
			},
		};
	}

	/** Look up a run by token, evicting it if expired. `null` = unauthorized. */
	private resolve(token: string | undefined | null): RunRecord | null {
		if (typeof token !== "string" || token.length === 0) return null;
		const rec = this.runs.get(token);
		if (!rec) return null;
		if (Date.now() >= rec.expiresAt) {
			this.runs.delete(token);
			return null;
		}
		return rec;
	}

	/**
	 * Handle one binding RPC: authenticate → enforce capability → dispatch.
	 * NEVER throws — a guest call always yields a structured {@link BrokerRpcResponse}.
	 *
	 * This is the single chokepoint the HTTP endpoint and any direct caller use,
	 * so the default-deny check can NOT be bypassed.
	 */
	async handleRpc(
		token: string | undefined | null,
		method: string,
		args: unknown,
	): Promise<BrokerRpcResponse> {
		// 1. AUTH.
		const run = this.resolve(token);
		if (!run) {
			return brokerError("unauthorized", "invalid or expired sandbox token");
		}

		// 2. ENFORCE (default-deny) — before any dispatch.
		const decision = checkBindingCapability(method, args, run.capabilities);
		if (!decision.allowed) {
			// Distinguish a malformed method from an in-scope-but-forbidden call.
			const parsed = parseBindingMethod(method);
			return brokerError(
				parsed ? "forbidden" : "bad_method",
				decision.reason ?? "denied by capability scope",
			);
		}

		// 3. DISPATCH to the bound primitive surface (files + collection reads/writes +
		//    globals.get). Guest collection WRITES (create/update/delete) are dispatched
		//    ONLY where the §7 tenant-write boundary wired a handler (document_store via
		//    the store-grant clamp, or an OTHER collection with an explicit write rule);
		//    an unwired write still resolves to `not_implemented` (fail-closed).
		//    `globals.set` stays DENIED outright (no per-tenant boundary for a singleton).
		//    In-scope methods without a handler are an honest deferral.
		const parsed = parseBindingMethod(method);
		// `parsed` is non-null here (the check passed), but guard for the type.
		if (!parsed) {
			return brokerError("bad_method", "unrecognized method");
		}

		try {
			const result = await this.dispatch(
				parsed,
				args,
				run.target,
				run.capabilities,
			);
			if (!result.ok) return result;
			const normalized = snapshotBoundedBrokerValue(
				result.value,
				parsed.kind === "http"
					? BROKER_HTTP_RESULT_CAP_BYTES
					: BROKER_NATIVE_RESULT_CAP_BYTES,
			);
			if (!normalized.ok) {
				return this.executionError("invalid_result");
			}
			return { ok: true, value: normalized.value };
		} catch (err) {
			return this.executionError("target_failed", err);
		}
	}

	private executionError(
		reason: SandboxBrokerDiagnosticEvent["reason"],
		error?: unknown,
	): BrokerRpcResponse {
		const correlationId = crypto.randomUUID();
		if (this.onDiagnostic) {
			Promise.resolve(
				this.onDiagnostic(
					Object.freeze({
						correlationId,
						reason,
						...(error !== undefined ? { error } : {}),
					}),
				),
			).catch(() => undefined);
		}
		return brokerError(
			"execution_error",
			reason === "invalid_result"
				? "sandbox binding result is invalid"
				: "sandbox binding operation failed",
			correlationId,
		);
	}

	/** Route an ALREADY-AUTHORIZED call to the bound target. */
	private async dispatch(
		parsed: NonNullable<ReturnType<typeof parseBindingMethod>>,
		args: unknown,
		target: BindingTarget,
		caps: ExecutorCapabilities,
	): Promise<BrokerRpcResponse> {
		if (parsed.kind === "files") {
			const fn = target.files?.[parsed.op];
			if (!fn) {
				return brokerError(
					"not_implemented",
					`files.${parsed.op} has no host handler`,
				);
			}
			return { ok: true, value: await fn(args ?? {}) };
		}

		if (parsed.kind === "collection") {
			// Read ops (`find/findOne`) AND write ops (`create/update/delete`). The
			// per-call capability check (default-deny) ran in `handleRpc` BEFORE this
			// method, so an ungranted collection/verb never reaches the target. Writes
			// are dispatched ONLY to a handler the §7 tenant-write boundary actually
			// wired (`mini-app-bindings.ts`): `document_store` through its store-grant
			// row-filter clamp, or an OTHER collection that has its own explicit
			// `.access().create/update/delete` rule. A collection that relies on the
			// rule-less `!!session` fallback gets NO write handler, so its write here
			// falls through to `not_implemented` below (fail-closed — the WS-2 critical).
			//
			// Own-property lookup so a `__proto__`/`constructor` name can never reach
			// up the prototype chain (the capability check already denied it, but the
			// dispatch target stays prototype-safe too — defense in depth).
			const cols = target.collections;
			const col =
				cols && Object.prototype.hasOwnProperty.call(cols, parsed.name)
					? cols[parsed.name]
					: undefined;
			const fn = col?.[parsed.op];
			if (!fn) {
				return brokerError(
					"not_implemented",
					`collections.${parsed.name}.${parsed.op} has no host handler`,
				);
			}
			return { ok: true, value: await fn(args ?? {}) };
		}

		if (parsed.kind === "global") {
			// `set` (write) is DENIED for guests, by design: a global is a SINGLETON
			// with no per-tenant boundary (unlike a `document_store` row keyed by a
			// granted `store`, or a collection row gated by its own access rule), so
			// there is no namespaced clamp that could safely confine a guest's global
			// write. It fails closed here regardless of any target handler. (§7 +
			// Decision 8: the write boundary re-enables collection writes only.)
			if (parsed.op === "set") {
				return brokerError(
					"not_implemented",
					`globals.${parsed.name}.set (guest write) is denied: a global is a ` +
						"singleton with no per-tenant boundary",
				);
			}
			// `get` (read) is capability-checked upstream in `handleRpc`. Same
			// prototype-safe own-property lookup as collections.
			const globals = target.globals;
			const glob =
				globals && Object.prototype.hasOwnProperty.call(globals, parsed.name)
					? globals[parsed.name]
					: undefined;
			const fn = glob?.[parsed.op];
			if (!fn) {
				return brokerError(
					"not_implemented",
					`globals.${parsed.name}.${parsed.op} has no host handler`,
				);
			}
			return { ok: true, value: await fn(args ?? {}) };
		}

		if (parsed.kind === "http") {
			// Brokered, SSRF-safe egress. The per-app `net` allowlist already passed
			// the capability check; here we ALWAYS run the trusted host fetch that
			// resolves → validates ALL ips → PINS the socket to a validated ip →
			// re-validates every redirect hop. `hostFetch` never throws; it returns
			// a structured error that maps straight onto BrokerRpcResponse. The
			// target only contributes OPTIONS (injected resolver / timeouts).
			const allow = Array.isArray(caps.net) ? caps.net : [];
			const result = await hostFetch((args ?? {}) as HttpFetchRequest, {
				...target.http?.fetchOptions,
				isHostAllowed: (host, port) => isHttpHostAllowed(allow, host, port),
			});
			return result.ok
				? { ok: true, value: result.value }
				: { ok: false, error: result.error };
		}

		// services / jobs / workflows / email: capability-checkable but not
		// dispatched in this MVP. Fail closed as a clear deferral.
		return brokerError(
			"not_implemented",
			`${parsed.kind} dispatch is not implemented in this MVP`,
		);
	}
}

/** CSPRNG opaque-token factory (256 bits of entropy, hex-encoded). */
function defaultTokenFactory(): string {
	// `crypto` is global in Bun/Node 20+. Fall back to node:crypto if absent.
	const c: Crypto | undefined = (globalThis as { crypto?: Crypto }).crypto;
	if (c?.getRandomValues) {
		const bytes = new Uint8Array(32);
		c.getRandomValues(bytes);
		return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
	}
	// Defensive fallback — should not be hit in supported runtimes.
	throw new Error(
		"SandboxBroker: no CSPRNG available (globalThis.crypto.getRandomValues missing)",
	);
}
