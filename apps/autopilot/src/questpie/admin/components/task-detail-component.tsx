"use client";

import { Icon } from "@iconify/react";
import * as React from "react";

import {
	Badge,
	selectBasePath,
	selectNavigate,
	useAdminStore,
	useCollectionList,
} from "@questpie/admin/client";
import { adminClientModule } from "@questpie/admin/client/modules/admin";
import type { MaybeLazyComponent } from "@questpie/admin/client";

function isLazyLoader(
	loader: MaybeLazyComponent,
): loader is () => Promise<{ default: React.ComponentType<Record<string, unknown>> }> {
	return (
		typeof loader === "function" &&
		loader.length === 0 &&
		!("prototype" in loader && loader.prototype?.isReactComponent)
	);
}

// Resolve the admin's built-in collection-form view once, at module scope, as a
// lazy component. Rendering it inside <Suspense> (below) gives FormView the
// Suspense boundary its useSuspenseCollectionMeta hook requires — the previous
// useState/useEffect manual-load mounted FormView with no Suspense ancestor,
// so the suspended meta read resolved to null and crashed in a relation field.
const CollectionFormView = React.lazy(async () => {
	const loader = adminClientModule.views["collection-form"].component;
	if (isLazyLoader(loader)) {
		const module = await loader();
		return {
			default: (module.default ?? module) as React.ComponentType<
				Record<string, unknown>
			>,
		};
	}
	return {
		default: loader as React.ComponentType<Record<string, unknown>>,
	};
});

function TaskDetailForm(props: Record<string, unknown>) {
	return (
		<React.Suspense
			fallback={
				<div className="text-muted-foreground flex items-center justify-center p-12">
					<Icon icon="ph:spinner" className="size-5 animate-spin opacity-40" />
				</div>
			}
		>
			<CollectionFormView {...props} />
		</React.Suspense>
	);
}

type TimelineEntry = {
	id: string;
	kind: "activity" | "run";
	timestamp: string;
	type?: string;
	actor?: string;
	summary?: string;
	status?: string;
	runtime?: string;
	startedAt?: string;
	endedAt?: string;
	tokensInput?: number;
	tokensOutput?: number;
	initiatedBy?: string;
};

type ActivityDoc = {
	id: string;
	createdAt: string;
	type?: string;
	actor?: string;
	summary?: string;
};

type RunDoc = {
	id: string;
	createdAt?: string;
	startedAt?: string;
	endedAt?: string;
	status?: string;
	runtime?: string;
	summary?: string;
	tokensInput?: number;
	tokensOutput?: number;
	initiatedBy?: string;
};

type KnowledgeDoc = {
	id: string;
	title?: string;
	path?: string;
	kind?: string;
	source?: string;
	createdAt?: string;
};

const STATUS_COLORS: Record<string, string> = {
	completed: "bg-green-500",
	running: "bg-blue-500",
	failed: "bg-red-500",
	cancelled: "bg-zinc-400",
	pending: "bg-amber-500",
	claimed: "bg-cyan-500",
};

const STATUS_ICONS: Record<string, string> = {
	completed: "ph:check-bold",
	running: "ph:play-bold",
	failed: "ph:x-bold",
	cancelled: "ph:stop-bold",
	pending: "ph:clock-bold",
	claimed: "ph:hand-grabbing-bold",
};

function formatDuration(startedAt: string, endedAt: string): string {
	const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
	if (ms < 1000) return "<1s";
	const s = Math.floor(ms / 1000);
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	const rs = s % 60;
	if (m < 60) return `${m}m ${rs}s`;
	const h = Math.floor(m / 60);
	const rm = m % 60;
	return `${h}h ${rm}m`;
}

function formatRelativeTime(date: string): string {
	const d = new Date(date);
	const now = new Date();
	const diff = now.getTime() - d.getTime();
	const minutes = Math.floor(diff / 60_000);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);
	if (days > 7) return d.toLocaleDateString();
	if (days > 0) return `${days}d ago`;
	if (hours > 0) return `${hours}h ago`;
	if (minutes > 0) return `${minutes}m ago`;
	return "just now";
}

function formatTokens(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
	return String(n);
}

const KIND_ICONS: Record<string, string> = {
	artifact: "ph:cube",
	result: "ph:check-square",
	summary: "ph:article",
	diff: "ph:git-diff",
	log: "ph:terminal",
	document: "ph:file-text",
	upload: "ph:upload-simple",
	preview: "ph:eye",
};

