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
import { checkBindingCapability } from "./capability-check.js";
import {
	type BindingError,
	type BrokerRpcResponse,
	parseBindingMethod,
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
	knowledge?: {
		read?(args: unknown): Promise<unknown>;
		write?(args: unknown): Promise<unknown>;
		list?(args: unknown): Promise<unknown>;
	};
	/**
	 * Per-collection accessor. The broker only calls `find`/`findOne` in the MVP;
	 * the target may expose more, but the broker will not dispatch them yet.
	 */
	collections?: Record<
		string,
		{
			find?(args: unknown): Promise<unknown>;
			findOne?(args: unknown): Promise<unknown>;
		}
	>;
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

function brokerError(
	code: BindingError["code"],
	message: string,
): { ok: false; error: BindingError } {
	return { ok: false, error: { code, message } };
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

	/**
	 * @param mintToken - Token generator. Defaults to a CSPRNG hex string. Inject
	 *   a deterministic generator in tests.
	 */
	constructor(mintToken?: () => string) {
		this.mintToken = mintToken ?? defaultTokenFactory;
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

		// 3. DISPATCH to the bound primitive surface (MVP: knowledge + collection
		//    reads). In-scope methods without a handler are an honest deferral.
		const parsed = parseBindingMethod(method);
		// `parsed` is non-null here (the check passed), but guard for the type.
		if (!parsed) {
			return brokerError("bad_method", "unrecognized method");
		}

		try {
			return await this.dispatch(parsed, args, run.target);
		} catch (err) {
			return brokerError(
				"execution_error",
				err instanceof Error ? err.message : String(err),
			);
		}
	}

	/** Route an ALREADY-AUTHORIZED call to the bound target. */
	private async dispatch(
		parsed: NonNullable<ReturnType<typeof parseBindingMethod>>,
		args: unknown,
		target: BindingTarget,
	): Promise<BrokerRpcResponse> {
		if (parsed.kind === "knowledge") {
			const fn = target.knowledge?.[parsed.op];
			if (!fn) {
				return brokerError(
					"not_implemented",
					`knowledge.${parsed.op} has no host handler`,
				);
			}
			return { ok: true, value: await fn(args ?? {}) };
		}

		if (parsed.kind === "collection") {
			if (parsed.op !== "find" && parsed.op !== "findOne") {
				return brokerError(
					"not_implemented",
					`collections.${parsed.name}.${parsed.op} is not dispatched in this MVP`,
				);
			}
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

		// globals / services / jobs / workflows / email: capability-checkable but
		// not dispatched in the MVP. Fail closed as a clear deferral.
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
