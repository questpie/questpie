/**
 * /admin/run-detail?run={id} — run-detail view (§4.6, T10).
 *
 * One surface for EVERY run kind (the worker streams chat, task, schedule and
 * mcp runs alike): header from the run_links row, a live transcript attached
 * to GET /api/runs/{id}/stream while the run is active, the persisted
 * `uiMessages` parts once terminal, and the run's artifact rows (assets).
 */

import { Icon } from "@iconify/react";
import { readUIMessageStream, type UIMessage } from "ai";
import * as React from "react";

import { page, selectClient, useAdminStore } from "@questpie/admin/client";

import { parseSseToChunks } from "../lib/autopilot-chat-transport";
import { MessageParts } from "../components/message-parts";

type Doc = Record<string, any>;

const ACTIVE_STATUSES = new Set(["pending", "claimed", "running"]);

function relationId(value: unknown): string | null {
	if (typeof value === "string") return value;
	if (
		value &&
		typeof value === "object" &&
		typeof (value as any).id === "string"
	) {
		return (value as any).id;
	}
	return null;
}

function statusTone(status: unknown): string {
	switch (status) {
		case "running":
			return "bg-info";
		case "completed":
			return "bg-success";
		case "failed":
		case "cancelled":
			return "bg-destructive";
		case "claimed":
		case "pending":
			return "bg-warning";
		default:
			return "bg-muted-foreground";
	}
}

