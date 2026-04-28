import { Icon } from "@iconify/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React from "react";

import {
	selectBasePath,
	selectClient,
	selectNavigate,
	useAdminStore,
} from "@questpie/admin/client";

// ── Status helpers ─────────────────────────────────────────

const STATUS_CONFIG: Record<
	string,
	{ label: string; color: string; bgColor: string; icon: string }
> = {
	pending: {
		label: "Pending",
		color: "text-muted-foreground",
		bgColor: "bg-muted",
		icon: "ph:clock",
	},
	running: {
		label: "Running",
		color: "text-blue-600",
		bgColor: "bg-blue-500/10",
		icon: "ph:spinner",
	},
	completed: {
		label: "Completed",
		color: "text-green-600",
		bgColor: "bg-green-500/10",
		icon: "ph:check-circle",
	},
	failed: {
		label: "Failed",
		color: "text-red-600",
		bgColor: "bg-red-500/10",
		icon: "ph:x-circle",
	},
	suspended: {
		label: "Suspended",
		color: "text-orange-600",
		bgColor: "bg-orange-500/10",
		icon: "ph:pause-circle",
	},
	waiting: {
		label: "Waiting",
		color: "text-orange-600",
		bgColor: "bg-orange-500/10",
		icon: "ph:hourglass",
	},
	cancelled: {
		label: "Cancelled",
		color: "text-muted-foreground",
		bgColor: "bg-muted",
		icon: "ph:prohibit",
	},
	timed_out: {
		label: "Timed Out",
		color: "text-red-600",
		bgColor: "bg-red-500/10",
		icon: "ph:timer",
	},
	skipped: {
		label: "Skipped",
		color: "text-muted-foreground",
		bgColor: "bg-muted",
		icon: "ph:fast-forward",
	},
};

