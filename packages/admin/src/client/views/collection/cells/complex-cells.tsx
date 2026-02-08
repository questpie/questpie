/**
 * Complex Cell Components
 *
 * Cells for displaying complex data structures:
 * - JsonCell - simple JSON display
 * - ObjectCell - nested object with hover preview
 * - ArrayCell - array items with hover preview
 * - BlocksCell - block tree summary with tooltip
 */

import * as React from "react";
import type { BlockSchema } from "#questpie/admin/server";
import type { BlockContent, BlockNode } from "../../../blocks/types";
import { isBlockContent } from "../../../blocks/types";
import type { FieldDefinition } from "../../../builder/field/field";
import { Badge } from "../../../components/ui/badge";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "../../../components/ui/tooltip";
import { useAdminConfig } from "../../../hooks/use-admin-config";
import { useResolveText } from "../../../i18n/hooks";
import { cn } from "../../../lib/utils";
import { selectAdmin, useAdminStore } from "../../../runtime";
import {
	formatFieldLabel,
	formatPrimitiveValue,
	getFieldLabel,
	getItemLabel,
	summarizeValue,
} from "./shared/cell-helpers";

// ============================================================================
// JSON Cell
// ============================================================================

/**
 * JSON cell - compact JSON display
 */
export function JsonCell({ value }: { value: unknown }) {
	if (value === null || value === undefined) {
		return <span className="text-muted-foreground">-</span>;
	}
	const json =
		typeof value === "string" ? value : JSON.stringify(value, null, 0);
	const truncated = json.length > 50 ? `${json.slice(0, 50)}...` : json;
	return (
		<span className="font-mono text-xs text-muted-foreground" title={json}>
			{truncated}
		</span>
	);
}

// ============================================================================
// Object Cell
// ============================================================================

/**
 * Object cell - displays nested object with hover tooltip preview
 */
export function ObjectCell({
	value,
	fieldDef,
}: {
	value: unknown;
	row?: unknown;
	fieldDef?: FieldDefinition;
}) {
	const resolveText = useResolveText();
	if (value === null || value === undefined) {
		return <span className="text-muted-foreground">-</span>;
	}

	if (typeof value !== "object" || Array.isArray(value)) {
		return <span>{String(value)}</span>;
	}

	const obj = value as Record<string, unknown>;
	const entries = Object.entries(obj);

	if (entries.length === 0) {
		return <span className="text-muted-foreground">-</span>;
	}

	// Get nested field definitions for labels
	const nestedFieldsOption = fieldDef?.["~options"]?.fields;
	const nestedFields =
		typeof nestedFieldsOption === "function" ? undefined : nestedFieldsOption;

	// Build inline preview: "Label: value, Label: value +N"
	const previewParts = entries.slice(0, 2).map(([key, val]) => {
		const label = resolveText(getFieldLabel(key, nestedFields?.[key]));
		return `${label}: ${summarizeValue(val)}`;
	});
	const hasMore = entries.length > 2;

	return (
		<Tooltip>
			<TooltipTrigger>
				<span
					className={cn(
						"inline-flex items-center gap-1 text-xs",
						"text-muted-foreground hover:text-foreground",
						"transition-colors cursor-default max-w-[220px]",
					)}
				>
					<span className="truncate">{previewParts.join(", ")}</span>
					{hasMore && (
						<span className="text-muted-foreground/50 shrink-0">
							+{entries.length - 2}
						</span>
					)}
				</span>
			</TooltipTrigger>
			<TooltipContent side="bottom" align="start" className={"w-72 p-0 "}>
				<div className="max-h-[300px] overflow-y-auto p-3  space-y-0.5">
					{entries.slice(0, 12).map(([key, val]) => {
						const nestedDef = nestedFields?.[key];
						const label = resolveText(getFieldLabel(key, nestedDef));

						// Nested objects - show with bullet and sub-items
						if (val && typeof val === "object" && !Array.isArray(val)) {
							const nestedObj = val as Record<string, unknown>;
							const nestedEntries = Object.entries(nestedObj).slice(0, 4);

							return (
								<div key={key} className="py-1">
									<div className="flex items-center gap-1.5 text-xs font-medium">
										<span className="size-1 rounded-full bg-foreground/60" />
										{label}
									</div>
									<div className="ml-2.5 pl-2 border-l border-border/50 mt-0.5 space-y-0.5">
										{nestedEntries.map(([k, v]) => (
											<div
												key={k}
												className="flex justify-between gap-2 text-[11px]"
											>
												<span className="text-muted-foreground">
													{formatFieldLabel(k)}
												</span>
												<span className="truncate max-w-[120px]">
													{formatPrimitiveValue(v)}
												</span>
											</div>
										))}
									</div>
								</div>
							);
						}

						// Arrays - bullet with count
						if (Array.isArray(val)) {
							return (
								<div
									key={key}
									className="flex items-center justify-between gap-2 text-xs py-0.5"
								>
									<span className="flex items-center gap-1.5">
										<span className="size-1 rounded-full bg-foreground/60" />
										<span className="text-muted-foreground">{label}</span>
									</span>
									<Badge variant="secondary" className="h-4 px-1 text-[10px]">
										{val.length}
									</Badge>
								</div>
							);
						}

						// Primitives - bullet with value
						return (
							<div
								key={key}
								className="flex items-center justify-between gap-2 text-xs py-0.5"
							>
								<span className="flex items-center gap-1.5">
									<span className="size-1 rounded-full bg-foreground/60" />
									<span className="text-muted-foreground">{label}</span>
								</span>
								<span className="font-medium truncate max-w-[140px]">
									{formatPrimitiveValue(val)}
								</span>
							</div>
						);
					})}
				</div>
				{entries.length > 12 && (
					<div className="text-[11px] text-muted-foreground text-center py-1.5 border-t border-border/50">
						+{entries.length - 12} more
					</div>
				)}
			</TooltipContent>
		</Tooltip>
	);
}

