"use client";

import { Icon } from "@iconify/react";
import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import {
	AdminViewHeader,
	AdminViewLayout,
	Button,
	cn,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
	Dropzone,
	sanitizeFilename,
	SearchInput,
	Sheet,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
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
	useUpload,
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
	const [uploadSheetOpen, setUploadSheetOpen] = React.useState(false);

	const { upload, isUploading, progress } = useUpload();

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

	// Folder the user is viewing — uploads + new documents land under this prefix.
	const currentPrefix = currentPath ? `${currentPath}/` : "";

	// ── New markdown file ────────────────────────────────────────────────────
	// Create an empty markdown document row in the current folder, then open it.
	// This stays a `.create()` (a text `body` row, no blob → keeps the private
	// default) rather than the blob upload route — the latter is for files the
	// user brings in from their desktop. The filename is auto-deduped against the
	// current folder's entries so repeated clicks don't collide on `path`.
	const handleCreateMarkdown = React.useCallback(async () => {
		const collectionApi = (client as any)?.collections?.[collection];
		if (!collectionApi?.create) {
			toast.error("This collection does not support creating files.");
			return;
		}

		const existing = new Set(
			entries.map((entry) => entry.name.toLowerCase()),
		);
		let filename = "Untitled.md";
		let counter = 2;
		while (existing.has(filename.toLowerCase())) {
			filename = `Untitled-${counter}.md`;
			counter += 1;
		}

		try {
			const created = await collectionApi.create({
				[pathField]: `${currentPrefix}${filename}`,
				...(nameField ? { [nameField]: filename } : {}),
				...(contentTypeField ? { [contentTypeField]: "text/markdown" } : {}),
				...(kindField ? { [kindField]: "document" } : {}),
				[cfg.contentField ?? "body"]: "",
			});

			await queryClient.invalidateQueries({
				queryKey: ["questpie", "collections", collection],
			});

			const newId = String((created as any)?.id ?? "");
			if (newId && nav) {
				nav(`${basePath}/collections/${collection}/${newId}`);
			}
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Could not create file",
			);
		}
	}, [
		basePath,
		cfg.contentField,
		client,
		collection,
		contentTypeField,
		currentPrefix,
		entries,
		kindField,
		nameField,
		nav,
		pathField,
		queryClient,
	]);

	// ── Upload files from the desktop ────────────────────────────────────────
	// Reuses the standard assets upload flow (`useUpload().upload`) — the same blob
	// upload + progress + query-invalidation the built-in collection table view
	// uses. Each file gets its own per-file `path` (`<currentFolder>/<filename>`),
	// which the server spreads onto the `assets` row's required `path`. These Drive
	// blobs land with the collection's PRIVATE upload default (a confidential file
	// dragged into a folder is never anonymously servable — the storage route gates
	// it on the per-row `visibility` and the detail view reads the signed `url`).
	// Drives both the table-wide drop target and the "Upload files" sheet. Files are
	// uploaded one at a time (path is per-file, so the batch helper's single
	// shared path can't be used).
	const handleUpload = React.useCallback(
		async (files: File[]) => {
			if (files.length === 0 || isUploading) return;

			let uploaded = 0;
			try {
				for (const file of files) {
					const filename = sanitizeFilename(file.name);
					await upload(
						new File([file], filename, {
							type: file.type,
							lastModified: file.lastModified,
						}),
						{ to: collection, path: `${currentPrefix}${filename}` },
					);
					uploaded += 1;
				}
				toast.success(
					uploaded === 1
						? "Uploaded 1 file"
						: `Uploaded ${uploaded} files`,
				);
			} catch (error) {
				toast.error(
					error instanceof Error ? error.message : "Upload failed",
				);
			}
		},
		[collection, currentPrefix, isUploading, upload],
	);

	const handleUploadValidationError = React.useCallback(
		(errors: { message: string }[]) => {
			for (const validationError of errors) {
				toast.error(validationError.message);
			}
		},
		[],
	);

	// Table-wide drop target — drag files anywhere over the list to upload into the
	// current folder (Drive-style). Replicates the Dropzone primitive's drag-counter
	// pattern (enter/leave nesting) so the neutral overlay only clears on true exit.
	// Disabled while searching (no active folder to drop into).
	const [isDragging, setIsDragging] = React.useState(false);
	const dragCounterRef = React.useRef(0);
	const dropDisabled = Boolean(searchTerm);

	// Create (new markdown / upload sheet) writes into `currentPrefix`, which a
	// search flattens away from — disable it while searching, same as the drop
	// target, so a write can't land in a folder the user isn't currently viewing.
	const createDisabled = Boolean(searchTerm);

	const handleTableDragEnter = React.useCallback(
		(e: React.DragEvent) => {
			if (dropDisabled) return;
			e.preventDefault();
			dragCounterRef.current += 1;
			if (e.dataTransfer.types.includes("Files")) {
				setIsDragging(true);
			}
		},
		[dropDisabled],
	);

	const handleTableDragOver = React.useCallback(
		(e: React.DragEvent) => {
			if (dropDisabled) return;
			e.preventDefault();
		},
		[dropDisabled],
	);

	const handleTableDragLeave = React.useCallback((e: React.DragEvent) => {
		e.preventDefault();
		dragCounterRef.current -= 1;
		if (dragCounterRef.current <= 0) {
			dragCounterRef.current = 0;
			setIsDragging(false);
		}
	}, []);

	const handleTableDrop = React.useCallback(
		(e: React.DragEvent) => {
			if (dropDisabled) return;
			e.preventDefault();
			dragCounterRef.current = 0;
			setIsDragging(false);
			if (e.dataTransfer.files.length > 0) {
				void handleUpload(Array.from(e.dataTransfer.files));
			}
		},
		[dropDisabled, handleUpload],
	);

	const uploadHint = currentPath
		? `Uploads to ${currentPath}/`
		: "Uploads to the root folder";

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
						<div className="flex items-center gap-2">
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
							{/* Create writes into `currentPrefix` (the open folder), but a search
							    flattens the view to the root — so the visible entries and the
							    new-md dedup set would be computed against a different folder than
							    the write target. Disable Create while searching (mirrors the
							    table-wide drop target's `dropDisabled`) so a write can't land in a
							    folder the user isn't looking at. */}
							<DropdownMenu>
								<DropdownMenuTrigger
									disabled={createDisabled}
									render={
										<Button
											variant="default"
											size="sm"
											className="gap-2"
											disabled={createDisabled}
											title={
												createDisabled
													? "Clear the search to create files in a folder"
													: undefined
											}
										>
											<Icon icon="ph:plus" className="size-3.5" />
											Create
											<Icon
												icon="ph:caret-down"
												className="text-primary-foreground/70 size-3"
											/>
										</Button>
									}
								/>
								<DropdownMenuContent align="end" className="min-w-52">
									<DropdownMenuItem
										onClick={() => {
											void handleCreateMarkdown();
										}}
									>
										<Icon icon="ph:file-md" className="size-4" />
										New markdown file
									</DropdownMenuItem>
									<DropdownMenuItem onClick={() => setUploadSheetOpen(true)}>
										<Icon icon="ph:cloud-arrow-up" className="size-4" />
										Upload files
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						</div>
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

				{/* List area is a single table-wide drop target (Drive-style): drag
				    files anywhere over it to upload into the current folder. No
				    standalone dropzone box — explicit picking lives in the header
				    "Create → Upload files" sheet. A neutral overlay appears while a
				    file is dragged over. The drop target wraps both the empty state and
				    the table so dropping into an empty folder works too. */}
				<div
					className="relative min-w-0"
					onDragEnter={handleTableDragEnter}
					onDragOver={handleTableDragOver}
					onDragLeave={handleTableDragLeave}
					onDrop={handleTableDrop}
				>
					{/* Files table — same primitives + neutral row/header treatment as
					    the built-in collection table view. */}
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

					{/* Neutral drag-over overlay — surface-high tint + dashed border,
					    no primary purple (design system: neutral-first). */}
					{isDragging && (
						<div className="border-border-strong bg-surface-high/80 pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-[var(--surface-radius)] border-2 border-dashed backdrop-blur-sm">
							<Icon
								icon="ph:cloud-arrow-up"
								className="text-foreground-muted size-8"
							/>
							<p className="text-foreground text-sm font-medium">
								Drop to upload
							</p>
							<p className="text-foreground-muted text-xs">{uploadHint}</p>
						</div>
					)}
				</div>
			</div>

			{/* Upload files — right side sheet replicating the built-in collection
			    table view's bulk-upload sheet (Sheet + Dropzone + useUpload). Reuses
			    the standard assets upload flow; files land in the current folder. */}
			<Sheet
				open={uploadSheetOpen}
				onOpenChange={setUploadSheetOpen}
				modal={false}
			>
				<SheetContent
					side="right"
					showOverlay={false}
					className="qa-upload-sheet w-full p-0 data-[side=right]:sm:max-w-xl"
				>
					<SheetHeader className="border-b px-6 py-5">
						<SheetTitle>Upload files</SheetTitle>
						<SheetDescription>{uploadHint}</SheetDescription>
					</SheetHeader>

					<div className="flex flex-1 flex-col gap-5 overflow-y-auto px-6 py-5">
						<Dropzone
							onDrop={handleUpload}
							multiple
							loading={isUploading}
							progress={isUploading ? progress : undefined}
							accept={[
								"image/*",
								"application/pdf",
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
							label="Drop files here or click to browse"
							hint={uploadHint}
							onValidationError={handleUploadValidationError}
						/>
					</div>

					<SheetFooter className="border-t px-6 py-4">
						<Button
							variant="outline"
							onClick={() => setUploadSheetOpen(false)}
							disabled={isUploading}
						>
							Close
						</Button>
					</SheetFooter>
				</SheetContent>
			</Sheet>
		</AdminViewLayout>
	);
}
