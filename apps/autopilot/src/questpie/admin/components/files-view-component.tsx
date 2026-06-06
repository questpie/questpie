"use client";

import { Icon } from "@iconify/react";
import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import {
	AdminViewHeader,
	AdminViewLayout,
	Button,
	cn,
	Dropzone,
	sanitizeFilename,
	SearchInput,
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
	toast,
	Tooltip,
	TooltipContent,
	TooltipTrigger,
	selectBasePath,
	selectClient,
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

/**
 * Neutral file icon resolution.
 *
 * Mirrors the canonical `getFileIcon` from
 * `packages/admin/.../cells/shared/asset-thumbnail.tsx` (MIME-based Phosphor set)
 * and extends it with the path/extension cases this Drive view needs (markdown,
 * json, yaml, diff). Every icon is rendered neutral — folders included — per the
 * design system's neutral-first rule. No semantic color (no amber folders).
 */
function getEntryIcon(entry: FileEntry): string {
	if (entry.kind === "folder") return "ph:folder";

	const ct = (entry.contentType ?? "").toLowerCase();
	const ext = entry.name.split(".").pop()?.toLowerCase() ?? "";

	// Path/extension-specific cases (text-document store)
	if (ct.includes("markdown") || ext === "md" || ext === "mdx")
		return "ph:file-md";
	if (ct.includes("json") || ext === "json") return "ph:brackets-curly";
	if (ct.includes("diff") || ext === "diff" || ext === "patch")
		return "ph:git-diff";
	if (
		ct.includes("yaml") ||
		ct.includes("yml") ||
		ext === "yaml" ||
		ext === "yml"
	)
		return "ph:file-code";

	// Canonical MIME-based set (matches asset-thumbnail.getFileIcon)
	if (ct.startsWith("image/")) return "ph:file-image";
	if (ct.startsWith("video/")) return "ph:file-video";
	if (ct.startsWith("audio/")) return "ph:file-audio";
	if (ct === "application/pdf") return "ph:file-pdf";
	if (ct.includes("zip") || ct.includes("compressed") || ct.includes("archive"))
		return "ph:file-zip";
	if (ct.includes("csv") || ct.includes("spreadsheet")) return "ph:file-csv";
	if (
		ct.includes("word") ||
		ct.includes("document") ||
		ct === "application/rtf"
	)
		return "ph:file-doc";
	if (ct.includes("text") || ext === "txt") return "ph:file-text";
	if (
		ct.includes("javascript") ||
		ct.includes("typescript") ||
		ct.includes("xml") ||
		ct.includes("html")
	)
		return "ph:file-code";

	return "ph:file";
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
	const client = useAdminStore(selectClient);
	const queryClient = useQueryClient();
	const resolveText = useResolveText();
	const title = resolveText((config as any)?.label, collection);

	const cfg = (viewConfig ?? {}) as FilesViewConfig;
	const pathField = cfg.pathField ?? "path";
	const nameField = cfg.nameField;
	const contentTypeField = cfg.contentTypeField;
	const kindField = cfg.kindField;

	const [currentPath, setCurrentPath] = React.useState("");
	const [searchTerm, setSearchTerm] = React.useState("");
	const [searchOpen, setSearchOpen] = React.useState(false);

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

	// ── Drag-and-drop upload from the desktop ────────────────────────────────
	// Drop files (or click to browse) → add each one to the Drive at
	// `<currentFolder>/<filename>` so it lands in the folder the user is viewing.
	//
	// IMPORTANT: this writes document rows directly via `.create()` (with the
	// folder `path`) rather than the blob `.upload()` route. The `assets.path`
	// column is NOT NULL, but the framework upload route accepts only the binary
	// `file` (no extra fields), so a blob upload cannot place a file into a folder.
	// Reading the dropped file as text and creating a `body` document is the
	// faithful "add a file to this folder" for this document store and sets the
	// required `path` at create time. Binary blobs (images/pdf) are out of scope
	// here — see the field's edit form / upload-field for blob attachments.
	// Disabled while searching (there is no active folder to drop into).
	const [isUploading, setIsUploading] = React.useState(false);

	const handleUploadDrop = React.useCallback(
		async (files: File[]) => {
			if (files.length === 0) return;
			const collectionApi = (client as any)?.collections?.[collection];
			if (!collectionApi?.create) {
				toast.error("This collection does not support creating files.");
				return;
			}

			const prefix = currentPath ? `${currentPath}/` : "";
			setIsUploading(true);
			let created = 0;
			try {
				for (const file of files) {
					const filename = sanitizeFilename(file.name);
					const text = await file.text();
					// Client `create(data)` takes the record data directly.
					await collectionApi.create({
						[pathField]: `${prefix}${filename}`,
						...(nameField ? { [nameField]: filename } : {}),
						...(contentTypeField
							? { [contentTypeField]: file.type || "text/plain" }
							: {}),
						...(kindField ? { [kindField]: "document" } : {}),
						[cfg.contentField ?? "body"]: text,
					});
					created += 1;
				}

				await queryClient.invalidateQueries({
					queryKey: ["questpie", "collections", collection],
				});
				toast.success(
					created === 1 ? "Added 1 file" : `Added ${created} files`,
				);
			} catch (error) {
				await queryClient.invalidateQueries({
					queryKey: ["questpie", "collections", collection],
				});
				toast.error(
					error instanceof Error ? error.message : "Upload failed",
				);
			} finally {
				setIsUploading(false);
			}
		},
		[
			cfg.contentField,
			client,
			collection,
			contentTypeField,
			currentPath,
			kindField,
			nameField,
			pathField,
			queryClient,
		],
	);

	const handleUploadValidationError = React.useCallback(
		(errors: { message: string }[]) => {
			for (const validationError of errors) {
				toast.error(validationError.message);
			}
		},
		[],
	);

	const uploadHint = currentPath
		? `Adds text files to ${currentPath}/`
		: "Adds text files to the root folder";

	if (isLoading) {
		return (
			<div className="flex h-64 items-center justify-center">
				<Icon
					icon="ph:spinner"
					className="text-foreground-muted h-6 w-6 animate-spin"
				/>
			</div>
		);
	}

	return (
		<AdminViewLayout
			header={
				<AdminViewHeader
					title={title}
					description={`${entries.length} ${entries.length === 1 ? "item" : "items"}`}
					actions={
						<Tooltip>
							<TooltipTrigger
								render={
									<Button
										variant="outline"
										size="icon-sm"
										className="relative"
										onClick={() => setSearchOpen((open) => !open)}
										aria-label="Search files"
									>
										<Icon icon="ph:magnifying-glass" />
										{searchTerm && (
											<span className="bg-foreground absolute top-1 right-1 size-1.5 rounded-full" />
										)}
									</Button>
								}
							/>
							<TooltipContent side="bottom" align="end">
								Search files
							</TooltipContent>
						</Tooltip>
					}
				/>
			}
			contentClassName="overflow-y-auto pb-3"
		>
			<div className="qa-table-view min-w-0 space-y-4">
				{(searchOpen || searchTerm) && (
					<div className="max-w-xl">
						<SearchInput
							value={searchTerm}
							onChange={(e) => setSearchTerm(e.target.value)}
							onClear={() => setSearchTerm("")}
							placeholder="Search files..."
							containerClassName="h-10"
						/>
					</div>
				)}

				{/* Breadcrumb */}
				<div className="text-foreground-muted flex items-center gap-1 text-sm">
					<button
						type="button"
						onClick={() => handleBreadcrumbClick(-1)}
						className="hover:text-foreground hover:bg-surface-mid flex items-center gap-1 rounded-md px-1.5 py-0.5 transition-colors"
					>
						<Icon icon="ph:house" className="size-3.5" />
						<span>Root</span>
					</button>
					{breadcrumbs.map((segment, i) => (
						<React.Fragment key={i}>
							<Icon
								icon="ph:caret-right"
								className="text-foreground-subtle size-3 shrink-0"
							/>
							<button
								type="button"
								onClick={() => handleBreadcrumbClick(i)}
								className={cn(
									"rounded-md px-1.5 py-0.5 transition-colors",
									i === breadcrumbs.length - 1
										? "text-foreground font-medium"
										: "hover:text-foreground hover:bg-surface-mid",
								)}
							>
								{segment}
							</button>
						</React.Fragment>
					))}
				</div>

				{/* Drag-and-drop upload — desktop drop or click to browse. Reuses the
				    canonical Dropzone primitive (neutral drag-over affordance). Hidden
				    while searching because there is no active folder to upload into. */}
				{!searchTerm && (
					<Dropzone
						onDrop={handleUploadDrop}
						multiple
						accept={[
							"text/*",
							".md",
							".mdx",
							".txt",
							".json",
							".yaml",
							".yml",
							".csv",
							".diff",
							".patch",
						]}
						loading={isUploading}
						variant="compact"
						label="Drop files here or click to upload"
						hint={uploadHint}
						onValidationError={handleUploadValidationError}
					/>
				)}

				{/* Files table — same primitives + neutral row/header treatment as the
				    built-in collection table view. */}
				{entries.length === 0 ? (
					<div className="flex h-48 flex-col items-center justify-center gap-2">
						<Icon
							icon="ph:folder-open"
							className="text-foreground-subtle size-10"
						/>
						<p className="text-foreground-muted text-sm">
							{searchTerm
								? "No files match your search"
								: "This folder is empty"}
						</p>
					</div>
				) : (
					<div className="qa-table-view__table-wrapper min-w-0">
						<Table>
							<TableHeader>
								<TableRow className="hover:bg-transparent">
									<TableHead>Name</TableHead>
									<TableHead className="w-40">Kind</TableHead>
									<TableHead className="w-24 text-right">Items</TableHead>
									<TableHead className="w-36 text-right">Modified</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{entries.map((entry) => (
									<TableRow
										key={entry.path}
										onClick={() =>
											entry.kind === "folder"
												? handleFolderClick(entry.path)
												: handleFileClick(entry)
										}
										className="cursor-pointer"
									>
										<TableCell className="text-foreground font-medium">
											<div className="flex min-w-0 items-center gap-2.5">
												<Icon
													icon={getEntryIcon(entry)}
													className="text-foreground-muted size-[18px] shrink-0"
												/>
												<span className="truncate">
													{entry.name}
													{entry.kind === "folder" && "/"}
												</span>
											</div>
										</TableCell>
										<TableCell className="text-foreground-muted">
											{entry.kind === "folder"
												? "Folder"
												: (entry.fileKind ?? "File")}
										</TableCell>
										<TableCell className="text-foreground-muted text-right">
											{entry.kind === "folder" && entry.childCount != null
												? entry.childCount
												: "—"}
										</TableCell>
										<TableCell className="text-foreground-muted text-right">
											{formatDate(entry.updatedAt) || "—"}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>
				)}
			</div>
		</AdminViewLayout>
	);
}
