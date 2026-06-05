/**
 * The PARENT side of the mini-app bridge (`.private/miniapps-v2-design.md` §3.3).
 *
 * The untrusted iframe never fetches the backend itself — it `postMessage`s an RPC
 * (`{ __miniapp_rpc, id, app, action, input }`) to its parent (the trusted
 * KnowledgeHost), and the parent:
 *   1. VALIDATES the message came from THE frame it mounted (`event.source ===
 *      frame.contentWindow`) and from the EXPECTED origin (`event.origin` — `null`
 *      for a srcdoc sandbox, surfaced by the browser as the string `"null"`), and
 *   2. attaches the short-lived `x-miniapp-token` (which the frame never sees —
 *      secrets stay in the parent, the Claude-Artifacts broker pattern), and
 *   3. fetches `POST /api/apps/{appId}/{action}` (or the fs route) and posts the
 *      v1 `{ ok, output, logs }` envelope back to the frame as the RPC reply.
 *
 * This module is the PURE dispatch logic (origin/source validation + URL building
 * + fetch). `fetch`, the token, and the "post a reply" sink are all injected, so
 * it is unit-tested with NO browser, NO real iframe, NO network. The React
 * `KnowledgeHost` (`components/knowledge-host.tsx`) wires this to a real
 * `MessageEvent` + a real `<iframe>` + the global `fetch`.
 */

/** A bridge RPC message as the frame's bootstrap posts it. */
export interface MiniAppRpcMessage {
	__miniapp_rpc: true;
	/** Correlation id the frame assigned; echoed back in the reply. */
	id: string;
	/** The app id the frame claims — MUST equal the host's bound app id. */
	app: string;
	/** The action name (a registered action, or `fs:read`/`fs:write`). */
	action: string;
	/** The action input payload. */
	input?: unknown;
}

/** The reply the host posts back into the frame. */
export interface MiniAppRpcReply {
	__miniapp_reply: true;
	id: string;
	/** Present on success — the v1 envelope (`{ ok, output, logs }`) or fs payload. */
	result?: unknown;
	/** Present on failure — a string the frame turns into an `Error`. */
	error?: string;
}

/** Structural guard for an inbound RPC message (event data is untrusted). */
export function isMiniAppRpcMessage(data: unknown): data is MiniAppRpcMessage {
	if (typeof data !== "object" || data === null) return false;
	const d = data as Record<string, unknown>;
	return (
		d.__miniapp_rpc === true &&
		typeof d.id === "string" &&
		typeof d.app === "string" &&
		typeof d.action === "string"
	);
}

/** Fixed prefix for the fs pseudo-actions the bridge maps to the fs route. */
const FS_READ = "fs:read";
const FS_WRITE = "fs:write";

/** The host's binding for one mounted mini-app frame. */
export interface MiniAppBridgeConfig {
	/** The app id this host is bound to. A message claiming another app is rejected. */
	appId: string;
	/** The `<iframe>`'s `contentWindow` — the ONLY accepted `event.source`. */
	frameWindow: unknown;
	/**
	 * Accepted `event.origin` values. For a `srcdoc` sandbox the browser reports
	 * `"null"`; some engines report `""`. Both are accepted; anything else is not.
	 */
	allowedOrigins?: string[];
	/** Base path for the API (default `/api`). */
	apiBase?: string;
	/** Provide the current `x-miniapp-token` (re-minted by the host as needed). */
	getToken: () => Promise<string> | string;
	/**
	 * Injected fetch (the React wiring passes the global `fetch`). Typed as the
	 * minimal `(url, init) => Promise<Response>` shape — NOT `typeof fetch` — so a
	 * test double (and Bun's `fetch`, which carries extra statics) both satisfy it.
	 */
	fetchImpl: (url: string, init?: RequestInit) => Promise<Response>;
}

/** The default set of origins a null-origin srcdoc frame reports. */
export const DEFAULT_SRCDOC_ORIGINS = ["null", ""];

/** Build the backend URL for an RPC action (named action or fs pseudo-action). */
export function buildRpcUrl(
	apiBase: string,
	appId: string,
	action: string,
	input: unknown,
): { url: string; method: "GET" | "POST" | "PUT"; body?: string } {
	const base = apiBase.replace(/\/$/, "");
	const app = encodeURIComponent(appId);

	if (action === FS_READ || action === FS_WRITE) {
		const payload = (input ?? {}) as {
			path?: unknown;
			body?: unknown;
			list?: unknown;
		};
		const rawPath = typeof payload.path === "string" ? payload.path : "";
		// Encode each path segment; the fs route is a `[...path]` catch-all.
		const segs = rawPath
			.split("/")
			.filter((s) => s.length > 0)
			.map((s) => encodeURIComponent(s))
			.join("/");
		let url = `${base}/apps/${app}/fs/${segs}`;
		if (action === FS_READ) {
			if (payload.list === true) url += "?list=1";
			return { url, method: "GET" };
		}
		// fs:write — PUT the body bytes.
		const body =
			typeof payload.body === "string"
				? payload.body
				: JSON.stringify(payload.body ?? null);
		return { url, method: "PUT", body };
	}

	// Named action — POST the input as JSON.
	return {
		url: `${base}/apps/${app}/${encodeURIComponent(action)}`,
		method: "POST",
		body: JSON.stringify(input ?? {}),
	};
}

