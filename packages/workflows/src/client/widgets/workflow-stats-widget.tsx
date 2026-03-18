import { Icon } from "@iconify/react";
import { useServerWidgetData } from "@questpie/admin/client";

interface WorkflowStats {
	total: number;
	running: number;
	failed: number;
	completed: number;
}

interface WorkflowStatsWidgetProps {
	config: {
		id: string;
		hasLoader?: boolean;
		refreshInterval?: number;
		label?: unknown;
	};
}

const STAT_ITEMS = [
	{
		key: "total" as const,
		label: "Total",
		icon: "ph:flow-arrow",
		color: "text-foreground",
	},
	{
		key: "running" as const,
		label: "Running",
		icon: "ph:spinner",
		color: "text-blue-500",
	},
	{
		key: "completed" as const,
		label: "Completed",
		icon: "ph:check-circle",
		color: "text-green-500",
	},
	{
		key: "failed" as const,
		label: "Failed",
		icon: "ph:x-circle",
		color: "text-red-500",
	},
];

export default function WorkflowStatsWidget({
	config,
}: WorkflowStatsWidgetProps) {
	const { data, isLoading, error } = useServerWidgetData<WorkflowStats>(
		config.id,
		{
			refreshInterval: config.refreshInterval ?? 10_000,
		},
	);

	if (isLoading) {
		return (
			<div className="flex items-center justify-center py-8">
				<Icon
					icon="ph:spinner"
					className="text-muted-foreground size-5 animate-spin"
				/>
			</div>
		);
	}

	if (error) {
		return (
			<div className="text-muted-foreground py-8 text-center text-sm">
				Failed to load workflow stats
			</div>
		);
	}

	const stats = data ?? { total: 0, running: 0, failed: 0, completed: 0 };

	return (
		<div className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
			{STAT_ITEMS.map((item) => (
				<div key={item.key} className="flex flex-col items-center gap-1">
					<Icon icon={item.icon} className={`size-5 ${item.color}`} />
					<span className="text-2xl font-semibold">{stats[item.key]}</span>
					<span className="text-muted-foreground text-xs">{item.label}</span>
				</div>
			))}
		</div>
	);
}