const SOURCE_LABELS: Record<string, string> = {
	human: "Human",
	assistant: "Assistant",
	worker: "Worker",
	mcp: "MCP",
	import: "Import",
	system: "System",
};

export default function TaskDetailComponent(props: Record<string, unknown>) {
	const taskId = typeof props.id === "string" ? props.id : undefined;

	return (
		<div className="flex flex-col">
			<TaskDetailForm {...props} />

			{taskId && (
				<div className="border-t">
					<ActivityTimeline taskId={taskId} />
					<ArtifactsList taskId={taskId} />
				</div>
			)}
		</div>
	);
}

function ActivityTimeline({ taskId }: { taskId: string }) {
	const { data: activityData, isLoading: activityLoading } = useCollectionList(
		"activity",
		{
			where: { task: taskId },
			limit: 50,
			orderBy: { createdAt: "desc" },
		},
	);

	const { data: runsData, isLoading: runsLoading } = useCollectionList(
		"run_links",
		{
			where: { task: taskId },
			limit: 50,
			orderBy: { startedAt: "desc" },
		},
	);

	const isLoading = activityLoading || runsLoading;

	const activityDocs = React.useMemo(
		() => ((activityData as { docs?: ActivityDoc[] } | undefined)?.docs ?? []),
		[activityData],
	);
	const runsDocs = React.useMemo(
		() => ((runsData as { docs?: RunDoc[] } | undefined)?.docs ?? []),
		[runsData],
	);

	const entries = React.useMemo(() => {
		const items: TimelineEntry[] = [];

		for (const doc of activityDocs) {
			items.push({
				id: `activity-${doc.id}`,
				kind: "activity",
				timestamp: doc.createdAt,
				type: doc.type,
				actor: doc.actor,
				summary: doc.summary,
			});
		}

		for (const doc of runsDocs) {
			items.push({
				id: `run-${doc.id}`,
				kind: "run",
				timestamp: doc.startedAt ?? doc.createdAt ?? new Date().toISOString(),
				status: doc.status,
				runtime: doc.runtime,
				summary: doc.summary,
				startedAt: doc.startedAt,
				endedAt: doc.endedAt,
				tokensInput: doc.tokensInput,
				tokensOutput: doc.tokensOutput,
				initiatedBy: doc.initiatedBy,
			});
		}

		items.sort(
			(a, b) =>
				new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
		);
		return items;
	}, [activityDocs, runsDocs]);

	if (isLoading) {
		return (
			<div className="flex items-center justify-center p-8">
				<Icon
					icon="ph:spinner"
					className="text-muted-foreground size-5 animate-spin"
				/>
			</div>
		);
	}

	if (entries.length === 0) return null;

	return (
		<div className="px-6 py-4">
			<h3 className="text-muted-foreground mb-3 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider">
				<Icon icon="ph:clock-counter-clockwise" className="size-3.5" />
				Activity
			</h3>
			<div className="space-y-0">
				{entries.map((entry, index) => {
					const isLast = index === entries.length - 1;
					return entry.kind === "run" ? (
						<RunEntry key={entry.id} entry={entry} isLast={isLast} />
					) : (
						<ActivityEntry key={entry.id} entry={entry} isLast={isLast} />
					);
				})}
			</div>
		</div>
	);
}

function RunEntry({
	entry,
	isLast,
}: {
	entry: TimelineEntry;
	isLast: boolean;
}) {
	const dotColor =
		STATUS_COLORS[entry.status ?? "pending"] ?? "bg-muted-foreground";
	const icon = STATUS_ICONS[entry.status ?? "pending"] ?? "ph:play-bold";
	const duration =
		entry.startedAt && entry.endedAt
			? formatDuration(entry.startedAt, entry.endedAt)
			: null;
	const totalTokens = (entry.tokensInput ?? 0) + (entry.tokensOutput ?? 0);

	return (
		<div className="relative flex gap-3 pb-4">
			{!isLast && (
				<div className="bg-border absolute top-6 bottom-0 left-[11px] w-px" />
			)}
			<div
				className={`relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full ${dotColor}`}
			>
				<Icon icon={icon} className="size-3 text-white" />
			</div>
			<div className="min-w-0 flex-1 pt-0.5">
				<div className="flex items-center gap-2">
					<span className="text-sm font-medium capitalize">{entry.status}</span>
					{entry.runtime && (
						<Badge text={entry.runtime} color="secondary" className="text-xs" />
					)}
					{entry.initiatedBy && (
						<span className="text-muted-foreground text-xs">
							via {entry.initiatedBy}
						</span>
					)}
				</div>
				{entry.summary && (
					<p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs">
						{entry.summary}
					</p>
				)}
				<div className="text-muted-foreground mt-1 flex items-center gap-3 text-xs">
					<span>{formatRelativeTime(entry.timestamp)}</span>
					{duration && (
						<span className="flex items-center gap-1">
							<Icon icon="ph:timer" className="size-3" />
							{duration}
						</span>
					)}
					{totalTokens > 0 && (
						<span className="flex items-center gap-1">
							<Icon icon="ph:coins" className="size-3" />
							{formatTokens(totalTokens)} tokens
						</span>
					)}
				</div>
			</div>
		</div>
	);
}

