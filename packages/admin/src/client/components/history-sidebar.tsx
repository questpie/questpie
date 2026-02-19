import { Icon } from "@iconify/react";
import * as React from "react";
import type { AuditEntry } from "../hooks/use-audit-history";
import { useTranslation } from "../i18n/hooks";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "./ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";

// ============================================================================
// Types
// ============================================================================

type VersionItem = {
	versionId?: string;
	versionNumber?: number;
	versionOperation?: string;
	versionUserId?: string | null;
	versionCreatedAt?: string | Date;
};

export interface HistorySidebarProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	// Activity tab
	auditEntries: AuditEntry[];
	isLoadingAudit?: boolean;
	// Versions tab (optional)
	versions?: VersionItem[];
	isLoadingVersions?: boolean;
	isReverting?: boolean;
	onRevert?: (version: VersionItem) => Promise<void>;
	// Config
	showVersionsTab?: boolean;
}

// ============================================================================
// Helpers
// ============================================================================

function formatRelativeTime(date: Date): string {
	const now = new Date();
	const diff = now.getTime() - date.getTime();
	const seconds = Math.floor(diff / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);

	if (days > 0) return `${days}d ago`;
	if (hours > 0) return `${hours}h ago`;
	if (minutes > 0) return `${minutes}m ago`;
	return "just now";
}

function getActionConfig(action: string) {
	switch (action) {
		case "create":
			return { color: "bg-emerald-500", icon: "ph:plus", variant: "success" };
		case "update":
			return {
				color: "bg-blue-500",
				icon: "ph:pencil-simple",
				variant: "info",
			};
		case "delete":
			return { color: "bg-red-500", icon: "ph:trash", variant: "error" };
		case "transition":
			return {
				color: "bg-amber-500",
				icon: "ph:arrows-left-right",
				variant: "warning",
			};
		default:
			return {
				color: "bg-gray-500",
				icon: "ph:clock-counter-clockwise",
				variant: "default",
			};
	}
}

function formatChangeValue(value: unknown): string {
	if (value === null || value === undefined) return "—";
	if (typeof value === "boolean") return value ? "true" : "false";
	if (typeof value === "object") {
		try {
			const str = JSON.stringify(value, null, 2);
			return str.length > 120 ? `${str.slice(0, 120)}…` : str;
		} catch {
			return String(value);
		}
	}
	const str = String(value);
	return str.length > 120 ? `${str.slice(0, 120)}…` : str;
}

// ============================================================================
// ChangeDiff
// ============================================================================

function ChangeDiff({
	changes,
}: {
	changes: Record<string, { from: unknown; to: unknown }>;
}) {
	const { t } = useTranslation();
	const entries = Object.entries(changes);
	const [expanded, setExpanded] = React.useState(false);

	if (entries.length === 0) return null;

	return (
		<div className="mt-2">
			<button
				type="button"
				className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 cursor-pointer"
				onClick={() => setExpanded(!expanded)}
			>
				<Icon
					icon={expanded ? "ph:caret-down" : "ph:caret-right"}
					className="size-3"
				/>
				{expanded
					? t("history.hideChanges")
					: t("history.showChanges", { count: entries.length })}
			</button>
			{expanded && (
				<div className="mt-1.5 space-y-1.5 text-xs">
					{entries.map(([field, { from, to }]) => (
						<div key={field} className="rounded border px-2 py-1.5 bg-muted/30">
							<span className="font-medium text-foreground">{field}</span>
							<div className="mt-0.5 flex flex-col gap-0.5">
								<span className="text-red-600 dark:text-red-400">
									<span className="opacity-50">- </span>
									{formatChangeValue(from)}
								</span>
								<span className="text-emerald-600 dark:text-emerald-400">
									<span className="opacity-50">+ </span>
									{formatChangeValue(to)}
								</span>
							</div>
						</div>
					))}
				</div>
			)}
		</div>
	);
}

// ============================================================================
// Activity Timeline
// ============================================================================

function ActivityTimeline({
	entries,
	isLoading,
}: {
	entries: AuditEntry[];
	isLoading?: boolean;
}) {
	const { t } = useTranslation();

	if (isLoading) {
		return (
			<div className="flex items-center justify-center py-12 text-muted-foreground">
				<Icon icon="ph:spinner-gap" className="size-5 animate-spin" />
			</div>
		);
	}

	if (entries.length === 0) {
		return (
			<p className="text-sm text-muted-foreground py-6 text-center">
				{t("history.empty")}
			</p>
		);
	}

	return (
		<div className="space-y-0">
			{entries.map((entry, index) => {
				const config = getActionConfig(entry.action);
				const date = new Date(entry.createdAt);
				const isLast = index === entries.length - 1;

				return (
					<div key={entry.id} className="flex gap-3">
						{/* Timeline line + dot */}
						<div className="flex flex-col items-center">
							<div
								className={`size-2.5 rounded-full mt-1.5 shrink-0 ${config.color}`}
							/>
							{!isLast && (
								<div className="w-px flex-1 bg-border min-h-4" />
							)}
						</div>

						{/* Content */}
						<div className="pb-4 min-w-0 flex-1">
							<div className="flex items-start justify-between gap-2">
								<p className="text-sm leading-snug">
									{entry.title}
								</p>
								<span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
									{formatRelativeTime(date)}
								</span>
							</div>
							{entry.changes &&
								Object.keys(entry.changes).length > 0 && (
									<ChangeDiff changes={entry.changes} />
								)}
						</div>
					</div>
				);
			})}
		</div>
	);
}

