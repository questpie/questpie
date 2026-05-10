import { Icon } from "@iconify/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import {
	AdminLink,
	page,
	selectBasePath,
	selectClient,
	useAdminStore,
} from "@questpie/admin/client";

import {
	type Doc,
	docsFromResult,
	formatDateTime,
	itemTitle,
	relationTitle,
	statusTone,
	useCollectionRealtime,
} from "../lib/records";

async function loadInspectableRuns(client: unknown) {
	const api = (client as any)?.collections?.runs;
	if (!api?.find) return [];
	return docsFromResult(
		await api.find({
			limit: 80,
			orderBy: { updatedAt: "desc" },
			with: { project: true, task: true, worker: true },
		}),
	).filter((run) => run.project);
}

async function loadRunDiff(
	client: unknown,
	runId: string | null,
	path: string,
) {
	if (!runId) return null;
	return (client as any).routes.workspaceInspection.diff({
		runId,
		path: path || undefined,
		includeDirty: true,
	});
}

async function loadWorkspaceList(
	client: unknown,
	runId: string | null,
	path: string,
) {
	if (!runId) return null;
	return (client as any).routes.workspaceInspection.list({
		runId,
		path: path || undefined,
	});
}

async function loadWorkspaceFile(
	client: unknown,
	runId: string | null,
	path: string | null,
) {
	if (!runId || !path) return null;
	return (client as any).routes.workspaceInspection.content({
		runId,
		path,
	});
}

async function loadRunKnowledge(client: unknown, runId: string | null) {
	if (!runId) return [];
	const api = (client as any)?.collections?.knowledge;
	if (!api?.find) return [];
	return docsFromResult(
		await api.find({
			where: { run: runId },
			limit: 30,
			orderBy: { updatedAt: "desc" },
		}),
	);
}

function RunSelector({
	runs,
	selectedRunId,
	onSelect,
}: {
	runs: Doc[];
	selectedRunId: string | null;
	onSelect: (id: string) => void;
}) {
	return (
		<aside className="border-border-subtle bg-card/30 flex min-h-0 w-80 shrink-0 flex-col border-r">
			<div className="border-border-subtle flex h-12 items-center gap-2 border-b px-3">
				<Icon icon="ph:git-diff" className="text-primary size-4" />
				<h1 className="text-sm font-semibold">Inspection</h1>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto p-2">
				{runs.length === 0 ? (
					<p className="text-muted-foreground px-2 py-8 text-center text-xs">
						No project runs.
					</p>
				) : (
					runs.map((run) => {
						const selected = run.id === selectedRunId;
						return (
							<button
								key={run.id}
								type="button"
								onClick={() => onSelect(run.id)}
								className={[
									"item-surface mb-1 min-h-16 w-full px-3 py-2 text-left transition-colors",
									selected
										? "border-primary/40 bg-primary/10"
										: "hover:bg-muted/70",
								].join(" ")}
							>
								<div className="flex items-center gap-2">
									<span
										className={[
											"size-2 rounded-full",
											statusTone(run.status),
										].join(" ")}
									/>
									<span className="truncate text-xs font-medium">
										{relationTitle(run.task, run.id)}
									</span>
									<span className="text-muted-foreground ml-auto text-[10px]">
										{formatDateTime(run.updatedAt)}
									</span>
								</div>
								<div className="text-muted-foreground mt-1 truncate text-[11px]">
									{relationTitle(run.project, "Project")}
								</div>
							</button>
						);
					})
				)}
			</div>
		</aside>
	);
}