// ============================================================================
// Array Cell
// ============================================================================

/**
 * Array cell - displays array items with hover tooltip preview
 */
export function ArrayCell({
	value,
	fieldDef,
}: {
	value: unknown;
	row?: unknown;
	fieldDef?: FieldDefinition;
}) {
	const resolveText = useResolveText();
	if (value === null || value === undefined) {
		return <span className="text-muted-foreground">-</span>;
	}

	if (!Array.isArray(value)) {
		return <span>{String(value)}</span>;
	}

	if (value.length === 0) {
		return <span className="text-muted-foreground">-</span>;
	}

	const fieldOptions = fieldDef?.["~options"] ?? {};
	const itemLabelFn = fieldOptions.itemLabel as
		| ((item: unknown) => string)
		| undefined;
	const itemFieldsOption = fieldOptions.item;
	const itemFields =
		typeof itemFieldsOption === "function" ? undefined : itemFieldsOption;

	// Get preview labels for first few items
	const previewLabels = value
		.slice(0, 3)
		.map((item, idx) => getItemLabel(item, idx, itemLabelFn));

	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<span
						className={cn(
							"inline-flex items-center gap-1.5 text-xs",
							"text-muted-foreground hover:text-foreground",
							"transition-colors cursor-default max-w-[180px]",
						)}
					>
						<Badge
							variant="secondary"
							className="h-4 min-w-4 px-1 text-[10px] shrink-0"
						>
							{value.length}
						</Badge>
						<span className="truncate">
							{previewLabels[0]}
							{value.length > 1 && ` +${value.length - 1}`}
						</span>
					</span>
				}
			/>
			<TooltipContent
				side="bottom"
				align="start"
				className="p-0 w-64 max-w-[90vw] bg-popover/95 backdrop-blur-xl border-border"
			>
				<div className="max-h-[280px] overflow-y-auto p-2 space-y-0.5">
					{value.slice(0, 10).map((item, idx) => {
						const label = getItemLabel(item, idx, itemLabelFn);

						if (typeof item === "object" && item !== null) {
							const obj = item as Record<string, unknown>;
							const details = Object.entries(obj)
								.filter(
									([k]) =>
										![
											"id",
											"_id",
											"name",
											"title",
											"label",
											"platform",
											"type",
										].includes(k),
								)
								.slice(0, 3);

							return (
								// biome-ignore lint/suspicious/noArrayIndexKey: stable array from backend
								<div key={idx} className="py-1">
									<div className="flex items-center gap-1.5 text-xs font-medium">
										<span className="size-1 rounded-full bg-foreground/60" />
										{label}
									</div>
									{details.length > 0 && (
										<div className="ml-2.5 pl-2 border-l border-border/50 mt-0.5 space-y-0.5">
											{details.map(([k, v]) => {
												const itemFieldDef = itemFields?.[k];
												return (
													<div
														key={k}
														className="flex justify-between gap-2 text-[11px]"
													>
														<span className="text-muted-foreground">
															{resolveText(getFieldLabel(k, itemFieldDef))}
														</span>
														<span className="truncate max-w-[100px]">
															{formatPrimitiveValue(v)}
														</span>
													</div>
												);
											})}
										</div>
									)}
								</div>
							);
						}

						return (
							<div
								// biome-ignore lint/suspicious/noArrayIndexKey: stable array from backend
								key={idx}
								className="flex items-center gap-1.5 text-xs py-0.5"
							>
								<span className="size-1 rounded-full bg-foreground/60" />
								{formatPrimitiveValue(item)}
							</div>
						);
					})}
				</div>
				{value.length > 10 && (
					<div className="text-[11px] text-muted-foreground text-center py-1.5 border-t border-border/50">
						+{value.length - 10} more
					</div>
				)}
			</TooltipContent>
		</Tooltip>
	);
}