/** Why a postMessage was rejected before any fetch (for diagnostics). */
export type BridgeRejection =
	| "not-rpc"
	| "bad-source"
	| "bad-origin"
	| "app-mismatch";

/**
 * Validate an inbound postMessage against the host binding WITHOUT performing the
 * fetch. Returns the parsed message on success, or a typed rejection. Pure — no
 * I/O — so the origin/source/app checks are tested in isolation.
 */
export function validateBridgeMessage(
	event: { data: unknown; source: unknown; origin: string },
	config: Pick<MiniAppBridgeConfig, "appId" | "frameWindow" | "allowedOrigins">,
):
	| { ok: true; message: MiniAppRpcMessage }
	| { ok: false; reason: BridgeRejection } {
	if (!isMiniAppRpcMessage(event.data)) return { ok: false, reason: "not-rpc" };

	// SOURCE: the message MUST come from the exact frame we mounted (not a sibling,
	// not the opener). This is the primary anti-spoof check.
	if (event.source !== config.frameWindow) {
		return { ok: false, reason: "bad-source" };
	}

	// ORIGIN: a srcdoc sandbox is a null origin → "null" (or "" on some engines).
	const allowed = config.allowedOrigins ?? DEFAULT_SRCDOC_ORIGINS;
	if (!allowed.includes(event.origin)) {
		return { ok: false, reason: "bad-origin" };
	}

	// APP: the frame cannot ask the host to act for a DIFFERENT app than it is bound
	// to (the token is app-bound too, but reject early + clearly).
	if (event.data.app !== config.appId) {
		return { ok: false, reason: "app-mismatch" };
	}

	return { ok: true, message: event.data };
}

/**
 * Handle one inbound postMessage end-to-end: validate → attach token → fetch →
 * post the reply via `postReply`. NEVER throws — a failure becomes an `error`
 * reply so the frame's promise rejects cleanly. Silently ignores non-RPC / bad
 * source/origin messages (does NOT post a reply for those — they may be unrelated
 * postMessages from other libraries).
 *
 * @returns the rejection reason when the message was ignored before fetch, else
 *   `"dispatched"`. (Surfaced for tests + host-side logging.)
 */
export async function handleBridgeMessage(
	event: { data: unknown; source: unknown; origin: string },
	config: MiniAppBridgeConfig,
	postReply: (reply: MiniAppRpcReply) => void,
): Promise<BridgeRejection | "dispatched"> {
	const validated = validateBridgeMessage(event, config);
	if (!validated.ok) return validated.reason;

	const { message } = validated;
	const apiBase = config.apiBase ?? "/api";

	try {
		const token = await config.getToken();
		const { url, method, body } = buildRpcUrl(
			apiBase,
			config.appId,
			message.action,
			message.input,
		);

		const headers: Record<string, string> = {
			"x-miniapp-token": token,
		};
		if (body !== undefined && method !== "GET") {
			headers["content-type"] = "application/json";
		}

		const response = await config.fetchImpl(url, {
			method,
			headers,
			body: method === "GET" ? undefined : body,
			// SameSite session cookie still rides for the route's secondary auth;
			// the token is the CSRF-resistant primary. Same-origin fetch → include.
			credentials: "same-origin",
		});

		// fs:read returns raw bytes/JSON; actions return the JSON envelope. Branch on
		// content-type so a binary fs read isn't force-parsed as JSON.
		const contentType = response.headers.get("content-type") ?? "";
		let result: unknown;
		if (contentType.includes("application/json")) {
			result = await response.json();
		} else {
			result = await response.text();
		}

		if (!response.ok) {
			// Surface the structured error if the body carried one; else the status.
			const errText =
				result && typeof result === "object" && "error" in result
					? String((result as { error: unknown }).error)
					: `request failed (${response.status})`;
			postReply({ __miniapp_reply: true, id: message.id, error: errText });
			return "dispatched";
		}

		postReply({ __miniapp_reply: true, id: message.id, result });
		return "dispatched";
	} catch (err) {
		postReply({
			__miniapp_reply: true,
			id: message.id,
			error: err instanceof Error ? err.message : String(err),
		});
		return "dispatched";
	}
}
