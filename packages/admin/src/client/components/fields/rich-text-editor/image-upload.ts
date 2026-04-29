import * as React from "react";

import { type Asset, useUpload } from "../../../hooks/use-upload";
import { useUploadCollection } from "../../../hooks/use-upload-collection";
import { useTranslation } from "../../../i18n/hooks";
import { sanitizeFilename } from "../field-utils";

type RichTextImageUploadOptions = {
	imageCollection?: string;
	onImageUpload?: (file: File) => Promise<string>;
};

export function getImageFilesFromDataTransfer(
	dataTransfer: DataTransfer | null | undefined,
): File[] {
	return Array.from(dataTransfer?.files ?? []).filter((file) =>
		file.type.startsWith("image/"),
	);
}

export function getImageAltFromFile(file: File): string | undefined {
	const cleanName = file.name.trim();
	if (!cleanName) return undefined;

	return cleanName.replace(/\.[^.]+$/, "") || cleanName;
}

export function useRichTextImageUpload({
	imageCollection,
	onImageUpload,
}: RichTextImageUploadOptions) {
	const { t } = useTranslation();
	const { upload, isUploading } = useUpload();
	const { collection, collections } = useUploadCollection(imageCollection);

	const uploadImageFile = React.useCallback(
		async (file: File): Promise<string> => {
			if (!file.type.startsWith("image/")) {
				throw new Error(`"${file.name}" is not an image file.`);
			}

			if (onImageUpload) {
				const url = await onImageUpload(file);
				if (!url) {
					throw new Error(t("upload.error"));
				}
				return url;
			}

			if (!collection) {
				if (collections.length > 1) {
					throw new Error(
						`Multiple upload collections are available (${collections.join(", ")}). Configure rich-text imageCollection to choose one.`,
					);
				}

				throw new Error(
					"No upload collection is configured for rich-text image uploads.",
				);
			}

			const sanitizedName = sanitizeFilename(file.name);
			const uploadFile =
				sanitizedName === file.name
					? file
					: new File([file], sanitizedName, { type: file.type });

			const uploadedAsset = (await upload(uploadFile, {
				to: collection,
			})) as Asset;

			if (!uploadedAsset?.url) {
				throw new Error(t("upload.error"));
			}

			return uploadedAsset.url;
		},
		[collection, collections, onImageUpload, t, upload],
	);

	return {
		collection,
		collections,
		isUploading,
		uploadImageFile,
	};
}
