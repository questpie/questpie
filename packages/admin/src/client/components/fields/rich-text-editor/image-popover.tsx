/**
 * Image Popover Component
 *
 * Dialog for inserting images via URL or file upload.
 */

import type { Editor } from "@tiptap/core";
import * as React from "react";
import { toast } from "sonner";

import { useCollectionItem } from "../../../hooks/use-collection";
import { type Asset, useUpload } from "../../../hooks/use-upload";
import { useUploadCollection } from "../../../hooks/use-upload-collection";
import { useTranslation } from "../../../i18n/hooks";
import { MediaPickerDialog } from "../../media/media-picker-dialog";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import {
	Popover,
	PopoverContent,
	PopoverHeader,
	PopoverTitle,
	PopoverTrigger,
} from "../../ui/popover";
import { sanitizeFilename } from "../field-utils";

type ImagePopoverProps = {
	editor: Editor | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	disabled?: boolean;
	onImageUpload?: (file: File) => Promise<string>;
	imageCollection?: string;
	enableMediaLibrary?: boolean;
};

/**
 * Image insertion popover
 */
export function ImagePopover({
	editor,
	open,
	onOpenChange,
	disabled,
	onImageUpload,
	imageCollection,
	enableMediaLibrary,
}: ImagePopoverProps) {
	"use no memo";
	const { t } = useTranslation();
	const [imageUrl, setImageUrl] = React.useState("");
	const [imageAlt, setImageAlt] = React.useState("");
	const [uploadingImage, setUploadingImage] = React.useState(false);
	const fileInputRef = React.useRef<HTMLInputElement | null>(null);
	const [isPickerOpen, setIsPickerOpen] = React.useState(false);
	const [selectedAssetId, setSelectedAssetId] = React.useState<string | null>(
		null,
	);
	const { upload } = useUpload();
	const { collection, collections: availableUploadCollections } =
		useUploadCollection(imageCollection);
	const showMediaLibrary = enableMediaLibrary ?? true;
	const { data: selectedAsset } = useCollectionItem(
		collection || "",
		selectedAssetId || "",
		undefined,
		{ enabled: !!collection && !!selectedAssetId },
	);

	const handleInsertImageUrl = React.useCallback(() => {
		if (!editor || !imageUrl) return;
		editor
			.chain()
			.focus()
			.setImage({ src: imageUrl, alt: imageAlt || undefined })
			.run();
		setImageUrl("");
		setImageAlt("");
		onOpenChange(false);
	}, [editor, imageAlt, imageUrl, onOpenChange]);

	const handleImageUpload = React.useCallback(
		async (event: React.ChangeEvent<HTMLInputElement>) => {
			const file = event.target.files?.[0];
			if (!file || !editor) return;

			try {
				setUploadingImage(true);
				let url: string | undefined;
				if (onImageUpload) {
					url = await onImageUpload(file);
				} else {
					if (!collection) {
						let errorMessage: string;
						if (availableUploadCollections.length > 1) {
							errorMessage = `Multiple upload collections are available (${availableUploadCollections.join(", ")}). Configure rich-text imageCollection to choose one.`;
						} else {
							errorMessage =
								"No upload collection is configured for rich-text image uploads.";
						}
						throw new Error(errorMessage);
					}

					const sanitizedName = sanitizeFilename(file.name);
					let uploadFile: File;
					if (sanitizedName === file.name) {
						uploadFile = file;
					} else {
						uploadFile = new File([file], sanitizedName, {
							type: file.type,
						});
					}
					const uploadedAsset = (await upload(uploadFile, {
						to: collection,
					})) as Asset;
					if (uploadedAsset && uploadedAsset.url) {
						url = uploadedAsset.url;
					}
					if (!url) {
						throw new Error(t("upload.error"));
					}
				}
				if (url) {
					const altValue = imageAlt ? imageAlt : undefined;
					editor
						.chain()
						.focus()
						.setImage({ src: url, alt: altValue })
						.run();
					setImageUrl("");
					setImageAlt("");
					onOpenChange(false);
				}
			} catch (err) {
				let uploadError: Error;
				if (err instanceof Error) {
					uploadError = err;
				} else {
					uploadError = new Error(t("upload.error"));
				}
				toast.error(uploadError.message);
			} finally {
				setUploadingImage(false);
				event.target.value = "";
			}
		},
		[
			collection,
			availableUploadCollections,
			editor,
			imageAlt,
			onImageUpload,
			onOpenChange,
			t,
			upload,
		],
	);

	React.useEffect(() => {
		if (!selectedAssetId || !selectedAsset || !editor) return;
		const assetUrl = (selectedAsset as Asset | undefined)?.url;
		if (!assetUrl) {
			toast.error(t("upload.error"));
			setSelectedAssetId(null);
			return;
		}
		editor
			.chain()
			.focus()
			.setImage({
				src: assetUrl,
				alt: imageAlt || (selectedAsset as Asset | undefined)?.alt || undefined,
			})
			.run();
		setImageUrl("");
		setImageAlt("");
		setSelectedAssetId(null);
		onOpenChange(false);
	}, [editor, imageAlt, onOpenChange, selectedAsset, selectedAssetId, t]);

	const handlePickerSelect = (ids: string | string[]) => {
		const selectedId = Array.isArray(ids) ? ids[0] : ids;
		if (!selectedId) return;
		setSelectedAssetId(selectedId);
		setIsPickerOpen(false);
	};

	return (
		<>
			<Popover open={open} onOpenChange={onOpenChange}>
				<PopoverTrigger render={<div className="sr-only" />} />
				<PopoverContent className="w-80">
					<PopoverHeader>
						<PopoverTitle>{t("editor.image")}</PopoverTitle>
					</PopoverHeader>
					<div className="space-y-3">
						<div className="space-y-2">
							<Input
								value={imageUrl}
								placeholder="https://example.com/image.jpg"
								onChange={(event) => setImageUrl(event.target.value)}
								disabled={disabled}
							/>
							<Input
								value={imageAlt}
								placeholder={t("editor.altText")}
								onChange={(event) => setImageAlt(event.target.value)}
								disabled={disabled}
							/>
							<div className="flex justify-end gap-2">
								<Button
									type="button"
									size="xs"
									onClick={handleInsertImageUrl}
									disabled={disabled || !imageUrl}
								>
									{t("editor.insertUrl")}
								</Button>
							</div>
						</div>

						<div className="space-y-2">
							<div className="text-xs font-medium">
								{t("editor.uploadFile")}
							</div>
							<input
								ref={fileInputRef}
								type="file"
								accept="image/*"
								onChange={handleImageUpload}
								className="sr-only"
								disabled={disabled || uploadingImage}
							/>
							<div className="flex items-center gap-2">
								<Button
									type="button"
									size="xs"
									variant="outline"
									onClick={() => fileInputRef.current?.click()}
									disabled={
										disabled ||
										uploadingImage ||
										(!onImageUpload && !collection)
									}
								>
									{uploadingImage
										? t("editor.uploading")
										: t("editor.chooseFile")}
								</Button>
								{showMediaLibrary && (
									<Button
										type="button"
										size="xs"
										variant="outline"
										onClick={() => setIsPickerOpen(true)}
										disabled={disabled || !collection}
									>
										{t("editor.browseLibrary")}
									</Button>
								)}
							</div>
						</div>
					</div>
				</PopoverContent>
			</Popover>
			{showMediaLibrary && (
				<MediaPickerDialog
					open={isPickerOpen}
					onOpenChange={setIsPickerOpen}
					mode="single"
					accept={["image/*"]}
					onSelect={handlePickerSelect}
					collection={collection}
				/>
			)}
		</>
	);
}