function StatusBadge({ status }: { status: string }) {
	const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
	return (
		<span
			className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${config.color} ${config.bgColor}`}
		>
			<Icon
				icon={config.icon}
				className={`size-3.5 ${status === "running" ? "animate-spin" : ""}`}
			/>
			{config.label}
		</span>
	);
}

function formatDate(d: string | Date | null): string {
	if (!d) return "-";
	return new Date(d).toLocaleString();
}

function formatDuration(
	start: string | Date | null,
	end: string | Date | null,
): string {
	if (!start) return "-";
	const s = new Date(start).getTime();
	const e = end ? new Date(end).getTime() : Date.now();
	const ms = e - s;
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
	if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)}m`;
	return `${(ms / 3_600_000).toFixed(1)}h`;
}

// ── Step type icons ────────────────────────────────────────

const STEP_TYPE_ICONS: Record<string, string> = {
	run: "ph:play",
	sleep: "ph:moon",
	waitForEvent: "ph:bell",
	sendEvent: "ph:paper-plane-tilt",
	invoke: "ph:git-branch",
};

// ── JSON viewer ────────────────────────────────────────────

function JsonView({ data, label }: { data: unknown; label: string }) {
	const [expanded, setExpanded] = React.useState(false);

	if (data === null || data === undefined) return null;

	return (
		<div className="border-border rounded-md border">
			<button
				type="button"
				onClick={() => setExpanded(!expanded)}
				className="hover:bg-muted/50 flex w-full items-center justify-between px-3 py-2 text-sm transition-colors"
			>
				<span className="text-muted-foreground font-medium">{label}</span>
				<Icon
					icon={expanded ? "ph:caret-up" : "ph:caret-down"}
					className="size-4"
				/>
			</button>
			{expanded && (
				<pre className="bg-muted/30 border-border overflow-x-auto border-t px-3 py-2 font-mono text-xs">
					{JSON.stringify(data, null, 2)}
				</pre>
			)}
		</div>
	);
}

// ── Step timeline ──────────────────────────────────────────

function StepTimeline({ steps }: { steps: any[] }) {
	if (steps.length === 0) {
		return (
			<div className="text-muted-foreground flex flex-col items-center gap-2 py-8 text-sm">
				<Icon icon="ph:steps" className="size-8 opacity-50" />
				<p>No steps recorded yet</p>
			</div>
		);
	}

	return (
		<div className="relative flex flex-col">
			{steps.map((step: any, i: number) => {
				const isLast = i === steps.length - 1;
				const statusCfg = STATUS_CONFIG[step.status] ?? STATUS_CONFIG.pending;
				const typeIcon = STEP_TYPE_ICONS[step.type] ?? "ph:question";

				return (
					<div key={step.id} className="relative flex gap-3">
						{/* Timeline line */}
						{!isLast && (
							<div className="border-border absolute top-[32px] bottom-0 left-[15px] border-l-2" />
						)}

						{/* Timeline dot */}
						<div
							className={`relative z-10 mt-1 flex size-8 shrink-0 items-center justify-center rounded-full ${statusCfg.bgColor}`}
						>
							<Icon icon={typeIcon} className={`size-4 ${statusCfg.color}`} />
						</div>

						{/* Content */}
						<div className="mb-4 flex-1 space-y-1 pb-2">
							<div className="flex items-center gap-2">
								<span className="font-mono text-sm font-medium">
									{step.name}
								</span>
								<StatusBadge status={step.status} />
								{step.hasCompensation && (
									<span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[10px] font-medium uppercase">
										compensable
									</span>
								)}
							</div>

							<div className="text-muted-foreground flex flex-wrap gap-3 text-xs">
								<span className="inline-flex items-center gap-1">
									<Icon icon="ph:clock" className="size-3" />
									{formatDate(step.createdAt)}
								</span>
								{step.startedAt && step.completedAt && (
									<span className="inline-flex items-center gap-1">
										<Icon icon="ph:timer" className="size-3" />
										{formatDuration(step.startedAt, step.completedAt)}
									</span>
								)}
								{step.eventName && (
									<span className="inline-flex items-center gap-1">
										<Icon icon="ph:bell" className="size-3" />
										{step.eventName}
									</span>
								)}
								{step.childInstanceId && (
									<span className="inline-flex items-center gap-1">
										<Icon icon="ph:git-branch" className="size-3" />
										Child: {step.childInstanceId.slice(0, 8)}...
									</span>
								)}
							</div>

							{/* Step result / error */}
							{step.result !== null && step.result !== undefined && (
								<JsonView data={step.result} label="Result" />
							)}
							{step.error && (
								<div className="mt-1 rounded-md bg-red-500/10 px-3 py-2 font-mono text-xs text-red-600">
									{typeof step.error === "string"
										? step.error
										: JSON.stringify(step.error, null, 2)}
								</div>
							)}
						</div>
					</div>
				);
			})}
		</div>
	);
}

// ── Main component ─────────────────────────────────────────

export function WorkflowDetailPage({ instanceId }: { instanceId: string }) {
	const client = useAdminStore(selectClient);
	const navigate = useAdminStore(selectNavigate);
	const basePath = useAdminStore(selectBasePath);
	const queryClient = useQueryClient();

	const [showLogs, setShowLogs] = React.useState(false);

	const { data, isLoading, error, refetch } = useQuery({
		queryKey: ["workflows", "instance", instanceId, showLogs],
		queryFn: () =>
			(client as any).routes.getWorkflowInstance({
				id: instanceId,
				includeSteps: true,
				includeLogs: showLogs,
			}) as Promise<{ instance: any; steps: any[]; logs: any[] }>,
		refetchInterval: 5000,
	});

	const cancelMutation = useMutation({
		mutationFn: () =>
			(client as any).routes.cancelWorkflowInstance({ id: instanceId }),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: ["workflows"],
			});
		},
	});

	const retryMutation = useMutation({
		mutationFn: () =>
			(client as any).routes.retryWorkflowInstance({ id: instanceId }),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: ["workflows"],
			});
		},
	});

	if (isLoading) {
		return (
			<div className="flex items-center justify-center py-20">
				<Icon
					icon="ph:spinner"
					className="text-muted-foreground size-6 animate-spin"
				/>
			</div>
		);
	}

	if (error || !data) {
		return (
			<div className="flex flex-col items-center gap-3 py-20">
				<Icon icon="ph:warning" className="text-destructive size-8" />
				<p className="text-destructive text-sm">
					{(error as Error)?.message ?? "Workflow instance not found"}
				</p>
				<button
					type="button"
					onClick={() => navigate(`${basePath}/workflows`)}
					className="bg-secondary hover:bg-secondary/80 rounded-md px-3 py-1.5 text-sm"
				>
					Back to list
				</button>
			</div>
		);
	}

	const { instance, steps, logs } = data;
	const _statusCfg = STATUS_CONFIG[instance.status] ?? STATUS_CONFIG.pending;
	const canCancel = ["pending", "running", "suspended"].includes(
		instance.status,
	);
	const canRetry = ["failed", "timed_out"].includes(instance.status);

	return (
		<div className="flex flex-col gap-6 p-6">
			{/* Breadcrumb + back */}
			<div className="flex items-center gap-2 text-sm">
				<button
					type="button"
					onClick={() => navigate(`${basePath}/workflows`)}
					className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 transition-colors"
				>
					<Icon icon="ph:arrow-left" className="size-4" />
					Workflows
				</button>
				<Icon icon="ph:caret-right" className="text-muted-foreground size-3" />
				<span className="font-mono">{instance.name}</span>
			</div>

			{/* Header card */}
			<div className="border-border rounded-lg border p-5">
				<div className="flex items-start justify-between">
					<div className="space-y-1">
						<div className="flex items-center gap-3">
							<h1 className="text-xl font-semibold">{instance.name}</h1>
							<StatusBadge status={instance.status} />
						</div>
						<p className="text-muted-foreground font-mono text-xs">
							{instance.id}
						</p>
					</div>
					<div className="flex gap-2">
						<button
							type="button"
							onClick={() => refetch()}
							className="bg-secondary hover:bg-secondary/80 inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm"
						>
							<Icon icon="ph:arrow-clockwise" className="size-4" />
							Refresh
						</button>
						{canCancel && (
							<button
								type="button"
								onClick={() => cancelMutation.mutate()}
								disabled={cancelMutation.isPending}
								className="bg-destructive/10 text-destructive hover:bg-destructive/20 inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm disabled:opacity-50"
							>
								<Icon icon="ph:stop" className="size-4" />
								Cancel
							</button>
						)}
						{canRetry && (
							<button
								type="button"
								onClick={() => retryMutation.mutate()}
								disabled={retryMutation.isPending}
								className="bg-primary/10 text-primary hover:bg-primary/20 inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm disabled:opacity-50"
							>
								<Icon icon="ph:arrow-counter-clockwise" className="size-4" />
								Retry
							</button>
						)}
					</div>
				</div>

				{/* Metadata grid */}
				<div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
					<div>
						<dt className="text-muted-foreground text-xs">Started</dt>
						<dd className="text-sm">
							{formatDate(instance.startedAt ?? instance.createdAt)}
						</dd>
					</div>
					<div>
						<dt className="text-muted-foreground text-xs">Duration</dt>
						<dd className="text-sm">
							{formatDuration(
								instance.startedAt ?? instance.createdAt,
								instance.completedAt,
							)}
						</dd>
					</div>
					<div>
						<dt className="text-muted-foreground text-xs">Attempt</dt>
						<dd className="text-sm">{instance.attempt}</dd>
					</div>
					{instance.parentInstanceId && (
						<div>
							<dt className="text-muted-foreground text-xs">Parent</dt>
							<dd className="text-sm">
								<button
									type="button"
									onClick={() =>
										navigate(
											`${basePath}/workflows/${instance.parentInstanceId}`,
										)
									}
									className="text-primary hover:underline"
								>
									{instance.parentInstanceId.slice(0, 8)}...
								</button>
							</dd>
						</div>
					)}
				</div>

				{/* Error display */}
				{instance.error && (
					<div className="mt-4 rounded-md bg-red-500/10 px-4 py-3">
						<p className="text-sm font-medium text-red-600">Error</p>
						<pre className="mt-1 overflow-x-auto font-mono text-xs text-red-600">
							{typeof instance.error === "string"
								? instance.error
								: JSON.stringify(instance.error, null, 2)}
						</pre>
					</div>
				)}

				{/* Input / Output */}
				<div className="mt-4 flex flex-col gap-2">
					<JsonView data={instance.input} label="Input" />
					<JsonView data={instance.output} label="Output" />
				</div>
			</div>

			{/* Steps timeline */}
			<div className="border-border rounded-lg border">
				<div className="border-border flex items-center justify-between border-b px-5 py-3">
					<h2 className="font-semibold">Steps</h2>
					<span className="text-muted-foreground text-sm">
						{steps.length} step{steps.length !== 1 ? "s" : ""}
					</span>
				</div>
				<div className="p-5">
					<StepTimeline steps={steps} />
				</div>
			</div>

			{/* Logs panel */}
			<div className="border-border rounded-lg border">
				<button
					type="button"
					onClick={() => setShowLogs(!showLogs)}
					className="hover:bg-muted/50 flex w-full items-center justify-between px-5 py-3 transition-colors"
				>
					<h2 className="font-semibold">Logs</h2>
					<Icon
						icon={showLogs ? "ph:caret-up" : "ph:caret-down"}
						className="size-4"
					/>
				</button>
				{showLogs && logs.length > 0 && (
					<div className="border-border border-t">
						<div className="max-h-80 overflow-y-auto">
							{logs.map((log: any) => {
								const levelColors: Record<string, string> = {
									error: "text-red-600",
									warn: "text-orange-600",
									info: "text-blue-600",
									debug: "text-muted-foreground",
								};
								return (
									<div
										key={log.id}
										className="border-border flex items-start gap-3 border-b px-5 py-2 last:border-b-0"
									>
										<span
											className={`mt-0.5 font-mono text-xs uppercase ${levelColors[log.level] ?? ""}`}
										>
											{log.level}
										</span>
										<span className="flex-1 text-sm">{log.message}</span>
										<span className="text-muted-foreground shrink-0 text-xs">
											{formatDate(log.createdAt)}
										</span>
									</div>
								);
							})}
						</div>
					</div>
				)}
				{showLogs && logs.length === 0 && (
					<div className="text-muted-foreground border-border border-t px-5 py-6 text-center text-sm">
						No logs recorded
					</div>
				)}
			</div>
		</div>
	);
}