function WorkspaceBrowser({
	entries,
	path,
	selectedFile,
	onPath,
	onFile,
}: {
	entries: Doc[];
	path: string;
	selectedFile: string | null;
	onPath: (path: string) => void;
	onFile: (path: string) => void;
}) {
	const parent = path.split("/").slice(0, -1).join("/");
	return (
		<section className="border-border-subtle bg-card/20 flex min-h-0 w-80 shrink-0 flex-col border-r">
			<div className="border-border-subtle flex h-12 items-center gap-2 border-b px-3">
				<button
					type="button"
					onClick={() => onPath(parent)}
					disabled={!path}
					className="control-surface disabled:text-muted-foreground flex h-8 w-8 items-center justify-center disabled:cursor-not-allowed"
					aria-label="Parent path"
				>
					<Icon icon="ph:arrow-up" className="size-4" />
				</button>
				<div className="min-w-0 flex-1 truncate text-xs">
					{path || "workspace"}
				</div>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto p-2">
				{entries.map((entry) => {
					const directory = entry.type === "directory";
					const selected = selectedFile === entry.path;
					return (
						<button
							key={entry.path}
							type="button"
							onClick={() =>
								directory ? onPath(entry.path) : onFile(entry.path)
							}
							className={[
								"hover:bg-muted/70 flex min-h-9 w-full items-center gap-2 px-2 text-left text-xs",
								selected ? "bg-primary/10 text-primary" : "",
							].join(" ")}
						>
							<Icon
								icon={directory ? "ph:folder" : "ph:file"}
								className="text-muted-foreground size-4 shrink-0"
							/>
							<span className="truncate">{entry.name}</span>
						</button>
					);
				})}
			</div>
		</section>
	);
}

function DiffPanel({
	diff,
	file,
	selectedRun,
	basePath,
}: {
	diff: Doc | null;
	file: Doc | null;
	selectedRun: Doc | null;
	basePath: string;
}) {
	return (
		<section className="flex min-h-0 flex-1 flex-col">
			<div className="border-border-subtle flex h-12 items-center gap-3 border-b px-4">
				<Icon icon="ph:code" className="text-primary size-4" />
				<div className="min-w-0 flex-1">
					<h2 className="truncate text-sm font-semibold">
						{selectedRun
							? relationTitle(selectedRun.project, "Project")
							: "Run"}
					</h2>
					<p className="text-muted-foreground truncate text-[11px]">
						{selectedRun ? selectedRun.id : "Select a run"}
					</p>
				</div>
				{selectedRun ? (
					<AdminLink
						href={`${basePath}/collections/runs/${selectedRun.id}`}
						className="text-primary text-xs"
					>
						Open Run
					</AdminLink>
				) : null}
			</div>
			{diff ? (
				<div className="border-border-subtle bg-border grid grid-cols-4 gap-px border-b">
					{[
						["Files", diff.stats?.filesChanged ?? 0],
						["Insertions", diff.stats?.insertions ?? 0],
						["Deletions", diff.stats?.deletions ?? 0],
						["Head", diff.head ?? "working-tree"],
					].map(([label, value]) => (
						<div key={label} className="bg-background px-3 py-2">
							<div className="text-muted-foreground text-[10px] uppercase">
								{label}
							</div>
							<div className="truncate text-xs tabular-nums">{value}</div>
						</div>
					))}
				</div>
			) : null}
			<div className="min-h-0 flex-1 overflow-auto p-4">
				{file?.content ? (
					<pre className="border-border-subtle bg-card/40 mb-4 border p-4 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap">
						{file.content}
					</pre>
				) : null}
				<pre className="border-border-subtle bg-card/40 min-h-full border p-4 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap">
					{diff?.diff || "No diff."}
				</pre>
			</div>
		</section>
	);
}

function ArtifactsRail({
	resources,
	basePath,
}: {
	resources: Doc[];
	basePath: string;
}) {
	return (
		<aside className="border-border-subtle bg-card/30 flex min-h-0 w-72 shrink-0 flex-col border-l">
			<div className="border-border-subtle flex h-12 items-center gap-2 border-b px-3">
				<Icon icon="ph:archive" className="text-muted-foreground size-4" />
				<h2 className="text-sm font-semibold">Artifacts</h2>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto p-2">
				{resources.length === 0 ? (
					<p className="text-muted-foreground px-2 py-8 text-center text-xs">
						No artifacts.
					</p>
				) : (
					resources.map((resource) => (
						<AdminLink
							key={resource.id}
							href={`${basePath}/knowledge?resource=${encodeURIComponent(resource.id)}`}
							className="item-surface hover:bg-muted/70 mb-1 block px-3 py-2"
						>
							<div className="truncate text-xs font-medium">
								{itemTitle(resource, "Artifact")}
							</div>
							<div className="text-muted-foreground mt-1 truncate text-[11px]">
								{resource.path}
							</div>
						</AdminLink>
					))
				)}
			</div>
		</aside>
	);
}

