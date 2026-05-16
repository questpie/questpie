import type {
	ListViewOutlineConfig,
	ListViewOutlineLevel,
} from "../../builder/types/collection-types";

export type OutlineRow =
	| {
			kind: "group";
			key: string;
			label: string;
			depth: number;
			count: number;
			expandable?: boolean;
			collapsed?: boolean;
	  }
	| {
			kind: "synthetic";
			key: string;
			label: string;
			depth: number;
			count: number;
			expandable?: boolean;
			collapsed?: boolean;
	  }
	| {
			kind: "record";
			key: string;
			id: string;
			doc: Record<string, unknown>;
			depth: number;
			count?: number;
			expandable?: boolean;
			collapsed?: boolean;
	  };

export interface BuildOutlineRowsOptions {
	docs: Record<string, unknown>[];
	outline?: ListViewOutlineConfig;
	edgesByCollection?: Record<string, Record<string, unknown>[]>;
	/** Keys toggled away from their configured default expansion state. */
	toggledKeys?: Iterable<string>;
	/** @deprecated Use toggledKeys. */
	collapsedKeys?: Iterable<string>;
	labelForValue?: (value: unknown, field?: string) => string;
	maxDepth?: number;
}

type EdgeLevel = Extract<ListViewOutlineLevel, { kind: "edge" }>;
type PathLevel = Extract<ListViewOutlineLevel, { kind: "path" }>;
type FieldLevel = Extract<ListViewOutlineLevel, { kind: "field" }>;
type RelationFieldLevel = Extract<
	ListViewOutlineLevel,
	{ kind: "relation-field" }
>;

const DEFAULT_MAX_DEPTH = 12;
const NO_VALUE = "No value";

function getId(value: unknown): string | null {
	if (typeof value === "string" || typeof value === "number")
		return String(value);
	if (value && typeof value === "object") {
		const id = (value as Record<string, unknown>).id;
		if (typeof id === "string" || typeof id === "number") return String(id);
	}
	return null;
}

function getPathValue(source: unknown, path: string | undefined): unknown {
	if (!path) return source;
	const parts = path.split(".").filter(Boolean);
	let current = source;
	for (const part of parts) {
		if (!current || typeof current !== "object") return undefined;
		current = (current as Record<string, unknown>)[part];
	}
	return current;
}

function defaultLabelForValue(value: unknown): string {
	if (value === null || value === undefined || value === "") return NO_VALUE;
	if (Array.isArray(value)) {
		return value.length
			? value.map((item) => defaultLabelForValue(item)).join(", ")
			: NO_VALUE;
	}
	if (typeof value === "object") {
		const record = value as Record<string, unknown>;
		return String(
			record.title ?? record.name ?? record.label ?? record.id ?? NO_VALUE,
		);
	}
	return String(value);
}

function stableGroupKey(value: unknown): string {
	if (value === null || value === undefined || value === "") return "__empty__";
	if (Array.isArray(value)) return value.map(stableGroupKey).join(",");
	if (typeof value === "object") return getId(value) ?? JSON.stringify(value);
	return String(value);
}

function shouldExpand(
	key: string,
	depth: number,
	outline: ListViewOutlineConfig | undefined,
	toggledKeys: Set<string>,
): boolean {
	const defaultExpanded = outline?.defaultExpanded ?? true;
	const defaultValue =
		defaultExpanded === true
			? true
			: defaultExpanded === false
				? false
				: depth === 0;
	if (toggledKeys.has(key)) return !defaultValue;
	return defaultValue;
}

function compareByOrder(
	a: { key: string; label: string },
	b: { key: string; label: string },
	order?: "asc" | "desc" | string[],
): number {
	if (Array.isArray(order)) {
		const ai = order.indexOf(a.key);
		const bi = order.indexOf(b.key);
		if (ai !== -1 || bi !== -1) {
			if (ai === -1) return 1;
			if (bi === -1) return -1;
			return ai - bi;
		}
	}
	const result = a.label.localeCompare(b.label);
	return order === "desc" ? -result : result;
}

