/**
 * UploadField Component
 *
 * Unified file upload field supporting both single and multiple uploads.
 * - Single mode (default): Value is asset ID (string | null)
 * - Multiple mode: Value is array of asset IDs (string[])
 *
 * @example Single upload
 * ```tsx
 * <UploadField
 *   name="featuredImage"
 *   label="Featured Image"
 *   accept={["image/*"]}
 *   maxSize={5_000_000}
 * />
 * ```
 *
 * @example Multiple uploads
 * ```tsx
 * <UploadField
 *   name="gallery"
 *   label="Gallery"
 *   multiple
 *   accept={["image/*"]}
 *   maxItems={10}
 *   orderable
 * />
 * ```
 */

import {
	closestCenter,
	DndContext,
	type DragEndEvent,
	KeyboardSensor,
	PointerSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	arrayMove,
	rectSortingStrategy,
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Icon } from "@iconify/react";
import * as React from "react";
import {
	Controller,
	type ControllerRenderProps,
	type FieldValues,
} from "react-hook-form";
import { toast } from "sonner";
import { useCollectionItem } from "../../hooks/use-collection";
import { type Asset, useUpload } from "../../hooks/use-upload";
import { useUploadCollection } from "../../hooks/use-upload-collection";
import { useResolveText, useTranslation } from "../../i18n/hooks";
import { selectClient, useAdminStore } from "../../runtime";
import { MediaPickerDialog } from "../media/media-picker-dialog";
import { AssetPreview } from "../primitives/asset-preview";
import { Dropzone } from "../primitives/dropzone";
import { ResourceSheet } from "../sheets";
import { Button } from "../ui/button";
import type { BaseFieldProps } from "./field-types";
import { sanitizeFilename, useResolvedControl } from "./field-utils";
import { FieldWrapper } from "./field-wrapper";

// ============================================================================
// Helpers
// ============================================================================

/**
 * Normalize accept to always be an array.
 * Supports both string and array formats from field configs.
 */
function normalizeAccept(
	accept: string | string[] | undefined,
): string[] | undefined {
	if (!accept) return undefined;
	if (Array.isArray(accept)) return accept;
	return [accept];
}

// ============================================================================
// Types
// ============================================================================

interface UploadFieldProps extends BaseFieldProps {
	/**
	 * Target collection for uploads
	 */
	to?: string;

	/**
	 * Accepted file types (MIME types or extensions)
	 * @example ["image/*", "application/pdf"]
	 * @example "image/*"
	 */
	accept?: string | string[];

	/**
	 * Maximum file size in bytes
	 */
	maxSize?: number;

	/**
	 * Show image preview for uploaded files
	 * @default true
	 */
	showPreview?: boolean;

	/**
	 * Allow editing alt/caption (opens edit dialog)
	 * @default true
	 */
	editable?: boolean;

	/**
	 * Preview variant
	 * @default "card" for single, "thumbnail" for multiple grid
	 */
	previewVariant?: "card" | "compact" | "thumbnail";

	/**
	 * Callback when upload starts
	 */
	onUploadStart?: () => void;

	/**
	 * Callback when upload completes
	 */
	onUploadComplete?: (asset: Asset | Asset[]) => void;

	/**
	 * Callback when upload fails
	 */
	onUploadError?: (error: Error) => void;

	// ── Multiple upload options ──────────────────────────────────────────────

	/**
	 * Enable multiple file uploads.
	 * When true, field value is an array of asset IDs.
	 * @default false
	 */
	multiple?: boolean;

	/**
	 * Maximum number of files (only when multiple: true)
	 */
	maxItems?: number;

	/**
	 * Enable drag-and-drop reordering (only when multiple: true)
	 * @default false
	 */
	orderable?: boolean;

	/**
	 * Layout for previews (only when multiple: true)
	 * @default "grid"
	 */
	layout?: "grid" | "list";
}

// ============================================================================
// Sortable Item Component (for multiple mode)
// ============================================================================

interface SortableAssetItemProps {
	id: string;
	asset: Asset | null;
	loading?: boolean;
	progress?: number;
	disabled?: boolean;
	variant: "compact" | "thumbnail";
	orderable?: boolean;
	editable?: boolean;
	href?: string;
	onRemove?: () => void;
	onEdit?: () => void;
}

