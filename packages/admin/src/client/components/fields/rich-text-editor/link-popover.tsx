/**
 * Link Popover Component
 *
 * Dialog for inserting and editing links.
 */

import type { Editor } from "@tiptap/core";
import * as React from "react";

import { useTranslation } from "../../../i18n/hooks";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import {
	Popover,
	PopoverContent,
	PopoverHeader,
	PopoverTitle,
	PopoverTrigger,
} from "../../ui/popover";
import { createLinkAttributes } from "./link-utils";

type LinkPopoverProps = {
	editor: Editor | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	disabled?: boolean;
};

/**
 * Link insertion/editing popover
 */
export function LinkPopover({
	editor,
	open,
	onOpenChange,
	disabled,
}: LinkPopoverProps) {
	const { t } = useTranslation();
	const [linkUrl, setLinkUrl] = React.useState("");
	const prevOpenRef = React.useRef(false);

	React.useEffect(() => {
		if (open && !prevOpenRef.current && editor) {
			const currentLink = editor.getAttributes("link").href as
				| string
				| undefined;
			setLinkUrl(currentLink || "");
		}
		prevOpenRef.current = open;
	}, [editor, open]);

	const handleApplyLink = React.useCallback(() => {
		if (!editor) return;
		if (!linkUrl) {
			editor.chain().focus().unsetLink().run();
			onOpenChange(false);
			return;
		}

		editor.chain().focus().setLink(createLinkAttributes(linkUrl)).run();
		onOpenChange(false);
	}, [editor, linkUrl, onOpenChange]);

	const handleRemoveLink = React.useCallback(() => {
		if (!editor) return;
		editor.chain().focus().unsetLink().run();
		onOpenChange(false);
	}, [editor, onOpenChange]);

	return (
		<Popover open={open} onOpenChange={onOpenChange}>
			<PopoverTrigger render={<div className="sr-only" />} />
			<PopoverContent className="w-72">
				<PopoverHeader>
					<PopoverTitle>{t("editor.link")}</PopoverTitle>
				</PopoverHeader>
				<div className="space-y-2">
					<Input
						aria-label={t("editor.link")}
						autoComplete="off"
						inputMode="url"
						name="rich-text-link-url"
						type="text"
						value={linkUrl}
						placeholder={t("editor.pasteOrTypeLink")}
						onChange={(event) => setLinkUrl(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								event.preventDefault();
								handleApplyLink();
							}
						}}
						disabled={disabled}
					/>
					<div className="flex justify-end gap-2">
						<Button
							type="button"
							size="xs"
							variant="outline"
							onClick={handleRemoveLink}
							disabled={disabled || !editor?.isActive("link")}
						>
							{t("common.remove")}
						</Button>
						<Button
							type="button"
							size="xs"
							onClick={handleApplyLink}
							disabled={disabled}
						>
							{t("common.apply")}
						</Button>
					</div>
				</div>
			</PopoverContent>
		</Popover>
	);
}
