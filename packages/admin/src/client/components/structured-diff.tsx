import { Icon } from "@iconify/react";

import { useAdminConfig } from "../hooks/use-admin-config";
import { useResolveText, useTranslation } from "../i18n/hooks";
import type { I18nText } from "../i18n/types";
import { cn, formatLabel } from "../lib/utils";
import type { AdminConfigResponse } from "../types/admin-config";
import { Badge } from "./ui/badge";

// ============================================================================
// Types
// ============================================================================

type BlockNode = { id: string; type: string; children?: BlockNode[] };

type BlockDocument = {
	_tree: BlockNode[];
	_values: Record<string, Record<string, unknown>>;
};

type PropertyChange = {
	key: string;
	label: string;
	kind: "added" | "removed" | "changed";
	from?: unknown;
	to?: unknown;
};

type ItemChange = {
	id: string;
	label: string;
	kind: "added" | "removed" | "changed";
	properties: PropertyChange[];
};

type NestedFieldMetadata = {
	type?: string;
	label?: I18nText;
	nestedFields?: StructuredDiffNestedFields;
};

type NestedFieldInfo = NestedFieldMetadata & {
	name?: string;
	metadata?: NestedFieldMetadata;
};

export type StructuredDiffNestedFields = Record<string, NestedFieldInfo>;

export type StructuredDiffProps = {
	type: string;
	from: unknown;
	to: unknown;
	nestedFields?: StructuredDiffNestedFields;
};

// ============================================================================
// Utilities
// ============================================================================

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isBlockDocument(value: unknown): value is BlockDocument {
	return (
		isRecord(value) &&
		Array.isArray(value["_tree"]) &&
		isRecord(value["_values"])
	);
}

function isEmpty(v: unknown): boolean {
	if (v === null || v === undefined || v === "") return true;
	if (Array.isArray(v)) return v.length === 0;
	if (isRecord(v)) return Object.keys(v).length === 0;
	return false;
}

function deepEqual(a: unknown, b: unknown): boolean {
	try {
		return JSON.stringify(a) === JSON.stringify(b);
	} catch {
		return a === b;
	}
}

function flattenTree(nodes: BlockNode[]): Map<string, string> {
	const result = new Map<string, string>();
	function walk(list: BlockNode[]) {
		for (const n of list) {
			result.set(n.id, n.type);
			if (n.children) walk(n.children);
		}
	}
	walk(nodes);
	return result;
}

function formatPrimitive(value: unknown): string {
	if (value === null || value === undefined) return "-";
	if (typeof value === "string")
		return value.length > 120 ? `${value.slice(0, 120)}…` : value;
	if (typeof value === "number" || typeof value === "boolean")
		return String(value);
	if (Array.isArray(value)) return `[${value.length}]`;
	if (isRecord(value)) {
		for (const key of ["_title", "title", "name", "label"]) {
			if (typeof value[key] === "string") return value[key] as string;
		}
		return `{${Object.keys(value).length}}`;
	}
	return String(value);
}

function summarizeItem(item: Record<string, unknown>, index: number): string {
	for (const key of ["_title", "title", "name", "label", "email", "filename"]) {
		const val = item[key];
		if (typeof val === "string" && val.trim()) {
			return val.length > 60 ? `${val.slice(0, 60)}…` : val;
		}
	}
	return `#${index}`;
}

function getChangeKind(
	from: unknown,
	to: unknown,
): "added" | "removed" | "changed" {
	if (isEmpty(from) && !isEmpty(to)) return "added";
	if (!isEmpty(from) && isEmpty(to)) return "removed";
	return "changed";
}

type ResolveTextFn = (text: I18nText | undefined, fallback: string) => string;
type BlockSchemas = NonNullable<AdminConfigResponse["blocks"]>;

function getFieldMetadata(
	field: NestedFieldInfo | undefined,
): NestedFieldMetadata | undefined {
	if (!field) return undefined;
	return field.metadata ?? field;
}

