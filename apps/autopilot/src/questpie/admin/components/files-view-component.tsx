"use client";

import { Icon } from "@iconify/react";
import * as React from "react";

import {
	AdminViewHeader,
	AdminViewLayout,
	SearchInput,
	selectBasePath,
	selectNavigate,
	useAdminStore,
	useCollectionList,
	useResolveText,
	type CollectionListViewProps,
} from "@questpie/admin/client";

interface FilesViewConfig {
	pathField: string;
	nameField?: string;
	contentField?: string;
	contentTypeField?: string;
	kindField?: string;
	defaultLayout?: "grid" | "list";
	showPreview?: boolean;
	searchable?: string[];
	filterable?: string[];
	defaultSort?: { field: string; direction: "asc" | "desc" };
}

interface FileEntry {
	kind: "folder" | "file";
	name: string;
	path: string;
	contentType?: string;
	fileKind?: string;
	id?: string;
	doc?: Record<string, unknown>;
	childCount?: number;
	updatedAt?: string;
}

type Props = CollectionListViewProps;

function getIcon(entry: FileEntry): string {
	if (entry.kind === "folder") return "ph:folder";
	const ct = entry.contentType ?? "";
	const ext = entry.name.split(".").pop()?.toLowerCase() ?? "";
	if (ct.includes("markdown") || ext === "md") return "ph:file-md";
	if (ct.includes("json") || ext === "json") return "ph:brackets-curly";
	if (ct.includes("text") || ext === "txt") return "ph:file-text";
	if (ct.includes("diff") || ext === "diff" || ext === "patch")
		return "ph:git-diff";
	if (
		ct.includes("yaml") ||
		ct.includes("yml") ||
		ext === "yaml" ||
		ext === "yml"
	)
		return "ph:file-code";
	return "ph:file";
}

function getIconColor(entry: FileEntry): string {
	if (entry.kind === "folder") return "text-amber-500";
	return "text-muted-foreground";
}

function deriveEntries(
	docs: Record<string, unknown>[],
	currentPath: string,
	pathField: string,
	nameField?: string,
	contentTypeField?: string,
	kindField?: string,
): FileEntry[] {
	const prefix = currentPath ? `${currentPath}/` : "";
	const folderSet = new Map<string, number>();
	const files: FileEntry[] = [];

	for (const doc of docs) {
		const rawPath = String(doc[pathField] ?? "");
		if (!rawPath) continue;

		if (prefix && !rawPath.startsWith(prefix)) continue;
		const remainder = prefix ? rawPath.slice(prefix.length) : rawPath;
		if (!remainder) continue;

		const slashIndex = remainder.indexOf("/");
		if (slashIndex !== -1) {
			const folderName = remainder.slice(0, slashIndex);
			folderSet.set(folderName, (folderSet.get(folderName) ?? 0) + 1);
		} else {
			const displayName = nameField
				? String(doc[nameField] ?? remainder)
				: remainder;
			files.push({
				kind: "file",
				name: displayName,
				path: rawPath,
				contentType: contentTypeField
					? String(doc[contentTypeField] ?? "")
					: undefined,
				fileKind: kindField ? String(doc[kindField] ?? "") : undefined,
				id: String(doc.id ?? ""),
				doc,
				updatedAt: doc.updatedAt
					? String(doc.updatedAt)
					: doc.createdAt
						? String(doc.createdAt)
						: undefined,
			});
		}
	}

	const folders: FileEntry[] = Array.from(folderSet.entries()).map(
		([name, count]) => ({
			kind: "folder" as const,
			name,
			path: prefix ? `${prefix}${name}` : name,
			childCount: count,
		}),
	);

	folders.sort((a, b) => a.name.localeCompare(b.name));
	files.sort((a, b) => a.name.localeCompare(b.name));

	return [...folders, ...files];
}

function formatDate(dateStr: string | undefined): string {
	if (!dateStr) return "";
	try {
		const d = new Date(dateStr);
		return d.toLocaleDateString(undefined, {
			month: "short",
			day: "numeric",
		});
	} catch {
		return "";
	}
}

