"use client";

import { Icon } from "@iconify/react";
import { useQuery } from "@tanstack/react-query";
import * as React from "react";

import { selectClient, useAdminStore } from "@questpie/admin/client";

import {
	type MiniAppRpcReply,
	handleBridgeMessage,
} from "../lib/miniapp-bridge";
import {
	type MiniAppBundleEntry,
	assembleMiniAppSrcdoc,
	MiniAppSrcdocError,
	selectMiniAppUiFiles,
} from "../lib/miniapp-srcdoc";

/**
 * KnowledgeHost — renders + RUNS a `kind:"miniapp"` `.app` bundle in the admin.
 *
 * `.private/miniapps-v2-design.md` ★ RESOLVED (origin = `srcdoc`) + §3.3 + §5 + §6.
 *
 * It (1) reads the `.app` bundle rows from the `assets` file store, (2) mints a
 * short-lived `x-miniapp-token` bound to this session+app, (3) ASSEMBLES a single
 * srcdoc (index.html + `*.jsx` as `text/babel` + the host-fixed SRI-pinned CDN +
 * the `window.app` bridge), and (4) mounts it in an `<iframe sandbox="allow-scripts"
 * srcdoc>` — NEVER `allow-same-origin`. The parent listens for the frame's bridge
 * RPCs, validates `event.source`/`event.origin`, attaches the token (which the
 * frame never sees), and proxies the fetch to `/api/apps/{appId}/{action}` (or the
 * fs route), posting the `{ ok, output, logs }` envelope back to the frame.
 */

/** The token mint endpoint's response. */
interface MintedTokenResponse {
	token: string;
	expiresAt: number;
	actions: string[];
	net: string[];
}

/** Compute the `.app` bundle path prefix for an app id (mirror of the resolver). */
function bundlePrefix(appId: string): string {
	return `company/apps/${appId}.app/`;
}

async function loadBundleEntries(
	client: unknown,
	appId: string,
): Promise<MiniAppBundleEntry[]> {
	const api = (client as any)?.collections?.assets;
	if (!api?.find) return [];
	const prefix = bundlePrefix(appId);
	const result = await api.find({
		where: { path: { startsWith: prefix } },
		limit: 200,
	});
	const docs: Array<{ path?: string | null; body?: string | null }> =
		result?.docs ?? result?.items ?? [];
	const entries: MiniAppBundleEntry[] = [];
	for (const doc of docs) {
		if (typeof doc.path !== "string") continue;
		if (!doc.path.startsWith(prefix)) continue;
		entries.push({
			relPath: doc.path.slice(prefix.length),
			body: doc.body ?? "",
		});
	}
	return entries;
}

/** Mint a bridge token for `{appId, session}` via the host endpoint. */
async function mintToken(appId: string): Promise<MintedTokenResponse> {
	const response = await fetch(`/api/apps/${encodeURIComponent(appId)}/token`, {
		method: "POST",
		credentials: "same-origin",
	});
	if (!response.ok) {
		throw new Error(`Failed to mint mini-app token (${response.status})`);
	}
	return (await response.json()) as MintedTokenResponse;
}

interface KnowledgeHostBundle {
	entries: MiniAppBundleEntry[];
	token: MintedTokenResponse;
}

function StatusBox({
	icon,
	title,
	children,
}: {
	icon: string;
	title: string;
	children?: React.ReactNode;
}) {
	return (
		<div className="text-muted-foreground border-border-subtle flex h-full min-h-[20rem] flex-col items-center justify-center gap-2 border p-8 text-center text-sm">
			<Icon icon={icon} className="size-6 opacity-50" />
			<div className="text-foreground font-medium">{title}</div>
			{children ? <div className="max-w-md text-xs">{children}</div> : null}
		</div>
	);
}