function getFieldLabel(
	field: NestedFieldInfo | undefined,
	fallback: string,
	resolveText: ResolveTextFn,
): string {
	const label = getFieldMetadata(field)?.label;
	return label ? resolveText(label, fallback) : fallback;
}

function getArrayItemFields(
	nestedFields: StructuredDiffNestedFields | undefined,
): StructuredDiffNestedFields | undefined {
	return getFieldMetadata(nestedFields?.item)?.nestedFields ?? nestedFields;
}

// ============================================================================
// Diff Logic
// ============================================================================

function diffProperties(
	from: Record<string, unknown> | undefined,
	to: Record<string, unknown> | undefined,
	fields: StructuredDiffNestedFields | undefined,
	resolveText: ResolveTextFn,
): PropertyChange[] {
	const allKeys = new Set([
		...Object.keys(from ?? {}),
		...Object.keys(to ?? {}),
	]);
	const changes: PropertyChange[] = [];

	for (const key of allKeys) {
		if (key.startsWith("_") || key === "id") continue;
		const fromVal = from?.[key];
		const toVal = to?.[key];
		if (deepEqual(fromVal, toVal)) continue;

		const label = getFieldLabel(fields?.[key], formatLabel(key), resolveText);

		changes.push({
			key,
			label,
			kind: getChangeKind(fromVal, toVal),
			from: fromVal,
			to: toVal,
		});
	}

	return changes;
}

function computeBlockChanges(
	from: unknown,
	to: unknown,
	blockSchemas: BlockSchemas | undefined,
	resolveText: ResolveTextFn,
): ItemChange[] {
	const fromVal = isBlockDocument(from) ? from : null;
	const toVal = isBlockDocument(to) ? to : null;

	const fromTree = flattenTree(fromVal?.["_tree"] ?? []);
	const toTree = flattenTree(toVal?.["_tree"] ?? []);
	const fromValues = fromVal?.["_values"] ?? {};
	const toValues = toVal?.["_values"] ?? {};

	const changes: ItemChange[] = [];
	const seen = new Set<string>();

	for (const [id, type] of toTree) {
		seen.add(id);
		const schema = blockSchemas?.[type];
		const label = schema?.admin?.label
			? resolveText(schema.admin.label, formatLabel(type))
			: formatLabel(type);

		if (!fromTree.has(id)) {
			changes.push({
				id,
				label,
				kind: "added",
				properties: diffProperties(
					undefined,
					toValues[id],
					schema?.fields,
					resolveText,
				),
			});
		} else {
			const props = diffProperties(
				fromValues[id],
				toValues[id],
				schema?.fields,
				resolveText,
			);
			if (props.length > 0) {
				changes.push({ id, label, kind: "changed", properties: props });
			}
		}
	}

	for (const [id, type] of fromTree) {
		if (seen.has(id)) continue;
		const schema = blockSchemas?.[type];
		const label = schema?.admin?.label
			? resolveText(schema.admin.label, formatLabel(type))
			: formatLabel(type);
		changes.push({
			id,
			label,
			kind: "removed",
			properties: diffProperties(
				fromValues[id],
				undefined,
				schema?.fields,
				resolveText,
			),
		});
	}

	return changes;
}

function computeArrayChanges(
	from: unknown,
	to: unknown,
	nestedFields: StructuredDiffNestedFields | undefined,
	resolveText: ResolveTextFn,
): ItemChange[] {
	const fromArr = Array.isArray(from) ? from : [];
	const toArr = Array.isArray(to) ? to : [];
	const hasIds = fromArr.some(itemHasStringId) || toArr.some(itemHasStringId);

	if (hasIds) {
		return diffArrayById(fromArr, toArr, nestedFields, resolveText);
	}
	return diffArrayByIndex(fromArr, toArr, nestedFields, resolveText);
}

function itemHasStringId(item: unknown): boolean {
	return isRecord(item) && typeof item.id === "string";
}