function SortableAssetItem({
	id,
	asset,
	loading,
	progress,
	disabled,
	variant,
	orderable,
	editable,
	href,
	onRemove,
	onEdit,
}: SortableAssetItemProps) {
	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id });

	const style = {
		transform: CSS.Transform.toString(transform),
		transition,
	};

	return (
		<div
			ref={setNodeRef}
			style={style}
			className={isDragging ? "opacity-50" : ""}
		>
			<AssetPreview
				asset={asset || { id }}
				loading={loading}
				progress={progress}
				disabled={disabled}
				variant={variant}
				showDragHandle={orderable && !disabled}
				dragHandleProps={
					orderable ? { ...attributes, ...listeners } : undefined
				}
				href={href}
				onRemove={disabled ? undefined : onRemove}
				onEdit={editable && !disabled ? onEdit : undefined}
			/>
		</div>
	);
}

// ============================================================================
// Single Upload Inner Component
// ============================================================================

interface SingleUploadInnerProps {
	field: ControllerRenderProps<FieldValues, string>;
	error?: string;
	collection: string;
	unresolvedCollectionMessage?: string;
	accept?: string | string[];
	maxSize?: number;
	showPreview: boolean;
	editable: boolean;
	previewVariant: "card" | "compact" | "thumbnail";
	disabled?: boolean;
	placeholder?: string;
	onUploadStart?: () => void;
	onUploadComplete?: (asset: Asset) => void;
	onUploadError?: (error: Error) => void;
	className?: string;
}

