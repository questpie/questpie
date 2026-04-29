import { Icon } from "@iconify/react";
import * as React from "react";

import type { AuditEntry } from "../hooks/use-audit-history";
import { useResolveText, useTranslation } from "../i18n/hooks";
import type { I18nText } from "../i18n/types";
import { cn, formatLabel } from "../lib/utils";
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "./ui/accordion";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { EmptyState } from "./ui/empty-state";
import { ScrollFade } from "./ui/scroll-fade";
import { Separator } from "./ui/separator";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "./ui/sheet";
import { Skeleton } from "./ui/skeleton";

// ============================================================================
// Types
// ============================================================================

type VersionItem = {
	id?: string | number;
	versionId?: string;
	versionNumber?: number;
	versionOperation?: string;
	versionUserId?: string | null;
	versionCreatedAt?: string | Date;
	versionStage?: string | null;
	[key: string]: unknown;
};

type HistoryFieldSchema = {
	name?: string;
	metadata?: {
		type?: string;
		label?: I18nText;
		options?: Array<{ value: unknown; label: I18nText }>;
		multiple?: boolean;
		writeOnly?: boolean;
	};
	access?: {
		read?:
			| { allowed: true }
			| { allowed: false; reason?: string }
			| {
					allowed: "filtered";
					where?: unknown;
			  };
	};
};

type FieldDiff = {
	name: string;
	label: string;
	type: string;
	kind: "added" | "removed" | "changed";
	from: unknown;
	to: unknown;
};

interface HistorySidebarProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	// Activity fallback for non-versioned resources.
	auditEntries?: AuditEntry[];
	isLoadingAudit?: boolean;
	// Versions view.
	versions?: VersionItem[];
	fields?: Record<string, HistoryFieldSchema>;
	isLoadingVersions?: boolean;
	isReverting?: boolean;
	onRevert?: (version: VersionItem) => Promise<void>;
	// Config
	showVersionsTab?: boolean;
}

// ============================================================================
// Helpers
// ============================================================================

const VERSION_META_KEYS = new Set([
	"id",
	"versionId",
	"versionNumber",
	"versionOperation",
	"versionStage",
	"versionFromStage",
	"versionUserId",
	"versionCreatedAt",
]);

function formatRelativeTime(date: Date, locale: string): string {
	const now = new Date();
	const diff = now.getTime() - date.getTime();
	const absSeconds = Math.max(0, Math.floor(Math.abs(diff) / 1000));
	const minutes = Math.floor(absSeconds / 60);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);

	const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

	if (days > 0) return formatter.format(-days, "day");
	if (hours > 0) return formatter.format(-hours, "hour");
	if (minutes > 0) return formatter.format(-minutes, "minute");
	return formatter.format(0, "second");
}