export default function FilesViewComponent(props: Props) {
	const { collection, config, viewConfig, navigate } = props;
	const basePath = useAdminStore(selectBasePath);
	const nav = useAdminStore(selectNavigate) ?? navigate;
	const resolveText = useResolveText();
	const title = resolveText((config as any)?.label, collection);

	const cfg = (viewConfig ?? {}) as FilesViewConfig;
	const pathField = cfg.pathField ?? "path";
	const nameField = cfg.nameField;
	const contentTypeField = cfg.contentTypeField;
	const kindField = cfg.kindField;

	const [currentPath, setCurrentPath] = React.useState("");
	const [searchTerm, setSearchTerm] = React.useState("");

	const sortField = cfg.defaultSort?.field ?? pathField;
	const sortDir = cfg.defaultSort?.direction ?? "asc";

	const { data, isLoading } = useCollectionList(collection as any, {
		limit: 500,
		orderBy: { [sortField]: sortDir },
	});

	const docs: Record<string, unknown>[] = React.useMemo(
		() => (data as any)?.docs ?? [],
		[data],
	);

	const filteredDocs = React.useMemo(() => {
		if (!searchTerm.trim()) return docs;
		const q = searchTerm.toLowerCase();
		return docs.filter((doc) => {
			const path = String(doc[pathField] ?? "").toLowerCase();
			const name = nameField ? String(doc[nameField] ?? "").toLowerCase() : "";
			return path.includes(q) || name.includes(q);
		});
	}, [docs, searchTerm, pathField, nameField]);

	const entries = React.useMemo(
		() =>
			deriveEntries(
				filteredDocs,
				searchTerm.trim() ? "" : currentPath,
				pathField,
				nameField,
				contentTypeField,
				kindField,
			),
		[
			filteredDocs,
			currentPath,
			searchTerm,
			pathField,
			nameField,
			contentTypeField,
			kindField,
		],
	);

	const breadcrumbs = React.useMemo(() => {
		if (!currentPath) return [];
		return currentPath.split("/");
	}, [currentPath]);

	const handleFolderClick = React.useCallback((folderPath: string) => {
		setCurrentPath(folderPath);
		setSearchTerm("");
	}, []);

	const handleFileClick = React.useCallback(
		(entry: FileEntry) => {
			if (!entry.id) return;
			const target = `${basePath}/collections/${collection}/${entry.id}`;
			if (nav) {
				nav(target);
			}
		},
		[basePath, collection, nav],
	);

	const handleBreadcrumbClick = React.useCallback(
		(index: number) => {
			if (index < 0) {
				setCurrentPath("");
			} else {
				setCurrentPath(breadcrumbs.slice(0, index + 1).join("/"));
			}
		},
		[breadcrumbs],
	);

	if (isLoading) {
		return (
			<div className="flex h-64 items-center justify-center">
				<Icon
					icon="ph:spinner"
					className="text-muted-foreground h-6 w-6 animate-spin"
				/>
			</div>
		);
	}

	return (
		<AdminViewLayout
			header={
				<AdminViewHeader
					title={title}
					actions={
						<>
							<div className="w-56 max-w-[60vw]">
								<SearchInput
									value={searchTerm}
									onChange={(e) => setSearchTerm(e.target.value)}
									onClear={() => setSearchTerm("")}
									placeholder="Search files..."
								/>
							</div>
							<span className="text-muted-foreground shrink-0 text-xs tabular-nums">
								{entries.length} items
							</span>
						</>
					}
				/>
			}
		>
			<div className="flex h-full min-h-0 flex-col">
				{/* Breadcrumb */}
			<div className="flex items-center gap-1 border-b px-4 py-2 text-sm">
				<button
					type="button"
					onClick={() => handleBreadcrumbClick(-1)}
					className="text-muted-foreground hover:text-foreground hover:bg-muted flex items-center gap-1 rounded px-1.5 py-0.5"
				>
					<Icon icon="ph:house" className="h-3.5 w-3.5" />
					<span>Root</span>
				</button>
				{breadcrumbs.map((segment, i) => (
					<React.Fragment key={i}>
						<Icon
							icon="ph:caret-right"
							className="text-muted-foreground/60 h-3 w-3 shrink-0"
						/>
						<button
							type="button"
							onClick={() => handleBreadcrumbClick(i)}
							className={`rounded px-1.5 py-0.5 ${
								i === breadcrumbs.length - 1
									? "text-foreground font-medium"
									: "text-muted-foreground hover:text-foreground hover:bg-muted"
							}`}
						>
							{segment}
						</button>
					</React.Fragment>
				))}
			</div>

			{/* File list */}
			<div className="flex-1 overflow-auto">
				{entries.length === 0 ? (
					<div className="flex h-48 flex-col items-center justify-center gap-2">
						<Icon
							icon="ph:folder-open"
							className="text-muted-foreground/50 h-10 w-10"
						/>
						<p className="text-muted-foreground text-sm">
							{searchTerm
								? "No files match your search"
								: "This folder is empty"}
						</p>
					</div>
				) : (
					<div className="divide-y">
						{entries.map((entry) => (
							<button
								key={entry.path}
								type="button"
								onClick={() =>
									entry.kind === "folder"
										? handleFolderClick(entry.path)
										: handleFileClick(entry)
								}
								className="hover:bg-muted/50 flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors"
							>
								<Icon
									icon={getIcon(entry)}
									className={`h-5 w-5 shrink-0 ${getIconColor(entry)}`}
								/>
								<div className="min-w-0 flex-1">
									<div className="truncate text-sm font-medium">
										{entry.name}
										{entry.kind === "folder" && "/"}
									</div>
								</div>
								{entry.contentType && (
									<span className="text-muted-foreground shrink-0 text-xs">
										{entry.contentType}
									</span>
								)}
								{entry.fileKind && (
									<span className="bg-muted text-muted-foreground shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase">
										{entry.fileKind}
									</span>
								)}
								{entry.kind === "folder" && entry.childCount != null && (
									<span className="text-muted-foreground text-xs tabular-nums">
										{entry.childCount}
									</span>
								)}
								{entry.updatedAt && (
									<span className="text-muted-foreground shrink-0 text-xs">
										{formatDate(entry.updatedAt)}
									</span>
								)}
								<Icon
									icon={
										entry.kind === "folder"
											? "ph:caret-right"
											: "ph:arrow-square-out"
									}
									className="text-muted-foreground/50 h-4 w-4 shrink-0"
								/>
							</button>
						))}
					</div>
				)}
			</div>
		</div>
		</AdminViewLayout>
	);
}
