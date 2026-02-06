/**
 * Slash Commands Component
 *
 * Provides the "/" command menu for quick insertion of blocks.
 */

import { type Editor, Extension, type Range } from "@tiptap/core";
import { ReactRenderer } from "@tiptap/react";
import Suggestion from "@tiptap/suggestion";
import * as React from "react";
import tippy, { type Instance } from "tippy.js";

import { cn } from "../../../utils";
import type {
  SlashCommandItem,
  SlashCommandListHandle,
  SlashCommandListProps,
} from "./types";

/**
 * Slash command list component
 */
export const SlashCommandList = React.forwardRef<
  SlashCommandListHandle,
  SlashCommandListProps
>(function SlashCommandList({ items, command }, ref) {
  const [selectedIndex, setSelectedIndex] = React.useState(0);

  React.useEffect(() => {
    if (items.length === 0) {
      setSelectedIndex(0);
      return;
    }

    setSelectedIndex((prev) => Math.min(prev, items.length - 1));
  }, [items.length]);

  const selectItem = (index: number) => {
    const item = items[index];
    if (item) {
      command(item);
    }
  };

  React.useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (items.length === 0) return false;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % items.length);
        return true;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + items.length) % items.length);
        return true;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        selectItem(selectedIndex);
        return true;
      }

      return false;
    },
  }));

  return (
    <div className="qp-rich-text-editor__slash">
      {items.length === 0 && (
        <div className="qp-rich-text-editor__slash-empty">No results</div>
      )}
      {items.map((item, index) => (
        <button
          key={item.title}
          type="button"
          tabIndex={-1}
          className={cn(
            "qp-rich-text-editor__slash-item",
            index === selectedIndex
              ? "qp-rich-text-editor__slash-item--active"
              : "",
          )}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => selectItem(index)}
        >
          <span className="qp-rich-text-editor__slash-title">{item.title}</span>
          {item.description && (
            <span className="qp-rich-text-editor__slash-description">
              {item.description}
            </span>
          )}
        </button>
      ))}
    </div>
  );
});

/**
 * Create slash command extension factory
 */
export function createSlashCommandExtension(
  getItems: (editor: Editor) => SlashCommandItem[],
) {
  return Extension.create({
    name: "slashCommand",
    addOptions() {
      return {
        suggestion: {
          char: "/",
          startOfLine: true,
          command: ({
            editor,
            range,
            props,
          }: {
            editor: Editor;
            range: Range;
            props: SlashCommandItem;
          }) => {
            editor.chain().focus().deleteRange(range).run();
            props.command(editor);
          },
          items: ({ query, editor }: { query: string; editor: Editor }) => {
            const items = getItems(editor);
            if (!query) return items;
            const search = query.toLowerCase();
            return items.filter((item) => {
              return (
                item.title.toLowerCase().includes(search) ||
                item.description?.toLowerCase().includes(search) ||
                item.keywords?.some((keyword) =>
                  keyword.toLowerCase().includes(search),
                )
              );
            });
          },
          render: () => {
            let component: ReactRenderer<SlashCommandListHandle> | null = null;
            let popup: Instance[] | null = null;

            return {
              onStart: (props: any) => {
                component = new ReactRenderer(SlashCommandList, {
                  props,
                  editor: props.editor,
                });

                if (!props.clientRect) {
                  return;
                }

                popup = tippy("body", {
                  getReferenceClientRect: props.clientRect,
                  appendTo: () => document.body,
                  content: component.element,
                  showOnCreate: true,
                  interactive: true,
                  trigger: "manual",
                  placement: "bottom-start",
                  theme: "qp-rich-text-editor",
                });
              },

              onUpdate: (props: any) => {
                component?.updateProps(props);

                if (!props.clientRect) {
                  return;
                }

                popup?.[0].setProps({
                  getReferenceClientRect: props.clientRect,
                });
              },

              onKeyDown: (props: any) => {
                if (props.event.key === "Escape") {
                  popup?.[0].hide();
                  return true;
                }

                return component?.ref?.onKeyDown(props) ?? false;
              },

              onExit: () => {
                popup?.[0].destroy();
                component?.destroy();
              },
            };
          },
        },
      };
    },
    addProseMirrorPlugins() {
      return [
        Suggestion({
          editor: this.editor,
          ...this.options.suggestion,
        }),
      ];
    },
  });
}