function getActionConfig(action: string) {
	switch (action) {
		case "create":
			return {
				badge:
					"border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
				color: "bg-emerald-500",
				icon: "ph:plus",
			};
		case "update":
			return {
				badge:
					"border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
				color: "bg-blue-500",
				icon: "ph:pencil-simple",
			};
		case "delete":
			return {
				badge: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
				color: "bg-red-500",
				icon: "ph:trash",
			};
		case "transition":
			return {
				badge:
					"border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
				color: "bg-amber-500",
				icon: "ph:arrows-left-right",
			};
		default:
			return {
				badge: "border-border bg-muted text-muted-foreground",
				color: "bg-gray-500",
				icon: "ph:clock-counter-clockwise",
			};
	}
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeForCompare(value: unknown): unknown {
	if (value instanceof Date) return value.toISOString();
	if (Array.isArray(value)) return value.map(normalizeForCompare);

	if (isObjectRecord(value)) {
		const sorted: Record<string, unknown> = {};
		for (const key of Object.keys(value).sort()) {
			sorted[key] = normalizeForCompare(value[key]);
		}
		return sorted;
	}

	return value;
}

function stringifyComparable(value: unknown): string {
	try {
		return JSON.stringify(normalizeForCompare(value));
	} catch {
		return String(value);
	}
}

function valuesEqual(a: unknown, b: unknown): boolean {
	return stringifyComparable(a) === stringifyComparable(b);
}

function isEmptyValue(value: unknown): boolean {
	if (value === null || value === undefined || value === "") return true;
	if (Array.isArray(value)) return value.length === 0;
	if (isObjectRecord(value)) return Object.keys(value).length === 0;
	return false;
}

function toPrettyJson(value: unknown): string {
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

function summarizeObject(value: Record<string, unknown>): string | null {
	for (const key of [
		"_title",
		"title",
		"name",
		"label",
		"email",
		"filename",
		"id",
	]) {
		const candidate = value[key];
		if (
			typeof candidate === "string" ||
			typeof candidate === "number" ||
			typeof candidate === "boolean"
		) {
			return String(candidate);
		}
	}
	return null;
}

function extractRichText(value: unknown): string | null {
	const parts: string[] = [];

	function visit(node: unknown) {
		if (parts.join(" ").length > 180) return;

		if (Array.isArray(node)) {
			for (const child of node) visit(child);
			return;
		}

		if (!isObjectRecord(node)) return;

		const text = node.text;
		if (typeof text === "string" && text.trim()) {
			parts.push(text.trim());
		}

		if ("content" in node) visit(node.content);
	}

	visit(value);
	const summary = parts.join(" ").replace(/\s+/g, " ").trim();
	return summary ? truncate(summary, 180) : null;
}

function summarizeObjectArray(value: unknown[]): string | null {
	const labels = value
		.map((item) => (isObjectRecord(item) ? summarizeObject(item) : null))
		.filter((item): item is string => !!item);

	if (labels.length === 0) return null;
	return labels.length === value.length
		? truncate(labels.join(", "), 180)
		: null;
}

function summarizeBlocks(value: unknown[]): string | null {
	const blockNames = value
		.map((item) => {
			if (!isObjectRecord(item)) return null;
			const type =
				item.blockType ?? item.block ?? item.type ?? item._type ?? item.name;
			return typeof type === "string" ? formatLabel(type) : null;
		})
		.filter((item): item is string => !!item);

	if (blockNames.length === 0) return null;

	const unique = [...new Set(blockNames)];
	return truncate(unique.join(", "), 180);
}

function truncate(value: string, max = 160): string {
	return value.length > max ? `${value.slice(0, max)}...` : value;
}

function resolveSelectValue({
	field,
	value,
	resolveText,
}: {
	field?: HistoryFieldSchema;
	value: unknown;
	resolveText: ReturnType<typeof useResolveText>;
}): string | null {
	const options = field?.metadata?.options;
	if (!Array.isArray(options)) return null;

	const values = Array.isArray(value) ? value : [value];
	const labels = values.map((item) => {
		const option = options.find((candidate) =>
			valuesEqual(candidate.value, item),
		);
		return option
			? resolveText(option.label, String(option.value))
			: String(item);
	});

	return labels.join(", ");
}

function formatFieldValue({
	field,
	value,
	t,
	resolveText,
}: {
	field?: HistoryFieldSchema;
	value: unknown;
	t: ReturnType<typeof useTranslation>["t"];
	resolveText: ReturnType<typeof useResolveText>;
}): { summary: string; detail?: string } {
	if (isEmptyValue(value)) return { summary: "-" };

	const type = field?.metadata?.type;
	if (type === "select") {
		const selectLabel = resolveSelectValue({ field, value, resolveText });
		if (selectLabel) return { summary: selectLabel };
	}

	if (value instanceof Date) return { summary: value.toLocaleString() };

	if (typeof value === "boolean") {
		return { summary: value ? t("common.yes") : t("common.no") };
	}

	if (typeof value === "number") return { summary: String(value) };

	if (typeof value === "string") {
		if (type === "date" || type === "datetime" || type === "time") {
			const date = new Date(value);
			if (!Number.isNaN(date.getTime()))
				return { summary: date.toLocaleString() };
		}
		return value.length > 160
			? { summary: truncate(value), detail: value }
			: { summary: value };
	}

	if (Array.isArray(value)) {
		if (value.length === 0) return { summary: "-" };

		if (value.every((item) => !isObjectRecord(item) && !Array.isArray(item))) {
			const summary = value.map((item) => String(item)).join(", ");
			return summary.length > 160
				? { summary: truncate(summary), detail: toPrettyJson(value) }
				: { summary };
		}

		const objectSummary = summarizeObjectArray(value);
		if (objectSummary)
			return { summary: objectSummary, detail: toPrettyJson(value) };

		const blockSummary = type === "blocks" ? summarizeBlocks(value) : null;
		const summary =
			type === "blocks" && blockSummary
				? `${t("history.blocksCount", { count: value.length })}: ${blockSummary}`
				: type === "blocks"
					? t("history.blocksCount", { count: value.length })
					: t("history.itemsCount", { count: value.length });
		return { summary, detail: toPrettyJson(value) };
	}

	if (typeof value === "object") {
		if (type === "richText") {
			const richTextSummary = extractRichText(value);
			if (richTextSummary) {
				return { summary: richTextSummary, detail: toPrettyJson(value) };
			}
		}

		const record = value as Record<string, unknown>;
		const objectSummary = summarizeObject(record);
		if (objectSummary) {
			return { summary: objectSummary, detail: toPrettyJson(value) };
		}
		return {
			summary: t("history.objectWithKeys", {
				count: Object.keys(record).length,
			}),
			detail: toPrettyJson(value),
		};
	}

	return { summary: String(value) };
}

// ============================================================================
// Version Diff
// ============================================================================

function ValuePreview({
	field,
	value,
	t,
	resolveText,
}: {
	field?: HistoryFieldSchema;
	value: unknown;
	t: ReturnType<typeof useTranslation>["t"];
	resolveText: ReturnType<typeof useResolveText>;
}) {
	const formatted = formatFieldValue({ field, value, t, resolveText });

	return (
		<div className="min-w-0 space-y-2">
			<div className="text-foreground text-xs leading-relaxed text-pretty break-words">
				{formatted.summary}
			</div>
			{formatted.detail && (
				<ScrollFade orientation="both" fadeSize={16}>
					<pre
						data-scroll-fade-target
						className="control-surface text-muted-foreground h-auto max-h-36 overflow-auto p-2 font-mono text-[0.6875rem] leading-relaxed whitespace-pre-wrap"
					>
						{formatted.detail}
					</pre>
				</ScrollFade>
			)}
		</div>
	);
}

function getDiffKind(from: unknown, to: unknown): FieldDiff["kind"] {
	if (isEmptyValue(from) && !isEmptyValue(to)) return "added";
	if (!isEmptyValue(from) && isEmptyValue(to)) return "removed";
	return "changed";
}

function getDiffKindConfig(kind: FieldDiff["kind"]) {
	switch (kind) {
		case "added":
			return {
				icon: "ph:plus",
				labelKey: "history.changeAdded",
				className:
					"border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
			};
		case "removed":
			return {
				icon: "ph:minus",
				labelKey: "history.changeRemoved",
				className:
					"border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
			};
		default:
			return {
				icon: "ph:arrows-left-right",
				labelKey: "history.changeChanged",
				className:
					"border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
			};
	}
}

function VersionDiffPanel({
	previousVersion,
	changes,
	fields,
}: {
	previousVersion?: VersionItem;
	changes: FieldDiff[];
	fields?: Record<string, HistoryFieldSchema>;
}) {
	const { t } = useTranslation();
	const resolveText = useResolveText();
	const previousNumber = previousVersion?.versionNumber;

	if (changes.length === 0) {
		return (
			<EmptyState
				title={t("history.noFieldChanges")}
				iconName="ph:git-diff"
				height="h-32"
				className="panel-surface"
			/>
		);
	}

	return (
		<div className="space-y-3">
			<div className="text-muted-foreground flex items-center gap-2 text-xs text-pretty">
				<Icon icon="ph:git-diff" className="size-3.5" />
				<span>
					{previousNumber
						? t("history.diffAgainstVersion", { number: previousNumber })
						: t("history.initialSnapshot")}
				</span>
			</div>

			<div className="space-y-2">
				{changes.map((change) => {
					const field = fields?.[change.name];
					const kind = getDiffKindConfig(change.kind);

					return (
						<div
							key={change.name}
							className="item-surface border-border-subtle bg-surface-low px-3 py-3"
						>
							<div className="flex items-start justify-between gap-3">
								<div className="min-w-0">
									<div className="text-foreground truncate text-sm font-medium text-balance">
										{change.label}
									</div>
									<div className="text-muted-foreground font-mono text-[0.6875rem]">
										{change.name}
									</div>
								</div>
								<div className="flex shrink-0 flex-wrap justify-end gap-1.5">
									<Badge variant="outline" className={cn(kind.className)}>
										<Icon icon={kind.icon} className="size-2.5" />
										{t(kind.labelKey)}
									</Badge>
									<Badge variant="outline">{change.type}</Badge>
								</div>
							</div>

							<Separator className="my-3" />

							<div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
								<div className="min-w-0">
									<div className="text-muted-foreground mb-2 flex items-center gap-1.5 text-[0.6875rem] font-medium uppercase">
										<Icon icon="ph:minus" className="size-3" />
										{t("history.before")}
									</div>
									<ValuePreview
										field={field}
										value={change.from}
										t={t}
										resolveText={resolveText}
									/>
								</div>

								<Separator
									orientation="vertical"
									className="hidden sm:block"
									aria-hidden
								/>
								<Separator className="sm:hidden" aria-hidden />

								<div className="min-w-0">
									<div className="text-muted-foreground mb-2 flex items-center gap-1.5 text-[0.6875rem] font-medium uppercase">
										<Icon icon="ph:plus" className="size-3" />
										{t("history.after")}
									</div>
									<ValuePreview
										field={field}
										value={change.to}
										t={t}
										resolveText={resolveText}
									/>
								</div>
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}

// ============================================================================
// Activity Timeline
// ============================================================================

function HistoryListSkeleton({ rows = 4 }: { rows?: number }) {
	return (
		<div className="space-y-4 py-2" aria-busy="true">
			{Array.from({ length: rows }, (_, index) => (
				<div key={index} className="flex gap-3">
					<Skeleton className="mt-1 size-7 shrink-0 rounded-full" />
					<div className="min-w-0 flex-1 space-y-2">
						<Skeleton variant="text" className="h-4 w-28" />
						<Skeleton variant="text" className="h-3 w-40" />
					</div>
				</div>
			))}
		</div>
	);
}

function ActivityTimeline({
	entries,
	isLoading,
}: {
	entries: AuditEntry[];
	isLoading?: boolean;
}) {
	const { locale, t } = useTranslation();

	if (isLoading) {
		return <HistoryListSkeleton />;
	}

	if (entries.length === 0) {
		return (
			<EmptyState
				title={t("history.empty")}
				iconName="ph:clock-counter-clockwise"
				height="h-48"
			/>
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
								className={`mt-1.5 size-2.5 shrink-0 rounded-full ${config.color}`}
							/>
							{!isLast && <div className="bg-border min-h-4 w-px flex-1" />}
						</div>

						{/* Content */}
						<div className="min-w-0 flex-1 pb-4">
							<div className="flex items-start justify-between gap-2">
								<p className="text-sm leading-snug">{entry.title}</p>
								<span className="text-muted-foreground shrink-0 text-xs whitespace-nowrap">
									{formatRelativeTime(date, locale)}
								</span>
							</div>
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
	fields,
	isLoading,
	isReverting,
	onRevert,
}: {
	versions: VersionItem[];
	fields?: Record<string, HistoryFieldSchema>;
	isLoading?: boolean;
	isReverting?: boolean;
	onRevert?: (version: VersionItem) => Promise<void>;
}) {
	const { formatDate, locale, t } = useTranslation();
	const resolveText = useResolveText();

	const sortedAscVersions = React.useMemo(() => {
		return [...versions].sort((a, b) => {
			const aNum = a.versionNumber ?? 0;
			const bNum = b.versionNumber ?? 0;
			return aNum - bNum;
		});
	}, [versions]);

	const sortedVersions = React.useMemo(
		() =>
			[...sortedAscVersions].sort((a, b) => {
				const aNum = a.versionNumber ?? 0;
				const bNum = b.versionNumber ?? 0;
				return bNum - aNum;
			}),
		[sortedAscVersions],
	);

	const fieldsForDiff = React.useMemo(() => {
		if (fields && Object.keys(fields).length > 0) return fields;

		const inferred: Record<string, HistoryFieldSchema> = {};
		for (const version of versions) {
			for (const key of Object.keys(version)) {
				if (VERSION_META_KEYS.has(key)) continue;
				inferred[key] = {
					name: key,
					metadata: { type: "unknown", label: formatLabel(key) },
				};
			}
		}
		return inferred;
	}, [fields, versions]);

	const versionDetails = React.useMemo(() => {
		const byKey = new Map<
			string,
			{
				key: string;
				previousVersion?: VersionItem;
				changes: FieldDiff[];
			}
		>();

		for (let index = 0; index < sortedAscVersions.length; index += 1) {
			const version = sortedAscVersions[index]!;
			const previousVersion = sortedAscVersions[index - 1];
			const key = getVersionKey(version, index);
			byKey.set(key, {
				key,
				previousVersion,
				changes: buildVersionDiff({
					version,
					previousVersion,
					fields: fieldsForDiff,
					resolveText,
				}),
			});
		}

		return byKey;
	}, [fieldsForDiff, resolveText, sortedAscVersions]);

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

	const formatDateTime = (value?: string | Date) => {
		if (!value) return "-";
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return "-";
		return formatDate(date, {
			dateStyle: "medium",
			timeStyle: "short",
		});
	};

	if (isLoading) {
		return <HistoryListSkeleton />;
	}

	if (sortedVersions.length === 0) {
		return (
			<EmptyState
				title={t("version.empty")}
				iconName="ph:clock-counter-clockwise"
				height="h-48"
			/>
		);
	}

	return (
		<Accordion defaultValue={[]} className="panel-surface bg-card">
			{sortedVersions.map((version, index) => {
				const key = getVersionKey(version, index);
				const details = versionDetails.get(key);
				const changes = details?.changes ?? [];
				const visibleChangedFields = changes.slice(0, 3);
				const remainingChangedFields = Math.max(
					0,
					changes.length - visibleChangedFields.length,
				);
				const changedPreview = visibleChangedFields
					.map((change) => change.label)
					.join(", ");
				const date = version.versionCreatedAt
					? new Date(version.versionCreatedAt)
					: null;
				const canRevert =
					typeof version.versionId === "string" ||
					typeof version.versionNumber === "number";
				const action = getActionConfig(version.versionOperation ?? "");

				return (
					<AccordionItem key={key} value={key} className="px-0">
						<AccordionTrigger className="min-h-20 items-start px-3 py-3 hover:no-underline">
							<div className="flex min-w-0 flex-1 flex-col gap-2">
								<div className="flex flex-wrap items-center gap-2">
									<Badge variant="secondary" className="tabular-nums">
										{t("version.label", {
											number: version.versionNumber ?? "-",
										})}
									</Badge>
									<Badge variant="outline" className={cn(action.badge)}>
										<Icon icon={action.icon} className="size-2.5" />
										{operationLabel(version.versionOperation)}
									</Badge>
									{version.versionStage && (
										<Badge variant="outline">
											{t("history.stage")}: {version.versionStage}
										</Badge>
									)}
									<Badge variant="outline" className="tabular-nums">
										{t("history.changedFields", {
											count: changes.length,
										})}
									</Badge>
								</div>

								<div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
									<span className="tabular-nums">
										{date ? formatDateTime(version.versionCreatedAt) : "-"}
									</span>
									{date && (
										<span className="tabular-nums">
											{formatRelativeTime(date, locale)}
										</span>
									)}
									<span>
										{t("version.user")}:{" "}
										{version.versionUserId || t("history.systemUser")}
									</span>
								</div>

								<p className="text-muted-foreground truncate text-xs text-pretty">
									{changedPreview || t("history.noFieldChanges")}
									{remainingChangedFields > 0 &&
										` + ${t("history.moreFields", {
											count: remainingChangedFields,
										})}`}
								</p>
							</div>
						</AccordionTrigger>
						<AccordionContent className="px-3 pt-0 pb-3">
							<Separator className="mb-3" />
							<div className="space-y-3">
								<VersionDiffPanel
									previousVersion={details?.previousVersion}
									changes={changes}
									fields={fieldsForDiff}
								/>
							</div>

							{onRevert && (
								<div className="mt-3 flex justify-end">
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
								</div>
							)}
						</AccordionContent>
					</AccordionItem>
				);
			})}
		</Accordion>
	);
}

function getVersionKey(version: VersionItem, index: number): string {
	if (version.versionId) return version.versionId;
	if (typeof version.versionNumber === "number")
		return `version-${version.versionNumber}`;
	return `version-${version.versionCreatedAt ?? index}`;
}

function shouldIncludeField(field?: HistoryFieldSchema): boolean {
	if (field?.metadata?.writeOnly) return false;
	return field?.access?.read?.allowed !== false;
}

function buildVersionDiff({
	version,
	previousVersion,
	fields,
	resolveText,
}: {
	version: VersionItem;
	previousVersion?: VersionItem;
	fields: Record<string, HistoryFieldSchema>;
	resolveText: ReturnType<typeof useResolveText>;
}): FieldDiff[] {
	const changes: FieldDiff[] = [];

	for (const [name, field] of Object.entries(fields)) {
		if (!shouldIncludeField(field)) continue;

		const from = previousVersion?.[name];
		const to = version[name];
		if (valuesEqual(from, to)) continue;

		if (!previousVersion && isEmptyValue(to)) continue;

		changes.push({
			name,
			label: resolveText(field.metadata?.label, formatLabel(name)),
			type: field.metadata?.type ?? "unknown",
			kind: getDiffKind(from, to),
			from,
			to,
		});
	}

	return changes;
}

// ============================================================================
// HistorySidebar
// ============================================================================

export function HistorySidebar({
	open,
	onOpenChange,
	auditEntries = [],
	isLoadingAudit = false,
	versions,
	fields,
	isLoadingVersions = false,
	isReverting = false,
	onRevert,
	showVersionsTab = false,
}: HistorySidebarProps): React.ReactElement {
	const { t } = useTranslation();

	return (
		<Sheet open={open} onOpenChange={onOpenChange} modal={false}>
			<SheetContent
				side="right"
				animated={false}
				showOverlay={false}
				className="qa-history-sidebar flex flex-col p-0 sm:max-w-2xl"
			>
				<SheetHeader className="border-b px-6 py-5">
					<SheetTitle>
						{showVersionsTab ? t("version.history") : t("history.title")}
					</SheetTitle>
					<SheetDescription>
						{showVersionsTab
							? t("history.versionDescription")
							: t("history.description")}
					</SheetDescription>
				</SheetHeader>

				{showVersionsTab ? (
					<ScrollFade orientation="vertical" className="min-h-0 flex-1">
						<div
							data-scroll-fade-target
							className="h-full overflow-y-auto px-6 py-4"
						>
							<VersionsList
								versions={versions ?? []}
								fields={fields}
								isLoading={isLoadingVersions}
								isReverting={isReverting}
								onRevert={onRevert}
							/>
						</div>
					</ScrollFade>
				) : (
					<ScrollFade orientation="vertical" className="min-h-0 flex-1">
						<div
							data-scroll-fade-target
							className="h-full overflow-y-auto px-6 py-4"
						>
							<ActivityTimeline
								entries={auditEntries}
								isLoading={isLoadingAudit}
							/>
						</div>
					</ScrollFade>
				)}
			</SheetContent>
		</Sheet>
	);
}