function ProjectInspectionPage() {
	const client = useAdminStore(selectClient);
	const basePath = useAdminStore(selectBasePath);
	const queryClient = useQueryClient();
	const [selectedRunId, setSelectedRunId] = React.useState<string | null>(
		() => {
			if (typeof window === "undefined") return null;
			return new URLSearchParams(window.location.search).get("run");
		},
	);
	const [path, setPath] = React.useState("");
	const [selectedFile, setSelectedFile] = React.useState<string | null>(null);

	const runsQuery = useQuery({
		queryKey: ["autopilot", "inspection", "runs"],
		queryFn: () => loadInspectableRuns(client),
		enabled: !!client,
	});
	const diffQuery = useQuery({
		queryKey: ["autopilot", "inspection", selectedRunId, "diff", path],
		queryFn: () => loadRunDiff(client, selectedRunId, path),
		enabled: !!client && !!selectedRunId,
	});
	const listQuery = useQuery({
		queryKey: ["autopilot", "inspection", selectedRunId, "list", path],
		queryFn: () => loadWorkspaceList(client, selectedRunId, path),
		enabled: !!client && !!selectedRunId,
	});
	const fileQuery = useQuery({
		queryKey: ["autopilot", "inspection", selectedRunId, "file", selectedFile],
		queryFn: () => loadWorkspaceFile(client, selectedRunId, selectedFile),
		enabled: !!client && !!selectedRunId && !!selectedFile,
	});
	const knowledgeQuery = useQuery({
		queryKey: ["autopilot", "inspection", selectedRunId, "knowledge"],
		queryFn: () => loadRunKnowledge(client, selectedRunId),
		enabled: !!client && !!selectedRunId,
	});

	const invalidateRuns = React.useCallback(() => {
		void queryClient.invalidateQueries({
			queryKey: ["autopilot", "inspection"],
		});
	}, [queryClient]);

	useCollectionRealtime(client, "runs", invalidateRuns);
	useCollectionRealtime(client, "knowledge", invalidateRuns);

	const runs = runsQuery.data ?? [];
	const selectedRun =
		runs.find((run) => run.id === selectedRunId) ?? runs[0] ?? null;

	React.useEffect(() => {
		if (!selectedRunId && runs[0]?.id) setSelectedRunId(runs[0].id);
	}, [runs, selectedRunId]);

	const selectRun = (id: string) => {
		setSelectedRunId(id);
		setPath("");
		setSelectedFile(null);
		if (typeof window !== "undefined") {
			const url = new URL(window.location.href);
			url.searchParams.set("run", id);
			window.history.replaceState(null, "", url);
		}
	};

	return (
		<div className="bg-background flex h-[calc(100vh-3.5rem)] min-h-[620px] overflow-hidden">
			<RunSelector
				runs={runs}
				selectedRunId={selectedRun?.id ?? null}
				onSelect={selectRun}
			/>
			<WorkspaceBrowser
				entries={docsFromResult((listQuery.data as any)?.entries ?? [])}
				path={path}
				selectedFile={selectedFile}
				onPath={(nextPath) => {
					setPath(nextPath);
					setSelectedFile(null);
				}}
				onFile={setSelectedFile}
			/>
			<DiffPanel
				diff={(diffQuery.data as Doc | null) ?? null}
				file={(fileQuery.data as Doc | null) ?? null}
				selectedRun={selectedRun}
				basePath={basePath}
			/>
			<ArtifactsRail
				resources={knowledgeQuery.data ?? []}
				basePath={basePath}
			/>
		</div>
	);
}

export default page("project-inspection", {
	path: "/project-inspection",
	label: { en: "Project Inspection" },
	component: ProjectInspectionPage,
	showInNav: false,
});