function formatDuration(run: Doc): string {
	const start = run.startedAt ? new Date(run.startedAt).getTime() : null;
	const end = run.endedAt ? new Date(run.endedAt).getTime() : null;
	if (!start) return "—";
	const ms = (end ?? Date.now()) - start;
	if (!Number.isFinite(ms) || ms < 0) return "—";
	if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
	return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

/** Persisted uiMessages tolerate both UIMessage[] and a single object. */
function persistedMessages(run: Doc | undefined): UIMessage[] {
	const stored = run?.uiMessages;
	if (Array.isArray(stored)) {
		return stored.filter(
			(m): m is UIMessage =>
				!!m && typeof m === "object" && Array.isArray((m as any).parts),
		);
	}
	if (stored && typeof stored === "object" && Array.isArray(stored.parts)) {
		return [stored as UIMessage];
	}
	return [];
}

/** Live transcript: attach the run stream and accumulate UIMessage snapshots. */
function useLiveTranscript(
	basePath: string,
	runId: string | null,
	active: boolean,
) {
	const [messages, setMessages] = React.useState<UIMessage[]>([]);
	const [error, setError] = React.useState<string | null>(null);

	React.useEffect(() => {
		setMessages([]);
		setError(null);
		if (!runId || !active) return;

		const abort = new AbortController();
		void (async () => {
			try {
				const res = await fetch(
					`${basePath}/runs/${encodeURIComponent(runId)}/stream`,
					{
						headers: { "x-questpie-admin": "1" },
						signal: abort.signal,
					},
				);
				if (res.status === 204 || !res.ok || !res.body) return;
				const chunkStream = parseSseToChunks(res.body);
				const byId = new Map<string, UIMessage>();
				for await (const snapshot of readUIMessageStream({
					stream: chunkStream,
				})) {
					if (abort.signal.aborted) return;
					byId.set(snapshot.id, snapshot);
					setMessages([...byId.values()]);
				}
			} catch (err) {
				if (!abort.signal.aborted) {
					setError(err instanceof Error ? err.message : String(err));
				}
			}
		})();

		return () => abort.abort();
	}, [basePath, runId, active]);

	return { messages, error };
}

function HeaderStat({ label, value }: { label: string; value: React.ReactNode }) {
	return (
		<div className="min-w-0">
			<div className="text-muted-foreground text-[11px] uppercase">{label}</div>
			<div className="truncate text-sm">{value}</div>
		</div>
	);
}

function RunDetailPage() {
	const client = useAdminStore(selectClient);
	const runId = React.useMemo(() => {
		if (typeof window === "undefined") return null;
		return new URLSearchParams(window.location.search).get("run");
	}, []);
	const basePath = (client as any)?.getBasePath?.() ?? "/api";

	// Plain fetch-poll state (no react-query: page-level useQuery instances
	// never re-rendered here — see T10 notes — while setState works fine).
	// Poll every 2.5s while the run is active; one final load on terminal.
	const [run, setRun] = React.useState<Doc | null | undefined>(undefined);
	React.useEffect(() => {
		if (!runId) return;
		let stopped = false;
		const load = async (): Promise<Doc | null> => {
			try {
				const res = await fetch(
					`${basePath}/runs/${encodeURIComponent(runId)}`,
					{ headers: { "x-questpie-admin": "1" } },
				);
				if (!res.ok) {
					if (!stopped) setRun(null);
					return null;
				}
				const doc = (await res.json()) as Doc;
				if (!stopped) setRun(doc);
				return doc;
			} catch {
				return null;
			}
		};
		const loop = async () => {
			const doc = await load();
			if (stopped) return;
			if (doc && ACTIVE_STATUSES.has(String(doc.status))) {
				setTimeout(loop, 2_500);
			}
		};
		void loop();
		return () => {
			stopped = true;
		};
	}, [basePath, runId]);

	const status = String(run?.status ?? "");
	const isActive = ACTIVE_STATUSES.has(status);

	const live = useLiveTranscript(basePath, runId, isActive);
	const persisted = persistedMessages(run ?? undefined);
	// Live snapshots while active; persisted parts once terminal (finalize wins).
	const transcript = isActive ? live.messages : persisted;

	// Artifacts: load once, refresh when the run reaches terminal (artifact
	// rows are written at finalize).
	const [artifacts, setArtifacts] = React.useState<Doc[]>([]);
	React.useEffect(() => {
		if (!client || !runId) return;
		let stopped = false;
		void (async () => {
			const api = (client as any)?.collections?.assets;
			if (!api?.find) return;
			try {
				const result = await api.find({
					where: {
						run: runId,
						kind: { in: ["artifact", "result", "summary", "diff", "log"] },
					},
					limit: 100,
					orderBy: { createdAt: "desc" },
				});
				if (!stopped) {
					setArtifacts(Array.isArray(result) ? result : (result?.docs ?? []));
				}
			} catch {
				// leave empty
			}
		})();
		return () => {
			stopped = true;
		};
	}, [client, runId, isActive]);

	if (!runId) {
		return (
			<div className="text-muted-foreground p-6 text-sm">
				No run selected — open this page as /admin/run-detail?run=&lt;id&gt;.
			</div>
		);
	}
	if (run === undefined) {
		return (
			<div className="flex items-center justify-center p-10">
				<Icon icon="ph:spinner" className="text-muted-foreground size-5 animate-spin" />
			</div>
		);
	}
	if (!run) {
		return (
			<div className="text-destructive p-6 text-sm">Run {runId} not found.</div>
		);
	}

	return (
		<div className="mx-auto w-full max-w-3xl space-y-4 pb-10">
			<div className="border-border-subtle bg-card/60 rounded-xl border p-4">
				<div className="flex items-center gap-2">
					<span
						className={["size-2.5 rounded-full", statusTone(status)].join(" ")}
					/>
					<span className="text-sm font-semibold capitalize">{status}</span>
					<span className="text-muted-foreground text-xs">
						{String(run.kind ?? "run")} · {String(run.runtime ?? "")}
					</span>
					<span className="text-muted-foreground ml-auto font-mono text-[11px]">
						{runId.slice(0, 8)}
					</span>
				</div>
				<div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
					<HeaderStat
						label="Worker"
						value={relationId(run.worker)?.slice(0, 8) ?? "—"}
					/>
					<HeaderStat label="Duration" value={formatDuration(run)} />
					<HeaderStat
						label="Tokens in"
						value={typeof run.tokensInput === "number" ? run.tokensInput : "—"}
					/>
					<HeaderStat
						label="Tokens out"
						value={typeof run.tokensOutput === "number" ? run.tokensOutput : "—"}
					/>
				</div>
				{typeof run.error === "string" && run.error ? (
					<div className="text-destructive mt-3 text-xs">{run.error}</div>
				) : null}
			</div>

			<div className="border-border-subtle bg-card/60 rounded-xl border p-4">
				<div className="text-muted-foreground mb-2 text-[11px] uppercase">
					Prompt
				</div>
				<div className="text-sm leading-relaxed break-words whitespace-pre-wrap">
					{String(run.instructions ?? "")}
				</div>
			</div>

			<div className="border-border-subtle bg-card/60 rounded-xl border p-4">
				<div className="text-muted-foreground mb-2 flex items-center gap-2 text-[11px] uppercase">
					<span>Transcript</span>
					{isActive ? (
						<span className="text-info inline-flex items-center gap-1 normal-case">
							<span className="bg-info inline-block size-1.5 animate-pulse rounded-full" />
							live
						</span>
					) : null}
				</div>
				{transcript.length === 0 ? (
					<div className="text-muted-foreground text-sm">
						{isActive
							? "Waiting for output…"
							: "No transcript persisted for this run."}
					</div>
				) : (
					<div className="space-y-3">
						{transcript.map((message) => (
							<MessageParts key={message.id} message={message} />
						))}
					</div>
				)}
				{live.error && isActive ? (
					<div className="text-destructive mt-2 text-xs">{live.error}</div>
				) : null}
			</div>

			<div className="border-border-subtle bg-card/60 rounded-xl border p-4">
				<div className="text-muted-foreground mb-2 text-[11px] uppercase">
					Artifacts
				</div>
				{artifacts.length === 0 ? (
					<div className="text-muted-foreground text-sm">No artifacts.</div>
				) : (
					<div className="space-y-1.5">
						{artifacts.map((artifact) => (
							<a
								key={artifact.id}
								href={`/admin/collections/assets/${artifact.id}`}
								className="border-border-subtle hover:bg-muted/40 flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm transition-colors"
							>
								<Icon
									icon="ph:file-text"
									className="text-muted-foreground size-4 shrink-0"
								/>
								<span className="min-w-0 flex-1 truncate">
									{String(artifact.name ?? artifact.path ?? artifact.id)}
								</span>
								<span className="text-muted-foreground shrink-0 text-[11px]">
									{String(artifact.kind ?? "")}
								</span>
							</a>
						))}
					</div>
				)}
			</div>
		</div>
	);
}

export default page("run-detail", {
	path: "/run-detail",
	label: { en: "Run Detail" },
	component: RunDetailPage,
	showInNav: false,
});
