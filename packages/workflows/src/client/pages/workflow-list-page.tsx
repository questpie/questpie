import { Icon } from "@iconify/react";
import { useQuery } from "@tanstack/react-query";
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
	{ label: string; color: string; icon: string }
> = {
	pending: {
		label: "Pending",
		color: "text-muted-foreground",
		icon: "ph:clock",
	},
	running: { label: "Running", color: "text-blue-500", icon: "ph:spinner" },
	suspended: {
		label: "Suspended",
		color: "text-orange-500",
		icon: "ph:pause-circle",
	},
	completed: {
		label: "Completed",
		color: "text-green-500",
		icon: "ph:check-circle",
	},
	failed: { label: "Failed", color: "text-red-500", icon: "ph:x-circle" },
	cancelled: {
		label: "Cancelled",
		color: "text-muted-foreground",
		icon: "ph:prohibit",
	},
	timed_out: { label: "Timed Out", color: "text-red-500", icon: "ph:timer" },
};

function StatusBadge({ status }: { status: string }) {
	const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
	return (
		<span
			className={`inline-flex items-center gap-1.5 text-sm ${config.color}`}
		>
			<Icon icon={config.icon} className="size-4" />
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

// ── Status filter tabs ─────────────────────────────────────

const STATUS_FILTERS = [
	{ value: "", label: "All" },
	{ value: "running", label: "Running" },
	{ value: "suspended", label: "Suspended" },
	{ value: "completed", label: "Completed" },
	{ value: "failed", label: "Failed" },
	{ value: "pending", label: "Pending" },
];

// ── Main component ─────────────────────────────────────────

export function WorkflowListPage() {
	const client = useAdminStore(selectClient);
	const navigate = useAdminStore(selectNavigate);
	const basePath = useAdminStore(selectBasePath);

	const [statusFilter, setStatusFilter] = React.useState("");
	const [page, setPage] = React.useState(1);
	const limit = 20;

	const { data, isLoading, error, refetch } = useQuery({
		queryKey: ["workflows", "instances", statusFilter, page, limit],
		queryFn: () =>
			(client as any).routes.listWorkflowInstances({
				status: statusFilter || undefined,
				limit,
				page,
			}) as Promise<{
				docs: any[];
				totalDocs: number;
				page: number;
				limit: number;
			}>,
		refetchInterval: 5000,
	});

	const totalPages = data ? Math.ceil(data.totalDocs / limit) : 0;

	return (
		<div className="flex flex-col gap-6 p-6">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-semibold">Workflows</h1>
					<p className="text-muted-foreground text-sm">
						Monitor and manage workflow instances
					</p>
				</div>
				<button
					type="button"
					onClick={() => refetch()}
					className="bg-secondary hover:bg-secondary/80 inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm"
				>
					<Icon icon="ph:arrow-clockwise" className="size-4" />
					Refresh
				</button>
			</div>

			{/* Status filter tabs */}
			<div className="border-border flex gap-1 border-b">
				{STATUS_FILTERS.map((filter) => (
					<button
						key={filter.value}
						type="button"
						onClick={() => {
							setStatusFilter(filter.value);
							setPage(1);
						}}
						className={`px-3 py-2 text-sm transition-colors ${
							statusFilter === filter.value
								? "border-primary text-foreground border-b-2 font-medium"
								: "text-muted-foreground hover:text-foreground"
						}`}
					>
						{filter.label}
					</button>
				))}
			</div>

			{/* Loading state */}
			{isLoading && (
				<div className="flex items-center justify-center py-12">
					<Icon
						icon="ph:spinner"
						className="text-muted-foreground size-6 animate-spin"
					/>
				</div>
			)}

			{/* Error state */}
			{error && (
				<div className="bg-destructive/10 text-destructive rounded-md p-4 text-sm">
					Failed to load workflows: {(error as Error).message}
				</div>
			)}

			{/* Table */}
			{data && !isLoading && (
				<>
					{data.docs.length === 0 ? (
						<div className="text-muted-foreground flex flex-col items-center justify-center gap-2 py-12">
							<Icon icon="ph:flow-arrow" className="size-10 opacity-50" />
							<p className="text-sm">No workflow instances found</p>
						</div>
					) : (
						<div className="border-border overflow-hidden rounded-md border">
							<table className="w-full text-sm">
								<thead>
									<tr className="bg-muted/50 border-border border-b">
										<th className="px-4 py-3 text-left font-medium">Name</th>
										<th className="px-4 py-3 text-left font-medium">Status</th>
										<th className="px-4 py-3 text-left font-medium">Started</th>
										<th className="px-4 py-3 text-left font-medium">
											Duration
										</th>
										<th className="px-4 py-3 text-left font-medium">Attempt</th>
									</tr>
								</thead>
								<tbody>
									{data.docs.map((instance: any) => (
										<tr
											key={instance.id}
											onClick={() =>
												navigate(`${basePath}/workflows/${instance.id}`)
											}
											className="border-border hover:bg-muted/30 cursor-pointer border-b transition-colors last:border-b-0"
										>
											<td className="px-4 py-3 font-mono text-sm">
												{instance.name}
											</td>
											<td className="px-4 py-3">
												<StatusBadge status={instance.status} />
											</td>
											<td className="text-muted-foreground px-4 py-3">
												{formatDate(instance.startedAt ?? instance.createdAt)}
											</td>
											<td className="text-muted-foreground px-4 py-3">
												{formatDuration(
													instance.startedAt ?? instance.createdAt,
													instance.completedAt,
												)}
											</td>
											<td className="text-muted-foreground px-4 py-3">
												{instance.attempt}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}

					{/* Pagination */}
					{totalPages > 1 && (
						<div className="flex items-center justify-between">
							<span className="text-muted-foreground text-sm">
								Page {page} of {totalPages} ({data.totalDocs} total)
							</span>
							<div className="flex gap-2">
								<button
									type="button"
									disabled={page <= 1}
									onClick={() => setPage((p) => Math.max(1, p - 1))}
									className="bg-secondary hover:bg-secondary/80 rounded-md px-3 py-1.5 text-sm disabled:opacity-50"
								>
									Previous
								</button>
								<button
									type="button"
									disabled={page >= totalPages}
									onClick={() => setPage((p) => p + 1)}
									className="bg-secondary hover:bg-secondary/80 rounded-md px-3 py-1.5 text-sm disabled:opacity-50"
								>
									Next
								</button>
							</div>
						</div>
					)}
				</>
			)}
		</div>
	);
}
