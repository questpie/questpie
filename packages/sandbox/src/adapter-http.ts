import type {
	ExecutorAdapter,
	ExecutorRunOptions,
	ExecutorRunResult,
} from "questpie/executor";

import { validateEgressHosts } from "./net-validation.js";
import type { SandboxCapabilities, SandboxRunResult } from "./types.js";

export interface HttpSandboxAdapterOptions {
	/**
	 * Base URL of the standalone Deno sandbox service (`sandbox-server.ts`).
	 * Defaults to `process.env.SANDBOX_URL`. Throws on `run` if neither is set.
	 */
	url?: string;
	/**
	 * Per-request HTTP fetch timeout (ms). A safety margin above the guest
	 * wall-timeout so the server's own kill fires first; if the server is
	 * unreachable this bounds the client wait. Default: guest timeout + 10s.
	 */
	fetchTimeoutMs?: number;
	/** Optional custom `fetch` (e.g. for auth headers / mTLS). */
	fetch?: typeof fetch;
	/**
	 * Validate net/import hosts against the private-IP policy BEFORE sending to
	 * the sandbox (defense-in-depth; the server validates too). Default: true.
	 */
	validateEgress?: boolean;
}

const DEFAULT_GUEST_TIMEOUT_MS = 5_000;

/**
 * Production sandboxed `ExecutorAdapter` — POSTs the run to the standalone Deno
 * sandbox service over HTTP. The main app (Bun/Node) holds NO Deno; it only
 * speaks this JSON contract.
 *
 * Use as the `sandboxed` adapter in the executor config:
 *   executor: { sandboxed: httpSandboxAdapter({ url: process.env.SANDBOX_URL }) }
 */
export class HttpSandboxAdapter implements ExecutorAdapter {
	private readonly fetchImpl: typeof fetch;
	private readonly validateEgress: boolean;

	constructor(private readonly options: HttpSandboxAdapterOptions = {}) {
		this.fetchImpl = options.fetch ?? globalThis.fetch;
		this.validateEgress = options.validateEgress ?? true;
	}

	private resolveUrl(): string {
		const url =
			this.options.url ??
			(typeof process !== "undefined"
				? process.env?.SANDBOX_URL
				: undefined);
		if (!url) {
			throw new Error(
				"HttpSandboxAdapter: no sandbox URL configured. Pass `url` or set SANDBOX_URL.",
			);
		}
		return url.replace(/\/$/, "");
	}

	async run(options: ExecutorRunOptions): Promise<ExecutorRunResult> {
		const base = this.resolveUrl();
		const caps = options.capabilities ?? {};
		const net = caps.net ?? [];
		const importHosts = caps.import ?? [];
		const timeoutMs = caps.timeoutMs ?? DEFAULT_GUEST_TIMEOUT_MS;

		// Defense-in-depth: reject private-IP egress before even contacting the
		// sandbox (the server re-checks). Surfaces a clear error to the caller.
		if (this.validateEgress) {
			const egress = await validateEgressHosts([...net, ...importHosts]);
			if (!egress.ok) {
				return {
					ok: false,
					error: `egress blocked: ${egress.reason}`,
					logs: [],
				};
			}
		}

		const sandboxCaps: SandboxCapabilities = {
			net,
			import: importHosts,
			timeoutMs,
			memoryMb: caps.memoryMb ?? 128,
		};

		const fetchTimeoutMs = this.options.fetchTimeoutMs ?? timeoutMs + 10_000;
		const controller = new AbortController();
		const abortTimer = setTimeout(() => controller.abort(), fetchTimeoutMs);

		try {
			const res = await this.fetchImpl(`${base}/run`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					source: options.source,
					input: options.input ?? null,
					capabilities: sandboxCaps,
					secrets: options.secrets ?? {},
				}),
				signal: controller.signal,
			});

			const text = await res.text();
			let parsed: SandboxRunResult;
			try {
				parsed = JSON.parse(text) as SandboxRunResult;
			} catch {
				return {
					ok: false,
					error: `sandbox returned non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`,
					logs: [],
				};
			}

			return {
				ok: !!parsed.ok,
				output: parsed.output,
				error: parsed.error,
				logs: Array.isArray(parsed.logs) ? parsed.logs : [],
				timedOut: parsed.timedOut,
				ms: parsed.ms,
			};
		} catch (err) {
			const aborted = err instanceof Error && err.name === "AbortError";
			return {
				ok: false,
				error: aborted
					? `sandbox request timed out after ${fetchTimeoutMs}ms`
					: `sandbox request failed: ${err instanceof Error ? err.message : String(err)}`,
				logs: [],
			};
		} finally {
			clearTimeout(abortTimer);
		}
	}
}

/** Factory for the production sandboxed adapter. */
export function httpSandboxAdapter(
	options: HttpSandboxAdapterOptions = {},
): HttpSandboxAdapter {
	return new HttpSandboxAdapter(options);
}