// ============================================================================
// Blocks Cell
// ============================================================================

type BlockTypeStat = {
	type: string;
	label: string;
	count: number;
};

function coerceBlockContent(value: unknown): BlockContent | null {
	if (isBlockContent(value)) return value;
	if (
		value &&
		typeof value === "object" &&
		"$i18n" in value &&
		isBlockContent((value as { $i18n?: unknown }).$i18n)
	) {
		return (value as { $i18n?: BlockContent }).$i18n ?? null;
	}
	return null;
}

function formatBlockType(type: string): string {
	return type
		.replace(/[-_]/g, " ")
		.replace(/([a-z])([A-Z])/g, "$1 $2")
		.replace(/\b\w/g, (char) => char.toUpperCase())
		.trim();
}

function getBlockLabel(
	type: string,
	blockDef: BlockSchema | undefined,
	resolveText: ReturnType<typeof useResolveText>,
): string {
	if (!blockDef) return formatBlockType(type);
	const fallback = blockDef.name || formatBlockType(type);
	return resolveText(blockDef.admin?.label, fallback) || fallback;
}

function collectBlockStats(tree: BlockNode[]): {
	total: number;
	counts: Map<string, number>;
} {
	const counts = new Map<string, number>();
	let total = 0;

	const visit = (nodes: BlockNode[]) => {
		for (const node of nodes) {
			total += 1;
			counts.set(node.type, (counts.get(node.type) ?? 0) + 1);
			if (node.children.length) {
				visit(node.children);
			}
		}
	};

	visit(tree);
	return { total, counts };
}

/**
 * Blocks cell - summarizes block tree content with type counts
 */
export function BlocksCell({ value }: { value: unknown }) {
	const resolveText = useResolveText();
	const { data: adminConfig } = useAdminConfig();

	if (value === null || value === undefined) {
		return <span className="text-muted-foreground">-</span>;
	}

	const content = coerceBlockContent(value);
	if (!content) {
		return <JsonCell value={value} />;
	}

	if (!content._tree.length) {
		return <span className="text-muted-foreground">-</span>;
	}

	const blockDefs = adminConfig?.blocks ?? {};
	const { total, counts } = collectBlockStats(content._tree);
	if (total === 0) {
		return <span className="text-muted-foreground">-</span>;
	}

	const entries: BlockTypeStat[] = Array.from(counts.entries()).map(
		([type, count]) => ({
			type,
			count,
			label: getBlockLabel(type, blockDefs?.[type], resolveText),
		}),
	);

	entries.sort((a, b) => {
		if (b.count !== a.count) return b.count - a.count;
		return a.label.localeCompare(b.label);
	});

	const preview = entries
		.slice(0, 2)
		.map((entry) =>
			entry.count > 1 ? `${entry.label} x${entry.count}` : entry.label,
		);
	const extraTypes = entries.length - preview.length;

	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<span
						className={cn(
							"inline-flex items-center gap-1.5 text-xs",
							"text-muted-foreground hover:text-foreground",
							"transition-colors cursor-default max-w-[220px]",
						)}
					>
						<Badge
							variant="secondary"
							className="h-4 min-w-4 px-1 text-[10px] shrink-0"
						>
							{total}
						</Badge>
						<span className="truncate">
							{preview.join(", ")}
							{extraTypes > 0 && ` +${extraTypes}`}
						</span>
					</span>
				}
			/>
			<TooltipContent
				side="bottom"
				align="start"
				className="p-0 w-64 max-w-[90vw] bg-popover/95 backdrop-blur-xl border-border"
			>
				<div className="flex items-center justify-between px-2 py-1.5 text-[11px] text-muted-foreground border-b border-border/50">
					<span>Blocks</span>
					<Badge variant="secondary" className="h-4 px-1 text-[10px]">
						{total}
					</Badge>
				</div>
				<div className="max-h-[280px] overflow-y-auto p-2 space-y-0.5">
					{entries.slice(0, 10).map((entry) => (
						<div
							key={entry.type}
							className="flex items-center justify-between gap-2 text-xs py-0.5"
						>
							<span className="truncate">{entry.label}</span>
							<Badge variant="secondary" className="h-4 px-1 text-[10px]">
								{entry.count}
							</Badge>
						</div>
					))}
				</div>
				{entries.length > 10 && (
					<div className="text-[11px] text-muted-foreground text-center py-1.5 border-t border-border/50">
						+{entries.length - 10} more
					</div>
				)}
			</TooltipContent>
		</Tooltip>
	);
}