function SingleUploadInner({
	field,
	error,
	collection,
	unresolvedCollectionMessage,
	accept,
	maxSize,
	showPreview,
	editable,
	previewVariant,
	disabled,
	placeholder,
	onUploadStart,
	onUploadComplete,
	onUploadError,
	className,
}: SingleUploadInnerProps) {
	"use no memo";
	// Normalize accept to always be an array (supports both string and array from field config)
	const normalizedAccept = normalizeAccept(accept);

	const { t } = useTranslation();
	const resolveText = useResolveText();
	const resolvedPlaceholder = placeholder
		? resolveText(placeholder)
		: undefined;
	const { upload, isUploading, progress, error: uploadError } = useUpload();
	const [isPickerOpen, setIsPickerOpen] = React.useState(false);
	const [isEditSheetOpen, setIsEditSheetOpen] = React.useState(false);

	const assetId = field.value as string | null | undefined;

	const { data: asset, isLoading: isLoadingAsset } = useCollectionItem(
		collection,
		assetId || "",
		undefined,
		{ enabled: !!collection && !!assetId && showPreview },
	);

	const handleDrop = async (files: File[]) => {
		if (files.length === 0 || disabled) return;
		if (!collection) {
			toast.error(
				unresolvedCollectionMessage || "No upload collection is configured.",
			);
			return;
		}

		const originalFile = files[0];
		const sanitizedName = sanitizeFilename(originalFile.name);
		const file = new File([originalFile], sanitizedName, {
			type: originalFile.type,
		});

		try {
			if (onUploadStart) {
				onUploadStart();
			}
			const uploadedAsset = await upload(file, { to: collection });
			field.onChange(uploadedAsset.id);
			if (onUploadComplete) {
				onUploadComplete(uploadedAsset);
			}
		} catch (err) {
			let uploadErr: Error;
			if (err instanceof Error) {
				uploadErr = err;
			} else {
				uploadErr = new Error(t("upload.error"));
			}
			if (onUploadError) {
				onUploadError(uploadErr);
			}
			toast.error(uploadErr.message);
		}
	};

	const handleRemove = () => {
		field.onChange(null);
	};

	const handleEdit = () => {
		if (assetId) {
			setIsEditSheetOpen(true);
		}
	};

	const handleValidationError = (errors: { message: string }[]) => {
		for (const validationError of errors) {
			toast.error(validationError.message);
		}
	};

	const hintText = React.useMemo(() => {
		const parts: string[] = [];
		if (normalizedAccept?.length) {
			const types = normalizedAccept
				.map((t: string) => {
					if (t.startsWith("image/")) return "Images";
					if (t.startsWith("video/")) return "Videos";
					if (t.startsWith("audio/")) return "Audio";
					if (t === "application/pdf") return "PDF";
					return t;
				})
				.filter((v: string, i: number, a: string[]) => a.indexOf(v) === i);
			parts.push(types.join(", "));
		}
		if (maxSize) {
			const mb = (maxSize / (1024 * 1024)).toFixed(0);
			parts.push(`Max ${mb}MB`);
		}
		return parts.join(" • ") || undefined;
	}, [normalizedAccept, maxSize]);

	const hasValue = !!assetId;
	const isLoading = isUploading || (hasValue && isLoadingAsset);

	const handlePickerSelect = (id: string | string[]) => {
		if (typeof id === "string") {
			field.onChange(id);
		}
	};

	return (
		<div className={className}>
			{unresolvedCollectionMessage && (
				<p className="mb-2 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-warning">
					{unresolvedCollectionMessage}
				</p>
			)}

			{hasValue && showPreview && asset ? (
				<AssetPreview
					asset={asset as Asset}
					loading={isLoading}
					progress={isUploading ? progress : undefined}
					disabled={disabled}
					variant={previewVariant}
					onRemove={disabled ? undefined : handleRemove}
					onEdit={editable && !disabled ? handleEdit : undefined}
				/>
			) : hasValue && showPreview && isLoadingAsset ? (
				<AssetPreview
					asset={{ id: assetId }}
					loading={true}
					disabled={disabled}
					variant={previewVariant}
				/>
			) : (
				<Dropzone
					onDrop={handleDrop}
					accept={normalizedAccept}
					maxSize={maxSize}
					multiple={false}
					disabled={disabled}
					loading={isUploading}
					progress={isUploading ? progress : undefined}
					label={resolvedPlaceholder || "Drop file here or click to browse"}
					hint={hintText}
					onValidationError={handleValidationError}
				/>
			)}

			{!hasValue && !isUploading && !disabled && !!collection && (
				<Button
					type="button"
					variant="outline"
					size="sm"
					onClick={() => setIsPickerOpen(true)}
					className="mt-2 w-full"
				>
					<Icon icon="ph:folder-open-bold" className="mr-2 size-4" />
					Browse Library
				</Button>
			)}

			<MediaPickerDialog
				open={isPickerOpen}
				onOpenChange={setIsPickerOpen}
				mode="single"
				accept={normalizedAccept}
				onSelect={handlePickerSelect}
				collection={collection || undefined}
			/>

			{assetId && !!collection && (
				<ResourceSheet
					type="collection"
					collection={collection}
					itemId={assetId}
					open={isEditSheetOpen}
					onOpenChange={setIsEditSheetOpen}
				/>
			)}

			{error && <p className="text-destructive mt-1 text-xs">{error}</p>}
		</div>
	);
}

// ============================================================================
// Multiple Upload Inner Component
// ============================================================================

interface MultipleUploadInnerProps {
	field: ControllerRenderProps<FieldValues, string>;
	error?: string;
	collection: string;
	unresolvedCollectionMessage?: string;
	accept?: string | string[];
	maxSize?: number;
	maxItems?: number;
	orderable: boolean;
	layout: "grid" | "list";
	editable: boolean;
	disabled?: boolean;
	placeholder?: string;
	onUploadStart?: () => void;
	onUploadComplete?: (assets: Asset[]) => void;
	onUploadError?: (error: Error) => void;
	className?: string;
}

