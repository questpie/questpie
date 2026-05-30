/**
 * Slash Commands Component
 *
 * Provides the "/" command menu for quick insertion of blocks.
 */

import { Icon } from "@iconify/react";
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
const SlashCommandList = React.forwardRef<
	SlashCommandListHandle,
	SlashCommandListProps
>(function SlashCommandList({ items, command }, ref) {
	const [selectedIndex, setSelectedIndex] = React.useState(0);
	const safeIndex = Math.min(selectedIndex, Math.max(0, items.length - 1));

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
				selectItem(safeIndex);
				return true;
			}

			if (event.key === "Tab") {
				event.preventDefault();
				selectItem(safeIndex);
				return true;
			}

			return false;
		},
	}));

	const grouped = React.useMemo(() => {
		const groups: { label: string | undefined; items: { item: SlashCommandItem; globalIndex: number }[] }[] = [];
		let currentLabel: string | undefined;
		for (let i = 0; i < items.length; i++) {
			const item = items[i];
			if (item.group !== currentLabel || i === 0) {
				currentLabel = item.group;
				groups.push({ label: currentLabel, items: [] });
			}
			groups[groups.length - 1].items.push({ item, globalIndex: i });
		}
		return groups;
	}, [items]);

	return (
		<div className="qp-rich-text-editor__slash" role="listbox">
			{items.length === 0 && (
				<div className="qp-rich-text-editor__slash-empty">No results</div>
			)}
			{grouped.map((group) => (
				<div key={group.label ?? "ungrouped"}>
					{group.label && (
						<div className="qp-rich-text-editor__slash-group" aria-hidden="true">
							{group.label}
						</div>
					)}
					{group.items.map(({ item, globalIndex }) => (
						<button
							key={item.title}
							type="button"
							aria-selected={globalIndex === safeIndex}
							role="option"
							tabIndex={-1}
							className={cn(
								"qp-rich-text-editor__slash-item",
								globalIndex === safeIndex
									? "qp-rich-text-editor__slash-item--active"
									: "",
							)}
							onMouseEnter={() => setSelectedIndex(globalIndex)}
							onMouseDown={(event) => event.preventDefault()}
							onClick={() => selectItem(globalIndex)}
						>
							{item.icon && (
								<span
									className="qp-rich-text-editor__slash-icon"
									aria-hidden="true"
								>
									<Icon icon={item.icon} width={16} height={16} />
								</span>
							)}
							<span className="qp-rich-text-editor__slash-copy">
								<span className="qp-rich-text-editor__slash-title">
									{item.title}
								</span>
								{item.description && (
									<span className="qp-rich-text-editor__slash-description">
										{item.description}
									</span>
								)}
							</span>
						</button>
					))}
				</div>
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
					startOfLine: false,
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