function diffArrayById(
	from: unknown[],
	to: unknown[],
	nestedFields: StructuredDiffNestedFields | undefined,
	resolveText: ResolveTextFn,
): ItemChange[] {
	const fromMap = new Map<string, Record<string, unknown>>();
	for (const item of from) {
		if (isRecord(item) && typeof item.id === "string")
			fromMap.set(item.id, item);
	}

	const changes: ItemChange[] = [];
	const seen = new Set<string>();

	let idx = 0;
	for (const item of to) {
		idx++;
		if (!isRecord(item) || typeof item.id !== "string") continue;
		seen.add(item.id);
		const label = summarizeItem(item, idx);

		if (!fromMap.has(item.id)) {
			changes.push({
				id: item.id,
				label,
				kind: "added",
				properties: diffProperties(undefined, item, nestedFields, resolveText),
			});
		} else {
			const props = diffProperties(
				fromMap.get(item.id)!,
				item,
				nestedFields,
				resolveText,
			);
			if (props.length > 0) {
				changes.push({
					id: item.id,
					label,
					kind: "changed",
					properties: props,
				});
			}
		}
	}

	let fromIdx = 0;
	for (const item of from) {
		fromIdx++;
		if (!isRecord(item) || typeof item.id !== "string") continue;
		if (seen.has(item.id)) continue;
		changes.push({
			id: item.id,
			label: summarizeItem(item, fromIdx),
			kind: "removed",
			properties: diffProperties(item, undefined, nestedFields, resolveText),
		});
	}

	return changes;
}

function diffArrayByIndex(
	from: unknown[],
	to: unknown[],
	nestedFields: StructuredDiffNestedFields | undefined,
	resolveText: ResolveTextFn,
): ItemChange[] {
	const maxLen = Math.max(from.length, to.length);
	const changes: ItemChange[] = [];

	for (let i = 0; i < maxLen; i++) {
		const fromItem = from[i];
		const toItem = to[i];
		if (deepEqual(fromItem, toItem)) continue;

		const fromRec = isRecord(fromItem) ? fromItem : undefined;
		const toRec = isRecord(toItem) ? toItem : undefined;
		const label = `#${i + 1}`;

		if (fromItem === undefined) {
			changes.push({
				id: String(i),
				label,
				kind: "added",
				properties: toRec
					? diffProperties(undefined, toRec, nestedFields, resolveText)
					: [],
			});
		} else if (toItem === undefined) {
			changes.push({
				id: String(i),
				label,
				kind: "removed",
				properties: fromRec
					? diffProperties(fromRec, undefined, nestedFields, resolveText)
					: [],
			});
		} else {
			changes.push({
				id: String(i),
				label,
				kind: "changed",
				properties:
					fromRec && toRec
						? diffProperties(fromRec, toRec, nestedFields, resolveText)
						: [],
			});
		}
	}

	return changes;
}

function computeObjectChanges(
	from: unknown,
	to: unknown,
	nestedFields: StructuredDiffNestedFields | undefined,
	resolveText: ResolveTextFn,
): PropertyChange[] {
	const fromRec = isRecord(from) ? from : {};
	const toRec = isRecord(to) ? to : {};
	return diffProperties(fromRec, toRec, nestedFields, resolveText);
}

// ============================================================================
// Components
// ============================================================================

const CHANGE_STYLES = {
	added: {
		icon: "ph:plus",
		badge:
			"border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
		border: "border-l-emerald-500/50",
		bg: "bg-emerald-500/5",
		text: "text-emerald-600 dark:text-emerald-400",
		labelKey: "history.changeAdded",
	},
	removed: {
		icon: "ph:minus",
		badge: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
		border: "border-l-red-500/50",
		bg: "bg-red-500/5",
		text: "text-red-600 dark:text-red-400",
		labelKey: "history.changeRemoved",
	},
	changed: {
		icon: "ph:pencil-simple",
		badge: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
		border: "border-l-blue-500/50",
		bg: "bg-blue-500/5",
		text: "text-blue-600 dark:text-blue-400",
		labelKey: "history.changeChanged",
	},
} as const;

const ADDED_VALUE_CLASS = "text-emerald-600 dark:text-emerald-400";
const REMOVED_VALUE_CLASS = "text-red-500/80 line-through dark:text-red-400/80";