function MultipleUploadInner({
	field,
	collection,
	unresolvedCollectionMessage,
	accept,
	maxSize,
	maxItems,
	orderable,
	layout,
	editable,
	disabled,
	placeholder,
	onUploadStart,
	onUploadComplete,
	onUploadError,
	className,
}: MultipleUploadInnerProps) {
	"use no memo";
	// Normalize accept to always be an array (supports both string and array from field config)
	const normalizedAccept = normalizeAccept(accept);

	const { t } = useTranslation();
	const resolveText = useResolveText();
	const resolvedPlaceholder = placeholder
		? resolveText(placeholder)
		: undefined;
	const { uploadMany, isUploading, progress } = useUpload();
	const client = useAdminStore(selectClient);
	const [isPickerOpen, setIsPickerOpen] = React.useState(false);
	const [editAssetId, setEditAssetId] = React.useState<string | null>(null);
	const [pendingUploads, setPendingUploads] = React.useState<
		{ id: string; file: File }[]
	>([]);
	const [fetchedAssets, setFetchedAssets] = React.useState<Map<string, Asset>>(
		() => new Map(),
	);

	const sensors = useSensors(
		useSensor(PointerSensor),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	);

	const assetIds = (field.value as string[] | null | undefined) || [];

	// Fetch assets that we don't have yet
	React.useEffect(() => {
		if (!client || !collection || assetIds.length === 0) return;

		const missingIds = assetIds.filter((id) => !fetchedAssets.has(id));
		if (missingIds.length === 0) return;

		let cancelled = false;

		(async () => {
			try {
				const response = await (client as any).collections[collection].find({
					where: { id: { in: missingIds } },
					limit: missingIds.length,
				});
				if (!cancelled && response?.docs) {
					setFetchedAssets((prev) => {
						const next = new Map(prev);
						for (const asset of response.docs) {
							next.set(asset.id, asset as Asset);
						}
						return next;
					});
				}
			} catch (fetchError) {
				if (!cancelled) {
					console.error("Failed to fetch assets:", fetchError);
					toast.error("Failed to load assets");
				}
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [assetIds, collection, fetchedAssets, client]);

	const handleDrop = async (files: File[]) => {
		if (files.length === 0 || disabled) return;
		if (!collection) {
			toast.error(
				unresolvedCollectionMessage || "No upload collection is configured.",
			);
			return;
		}

		const remainingSlots = maxItems ? maxItems - assetIds.length : files.length;
		const filesToUpload = files.slice(0, remainingSlots);

		if (filesToUpload.length < files.length) {
			toast.warning(
				t("toast.maxFilesWarning", {
					remaining: remainingSlots,
					max: maxItems,
				}),
			);
		}

		if (filesToUpload.length === 0) return;

		const sanitizedFiles = filesToUpload.map((file) => {
			const sanitizedName = sanitizeFilename(file.name);
			return new File([file], sanitizedName, { type: file.type });
		});

		const pending = sanitizedFiles.map((file, index) => ({
			id: `pending-${Date.now()}-${index}`,
			file,
		}));
		setPendingUploads(pending);

		try {
			if (onUploadStart) {
				onUploadStart();
			}
			const uploadedAssets = await uploadMany(sanitizedFiles, {
				to: collection,
			});
			const newIds = uploadedAssets.map((a) => a.id);
			field.onChange([...assetIds, ...newIds]);

			for (const asset of uploadedAssets) {
				setFetchedAssets((prev) => new Map(prev).set(asset.id, asset));
			}

			if (onUploadComplete) {
				onUploadComplete(uploadedAssets);
			}
		} catch (err) {
			let uploadError: Error;
			if (err instanceof Error) {
				uploadError = err;
			} else {
				uploadError = new Error(t("upload.error"));
			}
			if (onUploadError) {
				onUploadError(uploadError);
			}
			toast.error(uploadError.message);
		} finally {
			setPendingUploads([]);
		}
	};

	const handleRemove = (idToRemove: string) => {
		field.onChange(assetIds.filter((id) => id !== idToRemove));
	};

	const handleEdit = (id: string) => {
		setEditAssetId(id);
	};

	const handleDragEnd = (event: DragEndEvent) => {
		const { active, over } = event;

		if (over && active.id !== over.id) {
			const oldIndex = assetIds.indexOf(active.id as string);
			const newIndex = assetIds.indexOf(over.id as string);

			if (oldIndex !== -1 && newIndex !== -1) {
				const reordered = arrayMove(assetIds, oldIndex, newIndex);
				field.onChange(reordered);
			}
		}
	};

	const handleValidationError = (errors: { message: string }[]) => {
		for (const validationError of errors) {
			toast.error(validationError.message);
		}
	};

	const handlePickerSelect = (ids: string | string[]) => {
		if (!collection) {
			toast.error(
				unresolvedCollectionMessage || "No upload collection is configured.",
			);
			return;
		}

		const newIds = Array.isArray(ids) ? ids : [ids];

		const totalAfterAdd = assetIds.length + newIds.length;
		if (maxItems && totalAfterAdd > maxItems) {
			toast.warning(`Maximum ${maxItems} items allowed`);
			const remainingSlots = maxItems - assetIds.length;
			const idsToAdd = newIds.slice(0, remainingSlots);
			field.onChange([...assetIds, ...idsToAdd]);
		} else {
			field.onChange([...assetIds, ...newIds]);
		}
	};

	const hintText = React.useMemo(() => {
		const parts: string[] = [];
		if (normalizedAccept?.length) {
			const types = normalizedAccept
				.map((t: string) => {
					if (t.startsWith("image/")) return "Images";
					if (t.startsWith("video/")) return "Videos";
					if (t.startsWith("audio/")) return "Audio";
					if (t === "application/pdf") return "PDF";
					return t;
				})
				.filter((v: string, i: number, a: string[]) => a.indexOf(v) === i);
			parts.push(types.join(", "));
		}
		if (maxSize) {
			const mb = (maxSize / (1024 * 1024)).toFixed(0);
			parts.push(`Max ${mb}MB`);
		}
		return parts.join(" • ") || undefined;
	}, [normalizedAccept, maxSize]);

	const hasItems = assetIds.length > 0 || pendingUploads.length > 0;
	const canAddMore = !maxItems || assetIds.length < maxItems;
	const previewVariant = layout === "grid" ? "thumbnail" : "compact";
	const sortingStrategy =
		layout === "grid" ? rectSortingStrategy : verticalListSortingStrategy;

	return (
		<div className={className}>
			{unresolvedCollectionMessage && (
				<p className="mb-2 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-warning">
					{unresolvedCollectionMessage}
				</p>
			)}

			{hasItems && (
				<DndContext
					sensors={sensors}
					collisionDetection={closestCenter}
					onDragEnd={handleDragEnd}
				>
					<SortableContext
						items={assetIds}
						strategy={sortingStrategy}
						disabled={!orderable}
					>
						<div
							className={
								layout === "grid"
									? "mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4"
									: "mb-3 space-y-2"
							}
						>
							{assetIds.map((id) => (
								<SortableAssetItem
									key={id}
									id={id}
									asset={fetchedAssets.get(id) || null}
									disabled={disabled}
									variant={previewVariant}
									orderable={orderable}
									editable={editable}
									onRemove={() => handleRemove(id)}
									onEdit={() => handleEdit(id)}
								/>
							))}

							{pendingUploads.map((pending, index) => (
								<div key={pending.id}>
									<AssetPreview
										asset={{ filename: pending.file.name }}
										pendingFile={pending.file}
										loading={true}
										progress={Math.min(
											100,
											Math.max(
												0,
												progress - (index / pendingUploads.length) * 100,
											) *
												(pendingUploads.length /
													(pendingUploads.length - index)),
										)}
										disabled={true}
										variant={previewVariant}
									/>
								</div>
							))}
						</div>
					</SortableContext>
				</DndContext>
			)}

			{canAddMore && !isUploading && !!collection && (
				<Dropzone
					onDrop={handleDrop}
					accept={normalizedAccept}
					maxSize={maxSize}
					multiple={true}
					disabled={disabled}
					loading={isUploading}
					progress={isUploading ? progress : undefined}
					label={
						hasItems
							? "Drop more files or click to add"
							: resolvedPlaceholder || "Drop files here or click to browse"
					}
					hint={hintText}
					onValidationError={handleValidationError}
					className={hasItems ? "min-h-[80px]" : undefined}
				/>
			)}

			{canAddMore && !isUploading && !disabled && !!collection && (
				<Button
					type="button"
					variant="outline"
					size="sm"
					onClick={() => setIsPickerOpen(true)}
					className="mt-2 w-full"
				>
					<Icon icon="ph:folder-open-bold" className="mr-2 size-4" />
					Browse Library
				</Button>
			)}

			<MediaPickerDialog
				open={isPickerOpen}
				onOpenChange={setIsPickerOpen}
				mode="multiple"
				accept={normalizedAccept}
				onSelect={handlePickerSelect}
				maxItems={maxItems ? maxItems - assetIds.length : undefined}
				collection={collection || undefined}
			/>

			{editAssetId && !!collection && (
				<ResourceSheet
					type="collection"
					collection={collection}
					itemId={editAssetId}
					open={!!editAssetId}
					onOpenChange={(open: boolean) => !open && setEditAssetId(null)}
				/>
			)}

			{isUploading && !canAddMore && (
				<div className="text-muted-foreground flex items-center justify-center gap-2 rounded-lg border border-dashed p-4 text-sm">
					Uploading... {progress}%
				</div>
			)}
		</div>
	);
}

// ============================================================================
// Main Component
// ============================================================================

export function UploadField({
	name,
	label,
	description,
	placeholder,
	required,
	disabled,
	localized,
	locale,
	control,
	className,
	to,
	accept,
	maxSize,
	showPreview = true,
	editable = true,
	previewVariant,
	onUploadStart,
	onUploadComplete,
	onUploadError,
	// Multiple mode options
	multiple = false,
	maxItems,
	orderable = false,
	layout = "grid",
}: UploadFieldProps) {
	const resolveText = useResolveText();
	const resolvedControl = useResolvedControl(control);
	const {
		collection: resolvedUploadCollection,
		collections: availableUploadCollections,
	} = useUploadCollection(to);
	const collection = resolvedUploadCollection || "";
	const unresolvedCollectionMessage = !resolvedUploadCollection
		? availableUploadCollections.length > 1
			? `Multiple upload collections are available (${availableUploadCollections.join(", ")}). Configure the field with \`to\` to choose one.`
			: "No upload collection is configured for this field."
		: undefined;
	const fieldDisabled = disabled || !!unresolvedCollectionMessage;

	// Determine preview variant based on mode if not specified
	const effectivePreviewVariant =
		previewVariant ??
		(multiple ? (layout === "grid" ? "thumbnail" : "compact") : "card");

	return (
		<Controller
			name={name}
			control={resolvedControl}
			render={({ field, fieldState }) => {
				// For multiple mode, show count in label
				const assetIds = multiple
					? (field.value as string[] | null | undefined) || []
					: [];
				const labelWithCount =
					multiple && label && maxItems
						? `${resolveText(label)} (${assetIds.length}/${maxItems})`
						: label
							? resolveText(label)
							: undefined;

				return (
					<FieldWrapper
						name={name}
						label={labelWithCount}
						description={description}
						required={required}
						disabled={fieldDisabled}
						localized={localized}
						locale={locale}
						error={fieldState.error?.message}
					>
						{multiple ? (
							<MultipleUploadInner
								field={field}
								error={fieldState.error?.message}
								collection={collection}
								unresolvedCollectionMessage={unresolvedCollectionMessage}
								accept={accept}
								maxSize={maxSize}
								maxItems={maxItems}
								orderable={orderable}
								layout={layout}
								editable={editable}
								disabled={fieldDisabled}
								placeholder={placeholder}
								onUploadStart={onUploadStart}
								onUploadComplete={onUploadComplete as (assets: Asset[]) => void}
								onUploadError={onUploadError}
								className={className}
							/>
						) : (
							<SingleUploadInner
								field={field}
								error={fieldState.error?.message}
								collection={collection}
								unresolvedCollectionMessage={unresolvedCollectionMessage}
								accept={accept}
								maxSize={maxSize}
								showPreview={showPreview}
								editable={editable}
								previewVariant={effectivePreviewVariant}
								disabled={fieldDisabled}
								placeholder={placeholder}
								onUploadStart={onUploadStart}
								onUploadComplete={onUploadComplete as (asset: Asset) => void}
								onUploadError={onUploadError}
								className={className}
							/>
						)}
					</FieldWrapper>
				);
			}}
		/>
	);
}