// ============================================================================
// Versions List
// ============================================================================

function VersionsList({
	versions,
	isLoading,
	isReverting,
	onRevert,
}: {
	versions: VersionItem[];
	isLoading?: boolean;
	isReverting?: boolean;
	onRevert?: (version: VersionItem) => Promise<void>;
}) {
	const { t } = useTranslation();

	const sortedVersions = React.useMemo(() => {
		return [...versions].sort((a, b) => {
			const aNum = a.versionNumber ?? 0;
			const bNum = b.versionNumber ?? 0;
			return bNum - aNum;
		});
	}, [versions]);

	function operationLabel(operation: string | undefined) {
		switch (operation) {
			case "create":
				return t("version.operationCreate");
			case "delete":
				return t("version.operationDelete");
			case "update":
				return t("version.operationUpdate");
			default:
				return operation || t("version.operationUnknown");
		}
	}

	const formatDate = (value?: string | Date) => {
		if (!value) return "-";
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return "-";
		return date.toLocaleString();
	};

	if (isLoading) {
		return (
			<div className="flex items-center justify-center py-12 text-muted-foreground">
				<Icon icon="ph:spinner-gap" className="size-5 animate-spin" />
			</div>
		);
	}

	if (sortedVersions.length === 0) {
		return (
			<p className="text-sm text-muted-foreground py-6 text-center">
				{t("version.empty")}
			</p>
		);
	}

	return (
		<div className="space-y-2">
			{sortedVersions.map((version, index) => {
				const canRevert =
					typeof version.versionId === "string" ||
					typeof version.versionNumber === "number";

				return (
					<div
						key={
							version.versionId ??
							`${version.versionNumber ?? "unknown"}-${index}`
						}
						className="rounded-md border p-3"
					>
						<div className="flex items-start justify-between gap-3">
							<div className="min-w-0">
								<div className="flex items-center gap-2">
									<Badge variant="secondary">
										{t("version.label", {
											number: version.versionNumber ?? "-",
										})}
									</Badge>
									<span className="text-sm text-muted-foreground">
										{operationLabel(version.versionOperation)}
									</span>
								</div>
								<p className="text-xs text-muted-foreground mt-1">
									{t("version.createdAt")}:{" "}
									{formatDate(version.versionCreatedAt)}
								</p>
								<p className="text-xs text-muted-foreground">
									{t("version.user")}: {version.versionUserId || "-"}
								</p>
							</div>
							{onRevert && (
								<Button
									variant="outline"
									size="sm"
									disabled={!canRevert || isReverting}
									onClick={() => {
										void onRevert(version);
									}}
								>
									{t("version.revert")}
								</Button>
							)}
						</div>
					</div>
				);
			})}
		</div>
	);
}

// ============================================================================
// HistorySidebar
// ============================================================================

export function HistorySidebar({
	open,
	onOpenChange,
	auditEntries,
	isLoadingAudit = false,
	versions,
	isLoadingVersions = false,
	isReverting = false,
	onRevert,
	showVersionsTab = false,
}: HistorySidebarProps): React.ReactElement {
	const { t } = useTranslation();

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent side="right" className="sm:max-w-xl flex flex-col p-0">
				<SheetHeader className="px-6 py-5 border-b">
					<SheetTitle>{t("history.title")}</SheetTitle>
					<SheetDescription>{t("history.description")}</SheetDescription>
				</SheetHeader>

				{showVersionsTab ? (
					<Tabs defaultValue="activity" className="flex-1 flex flex-col min-h-0">
						<div className="px-6 pt-3">
							<TabsList variant="line">
								<TabsTrigger value="activity">
									{t("history.tabActivity")}
								</TabsTrigger>
								<TabsTrigger value="versions">
									{t("history.tabVersions")}
								</TabsTrigger>
							</TabsList>
						</div>

						<TabsContent
							value="activity"
							className="flex-1 overflow-y-auto px-6 py-4"
						>
							<ActivityTimeline
								entries={auditEntries}
								isLoading={isLoadingAudit}
							/>
						</TabsContent>

						<TabsContent
							value="versions"
							className="flex-1 overflow-y-auto px-6 py-4"
						>
							<VersionsList
								versions={versions ?? []}
								isLoading={isLoadingVersions}
								isReverting={isReverting}
								onRevert={onRevert}
							/>
						</TabsContent>
					</Tabs>
				) : (
					<div className="flex-1 overflow-y-auto px-6 py-4">
						<ActivityTimeline
							entries={auditEntries}
							isLoading={isLoadingAudit}
						/>
					</div>
				)}
			</SheetContent>
		</Sheet>
	);
}