export function KnowledgeHost({
	appId,
	className,
}: {
	appId: string;
	className?: string;
}) {
	const client = useAdminStore(selectClient);
	const iframeRef = React.useRef<HTMLIFrameElement | null>(null);
	// The latest minted token (refreshed when it nears expiry); held in a ref so the
	// long-lived message listener always reads the current value.
	const tokenRef = React.useRef<MintedTokenResponse | null>(null);

	const { data, isLoading, error } = useQuery<KnowledgeHostBundle>({
		queryKey: ["miniapp-host", appId],
		queryFn: async () => {
			const [entries, token] = await Promise.all([
				loadBundleEntries(client, appId),
				mintToken(appId),
			]);
			return { entries, token };
		},
		enabled: !!client && !!appId,
		// A token is short-lived; re-mint on a generous cadence well inside its TTL.
		refetchInterval: 5 * 60_000,
		refetchOnWindowFocus: false,
	});

	// Keep the token ref fresh for the bridge.
	React.useEffect(() => {
		if (data?.token) tokenRef.current = data.token;
	}, [data?.token]);

	// Assemble the srcdoc from the bundle (memoized; throws → surfaced below).
	const assembled = React.useMemo<
		| { ok: true; srcdoc: string }
		| { ok: false; kind: "no-ui" | "error"; message?: string }
	>(() => {
		if (!data) return { ok: false, kind: "error", message: "loading" };
		const selected = selectMiniAppUiFiles(data.entries);
		if (!selected.ok) {
			return { ok: false, kind: "no-ui" };
		}
		try {
			const srcdoc = assembleMiniAppSrcdoc({
				appId,
				indexHtml: selected.files.indexHtml,
				jsxFiles: selected.files.jsxFiles,
				assets: selected.files.assets,
				connectHosts: data.token.net,
			});
			return { ok: true, srcdoc };
		} catch (err) {
			return {
				ok: false,
				kind: "error",
				message:
					err instanceof MiniAppSrcdocError
						? err.message
						: err instanceof Error
							? err.message
							: "Failed to assemble mini-app",
			};
		}
	}, [appId, data]);

	// Wire the parent side of the bridge: validate source/origin, attach the token,
	// proxy the fetch, reply into the frame. The listener lives as long as the host.
	React.useEffect(() => {
		if (!assembled.ok) return;

		const onMessage = (event: MessageEvent) => {
			const frame = iframeRef.current;
			if (!frame) return;
			void handleBridgeMessage(
				{ data: event.data, source: event.source, origin: event.origin },
				{
					appId,
					frameWindow: frame.contentWindow,
					apiBase: "/api",
					getToken: async () => {
						const current = tokenRef.current;
						if (current && current.expiresAt - Date.now() > 30_000) {
							return current.token;
						}
						// Token missing/near-expiry — re-mint synchronously for this call.
						const fresh = await mintToken(appId);
						tokenRef.current = fresh;
						return fresh.token;
					},
					fetchImpl: (...args) => fetch(...args),
				},
				(reply: MiniAppRpcReply) => {
					frame.contentWindow?.postMessage(reply, "*");
				},
			);
		};

		window.addEventListener("message", onMessage);
		return () => window.removeEventListener("message", onMessage);
	}, [appId, assembled.ok]);

	if (isLoading) {
		return (
			<div className={className}>
				<StatusBox icon="ph:spinner" title="Loading mini-app…" />
			</div>
		);
	}

	if (error) {
		return (
			<div className={className}>
				<StatusBox icon="ph:warning" title="Failed to load mini-app">
					{error instanceof Error ? error.message : String(error)}
				</StatusBox>
			</div>
		);
	}

	if (!assembled.ok) {
		if (assembled.kind === "no-ui") {
			return (
				<div className={className}>
					<StatusBox icon="ph:terminal-window" title="No UI for this mini-app">
						This `.app` bundle has a backend (`server.ts`) but no `index.html`
						UI. Its actions run via cron or the API.
					</StatusBox>
				</div>
			);
		}
		return (
			<div className={className}>
				<StatusBox icon="ph:warning" title="Could not render mini-app">
					{assembled.message}
				</StatusBox>
			</div>
		);
	}

	return (
		<div className={className}>
			<iframe
				ref={iframeRef}
				title={`Mini-app: ${appId}`}
				// NEVER `allow-same-origin` — the frame could strip its own sandbox and
				// reach admin DOM/cookies. `allow-scripts` only; null origin.
				sandbox="allow-scripts"
				srcDoc={assembled.srcdoc}
				className="bg-background h-full min-h-[32rem] w-full border-0"
			/>
		</div>
	);
}

export default KnowledgeHost;