function PropertyValueDelta({ change }: { change: PropertyChange }) {
	if (change.kind === "added") {
		return (
			<span className={ADDED_VALUE_CLASS}>{formatPrimitive(change.to)}</span>
		);
	}

	if (change.kind === "removed") {
		return (
			<span className={REMOVED_VALUE_CLASS}>
				{formatPrimitive(change.from)}
			</span>
		);
	}

	return (
		<>
			<span className={REMOVED_VALUE_CLASS}>
				{formatPrimitive(change.from)}
			</span>
			<span className="text-muted-foreground mx-1.5">→</span>
			<span className={ADDED_VALUE_CLASS}>{formatPrimitive(change.to)}</span>
		</>
	);
}

function PropertyChangeRow({ change }: { change: PropertyChange }) {
	const style = CHANGE_STYLES[change.kind];

	return (
		<div className="flex items-baseline gap-2 text-xs leading-relaxed">
			<Icon icon={style.icon} className={cn("size-3 shrink-0", style.text)} />
			<span className="text-muted-foreground shrink-0 font-medium">
				{change.label}:
			</span>
			<span className="min-w-0 break-words">
				<PropertyValueDelta change={change} />
			</span>
		</div>
	);
}

function ItemChangeCard({ item }: { item: ItemChange }) {
	const { t } = useTranslation();
	const style = CHANGE_STYLES[item.kind];

	return (
		<div
			className={cn(
				"rounded-sm border-l-2 py-2 pr-2 pl-3",
				style.border,
				style.bg,
			)}
		>
			<div className="flex items-center gap-2">
				<span className="text-foreground text-xs font-medium">
					{item.label}
				</span>
				<Badge variant="outline" className={cn("text-[0.625rem]", style.badge)}>
					<Icon icon={style.icon} className="size-2.5" />
					{t(style.labelKey)}
				</Badge>
			</div>
			{item.properties.length > 0 && (
				<div className="mt-1.5 space-y-1 pl-1">
					{item.properties.map((prop) => (
						<PropertyChangeRow key={prop.key} change={prop} />
					))}
				</div>
			)}
		</div>
	);
}

function NoChangesPlaceholder() {
	const { t } = useTranslation();
	return (
		<div className="text-muted-foreground text-xs">
			{t("history.noFieldChanges")}
		</div>
	);
}

function ItemChangeList({ items }: { items: ItemChange[] }) {
	if (items.length === 0) return <NoChangesPlaceholder />;
	return (
		<div className="space-y-2">
			{items.map((item) => (
				<ItemChangeCard key={item.id} item={item} />
			))}
		</div>
	);
}

export function StructuredFieldDiff({
	type,
	from,
	to,
	nestedFields,
}: StructuredDiffProps) {
	const resolveText = useResolveText();
	const { data: adminConfig } = useAdminConfig();

	if (type === "blocks") {
		const items = computeBlockChanges(
			from,
			to,
			adminConfig?.blocks,
			resolveText,
		);
		return <ItemChangeList items={items} />;
	}

	if (type === "array") {
		const items = computeArrayChanges(
			from,
			to,
			getArrayItemFields(nestedFields),
			resolveText,
		);
		return <ItemChangeList items={items} />;
	}

	if (type === "object") {
		const props = computeObjectChanges(from, to, nestedFields, resolveText);
		if (props.length === 0) return <NoChangesPlaceholder />;
		return (
			<div className="space-y-1.5 py-1">
				{props.map((prop) => (
					<PropertyChangeRow key={prop.key} change={prop} />
				))}
			</div>
		);
	}

	return null;
}

export function shouldUseStructuredDiff(
	type: string,
	from: unknown,
	to: unknown,
): boolean {
	if (type === "blocks") return isBlockDocument(from) || isBlockDocument(to);
	if (type === "object") return isRecord(from) || isRecord(to);
	if (type === "array") {
		const fromArr = Array.isArray(from) ? from : [];
		const toArr = Array.isArray(to) ? to : [];
		return fromArr.some(isRecord) || toArr.some(isRecord);
	}
	return false;
}