function ActivityEntry({
	entry,
	isLast,
}: {
	entry: TimelineEntry;
	isLast: boolean;
}) {
	return (
		<div className="relative flex gap-3 pb-4">
			{!isLast && (
				<div className="bg-border absolute top-6 bottom-0 left-[11px] w-px" />
			)}
			<div className="bg-muted-foreground relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full">
				<Icon icon="ph:note-bold" className="size-3 text-white" />
			</div>
			<div className="min-w-0 flex-1 pt-0.5">
				<p className="text-sm font-medium">{entry.summary ?? entry.type}</p>
				{entry.actor && (
					<p className="text-muted-foreground mt-0.5 text-xs">
						by {entry.actor}
					</p>
				)}
				<p className="text-muted-foreground mt-1 text-xs">
					{formatRelativeTime(entry.timestamp)}
				</p>
			</div>
		</div>
	);
}

function ArtifactsList({ taskId }: { taskId: string }) {
	const navigate = useAdminStore(selectNavigate);
	const basePath = useAdminStore(selectBasePath);

	const { data, isLoading } = useCollectionList("knowledge", {
		where: {
			task: taskId,
			kind: { in: ["artifact", "result", "summary", "diff", "log"] },
		},
		limit: 100,
		orderBy: { createdAt: "desc" },
	});

	const docs = React.useMemo(
		() => ((data as { docs?: KnowledgeDoc[] } | undefined)?.docs ?? []),
		[data],
	);

	if (isLoading) {
		return (
			<div className="flex items-center justify-center p-8">
				<Icon
					icon="ph:spinner"
					className="text-muted-foreground size-5 animate-spin"
				/>
			</div>
		);
	}

	if (docs.length === 0) return null;

	return (
		<div className="border-t px-6 py-4">
			<h3 className="text-muted-foreground mb-3 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider">
				<Icon icon="ph:cube" className="size-3.5" />
				Artifacts
			</h3>
			<div className="divide-y">
				{docs.map((doc) => {
					const kindIcon = KIND_ICONS[doc.kind ?? ""] ?? "ph:file";
					const sourceLabel =
						SOURCE_LABELS[doc.source ?? ""] ?? doc.source ?? "";

					return (
						<button
							key={doc.id}
							type="button"
							className="hover:bg-muted/50 flex w-full items-center gap-3 py-2.5 text-left transition-colors"
							onClick={() =>
								navigate(`${basePath}/collections/knowledge/${doc.id}`)
							}
						>
							<div className="bg-muted flex size-7 shrink-0 items-center justify-center rounded">
								<Icon icon={kindIcon} className="text-muted-foreground size-3.5" />
							</div>
							<div className="min-w-0 flex-1">
								<p className="truncate text-sm font-medium">
									{doc.title || doc.path}
								</p>
								<div className="text-muted-foreground mt-0.5 flex items-center gap-2 text-xs">
									{doc.kind && (
										<Badge
											text={doc.kind}
											color="secondary"
											className="text-xs"
										/>
									)}
									{sourceLabel && <span>{sourceLabel}</span>}
									{doc.createdAt && (
										<>
											<span className="opacity-40">·</span>
											<span>{formatRelativeTime(doc.createdAt)}</span>
										</>
									)}
								</div>
							</div>
							<Icon
								icon="ph:caret-right"
								className="text-muted-foreground size-4 shrink-0"
							/>
						</button>
					);
				})}
			</div>
		</div>
	);
}