function matchesWhere(
	edge: Record<string, unknown>,
	where?: Record<string, unknown>,
): boolean {
	if (!where) return true;
	return Object.entries(where).every(([key, expected]) => {
		const actual = getPathValue(edge, key);
		if (expected && typeof expected === "object" && !Array.isArray(expected)) {
			if ("in" in expected) {
				const values = (expected as { in?: unknown[] }).in ?? [];
				return values.map(String).includes(String(actual));
			}
		}
		return String(actual) === String(expected);
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function buildFieldRows(
	level: FieldLevel,
	docs: Record<string, unknown>[],
	depth: number,
	levelIndex: number,
	ctx: BuildContext,
	scopeKey: string,
): OutlineRow[] {
	const groups = new Map<
		string,
		{
			key: string;
			label: string;
			value: unknown;
			docs: Record<string, unknown>[];
		}
	>();
	for (const doc of docs) {
		const value = getPathValue(doc, level.field);
		const key = stableGroupKey(value);
		const group = groups.get(key);
		if (group) {
			group.docs.push(doc);
			continue;
		}
		groups.set(key, {
			key,
			label: ctx.labelForValue(value, level.labelField ?? level.field),
			value,
			docs: [doc],
		});
	}

	return Array.from(groups.values())
		.sort((a, b) => compareByOrder(a, b, level.order))
		.flatMap((group) => {
			const rowKey = `${scopeKey}/field:${level.field}:${group.key}`;
			const expanded = shouldExpand(
				rowKey,
				depth,
				ctx.outline,
				ctx.toggledKeys,
			);
			return [
				{
					kind: "group" as const,
					key: rowKey,
					label: group.label,
					depth,
					count: group.docs.length,
					expandable: true,
					collapsed: !expanded,
				},
				...(expanded
					? buildLevelRows(group.docs, depth + 1, levelIndex + 1, ctx, rowKey)
					: []),
			];
		});
}

function buildRelationFieldRows(
	level: RelationFieldLevel,
	docs: Record<string, unknown>[],
	depth: number,
	levelIndex: number,
	ctx: BuildContext,
	scopeKey: string,
): OutlineRow[] {
	const fieldPath = level.field
		? `${level.relation}.${level.field}`
		: level.relation;
	const groups = new Map<
		string,
		{ key: string; label: string; docs: Record<string, unknown>[] }
	>();
	for (const doc of docs) {
		const relationValue = getPathValue(doc, level.relation);
		const value = level.field
			? getPathValue(relationValue, level.field)
			: relationValue;
		const key = stableGroupKey(value);
		const group = groups.get(key);
		if (group) {
			group.docs.push(doc);
			continue;
		}
		groups.set(key, {
			key,
			label: ctx.labelForValue(value, level.labelField ?? fieldPath),
			docs: [doc],
		});
	}

	return Array.from(groups.values())
		.sort((a, b) => compareByOrder(a, b, level.order))
		.flatMap((group) => {
			const rowKey = `${scopeKey}/relation-field:${fieldPath}:${group.key}`;
			const expanded = shouldExpand(
				rowKey,
				depth,
				ctx.outline,
				ctx.toggledKeys,
			);
			return [
				{
					kind: "group" as const,
					key: rowKey,
					label: group.label,
					depth,
					count: group.docs.length,
					expandable: true,
					collapsed: !expanded,
				},
				...(expanded
					? buildLevelRows(group.docs, depth + 1, levelIndex + 1, ctx, rowKey)
					: []),
			];
		});
}

function getRepeatMaxDepth(
	repeat: boolean | { maxDepth?: number } | undefined,
	fallback: number,
): number {
	if (!repeat) return 1;
	if (typeof repeat === "object") return repeat.maxDepth ?? fallback;
	return fallback;
}

function buildEdgeRows(
	level: EdgeLevel,
	docs: Record<string, unknown>[],
	depth: number,
	levelIndex: number,
	ctx: BuildContext,
	scopeKey: string,
): OutlineRow[] {
	const docsById = new Map<string, Record<string, unknown>>();
	for (const doc of docs) {
		const id = getId(doc);
		if (id) docsById.set(id, doc);
	}

	const edgeDocs = (ctx.edgesByCollection[level.collection] ?? []).filter(
		(edge) => matchesWhere(edge, level.where),
	);
	if (ctx.outline?.preserveMatchingBranches !== false) {
		for (let pass = 0; pass < ctx.maxDepth; pass++) {
			let changed = false;
			for (const edge of edgeDocs) {
				const parentValue = getPathValue(edge, level.parentField);
				const childValue = getPathValue(edge, level.childField);
				const parentId = getId(parentValue);
				const childId = getId(childValue);
				if (!parentId || !childId || !docsById.has(childId)) continue;
				if (docsById.has(parentId) || !isRecord(parentValue)) continue;
				docsById.set(parentId, parentValue);
				changed = true;
			}
			if (!changed) break;
		}
	}
	const outlineDocs = Array.from(docsById.values());
	const childrenByParent = new Map<
		string,
		Array<{ childId: string; edge: Record<string, unknown> }>
	>();
	const childIds = new Set<string>();
	const edgeSeen = new Set<string>();

	for (const edge of edgeDocs) {
		const parentId = getId(getPathValue(edge, level.parentField));
		const childId = getId(getPathValue(edge, level.childField));
		if (!parentId || !childId || parentId === childId) continue;
		if (!docsById.has(childId)) continue;
		const dedupeKey = `${parentId}:${childId}:${JSON.stringify(level.where ?? {})}`;
		if (edgeSeen.has(dedupeKey)) continue;
		edgeSeen.add(dedupeKey);
		childIds.add(childId);
		const children = childrenByParent.get(parentId) ?? [];
		children.push({ childId, edge });
		childrenByParent.set(parentId, children);
	}

	const roots = outlineDocs.filter((doc) => {
		const id = getId(doc);
		return !id || !childIds.has(id) || !docsById.has(id);
	});
	const maxRepeatDepth = getRepeatMaxDepth(level.repeat, ctx.maxDepth);
	const rows: OutlineRow[] = [];
	const visited = new Set<string>();

	function pushChildRows(
		parentId: string,
		nextDepth: number,
		branchDepth: number,
		ancestorIds: Set<string>,
	) {
		const children = childrenByParent.get(parentId) ?? [];
		if (children.length === 0) return;
		if (branchDepth >= maxRepeatDepth) return;

		if (level.groupByEdgeField) {
			const groups = new Map<
				string,
				{ label: string; children: typeof children }
			>();
			for (const child of children) {
				const value = getPathValue(child.edge, level.groupByEdgeField);
				const key = stableGroupKey(value);
				const group = groups.get(key);
				if (group) group.children.push(child);
				else {
					groups.set(key, {
						label: ctx.labelForValue(value, level.groupByEdgeField),
						children: [child],
					});
				}
			}
			for (const [key, group] of groups) {
				const rowKey = `${scopeKey}/edge-group:${level.collection}:${parentId}:${key}`;
				const expanded = shouldExpand(
					rowKey,
					nextDepth,
					ctx.outline,
					ctx.toggledKeys,
				);
				rows.push({
					kind: "group",
					key: rowKey,
					label: group.label,
					depth: nextDepth,
					count: group.children.length,
					expandable: true,
					collapsed: !expanded,
				});
				if (!expanded) continue;
				for (const child of group.children) {
					pushEdgeRecord(
						child.childId,
						nextDepth + 1,
						branchDepth + 1,
						ancestorIds,
					);
				}
			}
			return;
		}

		for (const child of children) {
			pushEdgeRecord(child.childId, nextDepth, branchDepth + 1, ancestorIds);
		}
	}

	function pushEdgeRecord(
		id: string,
		rowDepth: number,
		branchDepth: number,
		ancestorIds: Set<string>,
	) {
		const doc = docsById.get(id);
		if (!doc || ancestorIds.has(id)) return;
		const rowKey = `${scopeKey}/record:${id}`;
		const hasChildren = (childrenByParent.get(id) ?? []).some((child) =>
			docsById.has(child.childId),
		);
		const expanded =
			hasChildren &&
			shouldExpand(rowKey, rowDepth, ctx.outline, ctx.toggledKeys);
		rows.push({
			kind: "record",
			key: rowKey,
			id,
			doc,
			depth: rowDepth,
			expandable: hasChildren,
			collapsed: hasChildren ? !expanded : undefined,
		});
		visited.add(id);
		if (hasChildren && expanded) {
			const nextAncestors = new Set(ancestorIds);
			nextAncestors.add(id);
			pushChildRows(id, rowDepth + 1, branchDepth, nextAncestors);
		}
	}

	for (const doc of roots) {
		const id = getId(doc);
		if (!id) {
			rows.push({
				kind: "record",
				key: `${scopeKey}/record:${rows.length}`,
				id: String(rows.length),
				doc,
				depth,
			});
			continue;
		}
		pushEdgeRecord(id, depth, 0, new Set());
	}

	for (const doc of outlineDocs) {
		const id = getId(doc);
		if (id && !visited.has(id)) pushEdgeRecord(id, depth, 0, new Set());
	}

	if (levelIndex + 1 >= ctx.levels.length) return rows;
	return rows.flatMap((row) =>
		row.kind === "record"
			? [
					row,
					...buildLevelRows(
						[row.doc],
						row.depth + 1,
						levelIndex + 1,
						ctx,
						row.key,
					),
				]
			: [row],
	);
}

interface PathNode {
	key: string;
	label: string;
	children: Map<string, PathNode>;
	docs: Record<string, unknown>[];
}

function createPathNode(key: string, label: string): PathNode {
	return { key, label, children: new Map(), docs: [] };
}

function countPathNode(node: PathNode): number {
	let count = node.docs.length;
	for (const child of node.children.values()) count += countPathNode(child);
	return count;
}

function buildPathRows(
	level: PathLevel,
	docs: Record<string, unknown>[],
	depth: number,
	levelIndex: number,
	ctx: BuildContext,
	scopeKey: string,
): OutlineRow[] {
	const root = createPathNode("path:root", "Root");
	const separator = level.separator ?? "/";
	const maxPathDepth = getRepeatMaxDepth(level.repeat, ctx.maxDepth);

	for (const doc of docs) {
		const raw = String(getPathValue(doc, level.field) ?? "").trim();
		const segments = raw
			.split(separator)
			.filter(Boolean)
			.slice(0, maxPathDepth);
		const folderSegments =
			level.syntheticFolders && segments.length > 0
				? segments.slice(0, Math.max(segments.length - 1, 0))
				: segments;
		let node = root;
		let currentPath = "";
		for (const segment of folderSegments) {
			currentPath = currentPath
				? `${currentPath}${separator}${segment}`
				: segment;
			let child = node.children.get(segment);
			if (!child) {
				child = createPathNode(
					`${scopeKey}/path:${level.field}:${currentPath}`,
					segment,
				);
				node.children.set(segment, child);
			}
			node = child;
		}
		node.docs.push(doc);
	}

	function walk(node: PathNode, rowDepth: number): OutlineRow[] {
		const rows: OutlineRow[] = [];
		for (const child of Array.from(node.children.values()).sort((a, b) =>
			a.label.localeCompare(b.label),
		)) {
			const expanded = shouldExpand(
				child.key,
				rowDepth,
				ctx.outline,
				ctx.toggledKeys,
			);
			rows.push({
				kind: "synthetic",
				key: child.key,
				label: child.label,
				depth: rowDepth,
				count: countPathNode(child),
				expandable: true,
				collapsed: !expanded,
			});
			if (expanded) rows.push(...walk(child, rowDepth + 1));
		}

		for (const doc of node.docs) {
			const id = getId(doc) ?? `${node.key}:${rows.length}`;
			rows.push({
				kind: "record",
				key: `${scopeKey}/record:${id}`,
				id,
				doc,
				depth: rowDepth,
			});
			if (levelIndex + 1 < ctx.levels.length) {
				rows.push(
					...buildLevelRows(
						[doc],
						rowDepth + 1,
						levelIndex + 1,
						ctx,
						`${scopeKey}/record:${id}`,
					),
				);
			}
		}

		return rows;
	}

	return walk(root, depth);
}

interface BuildContext {
	levels: ListViewOutlineLevel[];
	outline?: ListViewOutlineConfig;
	edgesByCollection: Record<string, Record<string, unknown>[]>;
	toggledKeys: Set<string>;
	labelForValue: (value: unknown, field?: string) => string;
	maxDepth: number;
}

function buildLevelRows(
	docs: Record<string, unknown>[],
	depth: number,
	levelIndex: number,
	ctx: BuildContext,
	scopeKey = "root",
): OutlineRow[] {
	if (docs.length === 0) return [];
	if (depth > ctx.maxDepth || levelIndex >= ctx.levels.length) {
		return docs.map((doc, index) => {
			const id = getId(doc) ?? `${depth}:${index}`;
			return {
				kind: "record",
				key: `${scopeKey}/record:${id}`,
				id,
				doc,
				depth,
			};
		});
	}

	const level = ctx.levels[levelIndex];
	if (level.kind === "field") {
		return buildFieldRows(level, docs, depth, levelIndex, ctx, scopeKey);
	}
	if (level.kind === "relation-field") {
		return buildRelationFieldRows(
			level,
			docs,
			depth,
			levelIndex,
			ctx,
			scopeKey,
		);
	}
	if (level.kind === "edge") {
		return buildEdgeRows(level, docs, depth, levelIndex, ctx, scopeKey);
	}
	return buildPathRows(level, docs, depth, levelIndex, ctx, scopeKey);
}

export function buildOutlineRows({
	docs,
	outline,
	edgesByCollection = {},
	toggledKeys,
	collapsedKeys,
	labelForValue = defaultLabelForValue,
	maxDepth,
}: BuildOutlineRowsOptions): OutlineRow[] {
	const levels = outline?.levels?.filter(Boolean) ?? [];
	const ctx: BuildContext = {
		levels,
		outline,
		edgesByCollection,
		toggledKeys: new Set(toggledKeys ?? collapsedKeys ?? []),
		labelForValue,
		maxDepth: maxDepth ?? outline?.maxDepth ?? DEFAULT_MAX_DEPTH,
	};

	if (levels.length === 0) {
		return buildLevelRows(docs, 0, 0, { ...ctx, levels: [] });
	}

	return buildLevelRows(docs, 0, 0, ctx);
}
