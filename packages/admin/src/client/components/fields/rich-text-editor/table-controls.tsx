/**
 * Table Controls Component
 *
 * Popover with table manipulation controls.
 */

import type { Editor } from "@tiptap/core";
import type * as React from "react";

import { useTranslation } from "../../../i18n/hooks";
import { Button } from "../../ui/button";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "../../ui/popover";

export type TableControlsProps = {
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
  const isEditable = !disabled;

  return (
    <Popover>
      <PopoverTrigger render={triggerButton || <div className="sr-only" />} />
      <PopoverContent className="w-80">
        <PopoverHeader>
          <PopoverTitle>{t("editor.table")}</PopoverTitle>
        </PopoverHeader>
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            size="xs"
            onClick={() =>
              editor
                .chain()
                .focus()
                .insertTable({
                  rows: 3,
                  cols: 3,
                  withHeaderRow: true,
                })
                .run()
            }
            disabled={!isEditable}
          >
            {t("editor.table")}
          </Button>
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() => editor.chain().focus().addRowBefore().run()}
            disabled={!isEditable || !inTable}
          >
            {t("editor.addRowBefore")}
          </Button>
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() => editor.chain().focus().addRowAfter().run()}
            disabled={!isEditable || !inTable}
          >
            {t("editor.addRowAfter")}
          </Button>
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() => editor.chain().focus().addColumnBefore().run()}
            disabled={!isEditable || !inTable}
          >
            {t("editor.addColumnBefore")}
          </Button>
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() => editor.chain().focus().addColumnAfter().run()}
            disabled={!isEditable || !inTable}
          >
            {t("editor.addColumnAfter")}
          </Button>
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() => editor.chain().focus().deleteRow().run()}
            disabled={!isEditable || !inTable}
          >
            {t("editor.deleteRow")}
          </Button>
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() => editor.chain().focus().deleteColumn().run()}
            disabled={!isEditable || !inTable}
          >
            {t("editor.deleteColumn")}
          </Button>
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() => editor.chain().focus().toggleHeaderRow().run()}
            disabled={!isEditable || !inTable}
          >
            {t("editor.toggleHeaderRow")}
          </Button>
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() => editor.chain().focus().toggleHeaderColumn().run()}
            disabled={!isEditable || !inTable}
          >
            {t("editor.toggleHeaderColumn")}
          </Button>
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() => editor.chain().focus().mergeCells().run()}
            disabled={!isEditable || !inTable}
          >
            {t("editor.mergeCells")}
          </Button>
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() => editor.chain().focus().splitCell().run()}
            disabled={!isEditable || !inTable}
          >
            {t("editor.splitCell")}
          </Button>
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() => editor.chain().focus().deleteTable().run()}
            disabled={!isEditable || !inTable}
          >
            {t("editor.deleteTable")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
