/**
 * Table Controls Component
 *
 * Popover with table manipulation controls.
 */

import type { Editor } from "@tiptap/core";
import * as React from "react";

import { useIsMobile } from "../../../hooks/use-media-query";
import { useTranslation } from "../../../i18n/hooks";
import { Button } from "../../ui/button";
import {
	Popover,
	PopoverContent,
	PopoverHeader,
	PopoverTitle,
	PopoverTrigger,
} from "../../ui/popover";
import {
	ResponsiveDialog,
	ResponsiveDialogContent,
	ResponsiveDialogHeader,
	ResponsiveDialogTitle,
} from "../../ui/responsive-dialog";

type TableControlsProps = {
	editor: Editor;
	disabled?: boolean;
	inTable: boolean;
	triggerButton?: React.ReactElement;
};

/**
 * Table manipulation controls popover
 */
export function TableControls({
	editor,
	disabled,
	inTable,
	triggerButton,
}: TableControlsProps) {
	const { t } = useTranslation();
	const isMobile = useIsMobile();
	const [open, setOpen] = React.useState(false);
	const isEditable = !disabled;

	const runAction = React.useCallback(
		(action: (chain: ReturnType<Editor["chain"]>) => void) => {
			const chain = editor.chain().focus();
			action(chain);
			// Close the bottom sheet after acting so the user sees the result.
			if (isMobile) setOpen(false);
		},
		[editor, isMobile],
	);

	// Single column on mobile so each row is a full-width, easily tappable target
	// and the labels never truncate; two columns on desktop to stay compact.
	const grid = (
		<div className="grid grid-cols-1 gap-2 md:grid-cols-2">
			<Button
				type="button"
				size="xs"
				onClick={() =>
					runAction((chain) =>
						chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
					)
				}
				disabled={!isEditable}
			>
				{t("editor.table")}
			</Button>
			<Button
				type="button"
				size="xs"
				variant="outline"
				onClick={() => runAction((chain) => chain.addRowBefore().run())}
				disabled={!isEditable || !inTable}
			>
				{t("editor.addRowBefore")}
			</Button>
			<Button
				type="button"
				size="xs"
				variant="outline"
				onClick={() => runAction((chain) => chain.addRowAfter().run())}
				disabled={!isEditable || !inTable}
			>
				{t("editor.addRowAfter")}
			</Button>
			<Button
				type="button"
				size="xs"
				variant="outline"
				onClick={() => runAction((chain) => chain.addColumnBefore().run())}
				disabled={!isEditable || !inTable}
			>
				{t("editor.addColumnBefore")}
			</Button>
			<Button
				type="button"
				size="xs"
				variant="outline"
				onClick={() => runAction((chain) => chain.addColumnAfter().run())}
				disabled={!isEditable || !inTable}
			>
				{t("editor.addColumnAfter")}
			</Button>
			<Button
				type="button"
				size="xs"
				variant="outline"
				onClick={() => runAction((chain) => chain.deleteRow().run())}
				disabled={!isEditable || !inTable}
			>
				{t("editor.deleteRow")}
			</Button>
			<Button
				type="button"
				size="xs"
				variant="outline"
				onClick={() => runAction((chain) => chain.deleteColumn().run())}
				disabled={!isEditable || !inTable}
			>
				{t("editor.deleteColumn")}
			</Button>
			<Button
				type="button"
				size="xs"
				variant="outline"
				onClick={() => runAction((chain) => chain.toggleHeaderRow().run())}
				disabled={!isEditable || !inTable}
			>
				{t("editor.toggleHeaderRow")}
			</Button>
			<Button
				type="button"
				size="xs"
				variant="outline"
				onClick={() => runAction((chain) => chain.toggleHeaderColumn().run())}
				disabled={!isEditable || !inTable}
			>
				{t("editor.toggleHeaderColumn")}
			</Button>
			<Button
				type="button"
				size="xs"
				variant="outline"
				onClick={() => runAction((chain) => chain.mergeCells().run())}
				disabled={!isEditable || !inTable}
			>
				{t("editor.mergeCells")}
			</Button>
			<Button
				type="button"
				size="xs"
				variant="outline"
				onClick={() => runAction((chain) => chain.splitCell().run())}
				disabled={!isEditable || !inTable}
			>
				{t("editor.splitCell")}
			</Button>
			<Button
				type="button"
				size="xs"
				variant="outline"
				onClick={() => runAction((chain) => chain.deleteTable().run())}
				disabled={!isEditable || !inTable}
			>
				{t("editor.deleteTable")}
			</Button>
		</div>
	);

	// On mobile render as a bottom sheet so the dense control grid isn't a
	// clipped, fixed-width popover.
	if (isMobile) {
		return (
			<>
				{triggerButton
					? React.cloneElement(
							triggerButton as React.ReactElement<{
								onClick?: () => void;
							}>,
							{ onClick: () => setOpen(true) },
						)
					: null}
				<ResponsiveDialog open={open} onOpenChange={setOpen}>
					<ResponsiveDialogContent className="p-4">
						<ResponsiveDialogHeader className="px-0 pt-0">
							<ResponsiveDialogTitle>{t("editor.table")}</ResponsiveDialogTitle>
						</ResponsiveDialogHeader>
						{grid}
					</ResponsiveDialogContent>
				</ResponsiveDialog>
			</>
		);
	}

	return (
		<Popover>
			<PopoverTrigger render={triggerButton || <div className="sr-only" />} />
			<PopoverContent className="w-80 max-w-[calc(100vw-2rem)]">
				<PopoverHeader>
					<PopoverTitle>{t("editor.table")}</PopoverTitle>
				</PopoverHeader>
				{grid}
			</PopoverContent>
		</Popover>
	);
}
