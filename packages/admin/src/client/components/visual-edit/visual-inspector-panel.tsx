/**
 * VisualInspectorPanel
 *
 * Right-pane router for the Visual Edit Workspace. Reads the current
 * selection from `VisualEditProvider` and renders the corresponding
 * inspector mode: a Document body for `idle`, a single field via
 * `renderField` for `field` / `block-field` / `relation` / `array` /
 * `array-item`, and a block body via `renderBlock` for `block`.
 *
 * `renderField` and `renderBlock` are render-prop hooks so callers can
 * swap in their own implementations; the typical entry point
 * (`VisualEditFormHost`) wires `FieldRenderer` and `BlockInspectorBody`
 * by default. Each rendered body runs inside an `InspectorErrorBoundary`
 * so a misbehaving field component can't unmount the workspace.
 */

"use client";

import { Icon } from "@iconify/react";
import * as React from "react";

import { useTranslation } from "../../i18n/hooks.js";
import { cn } from "../../lib/utils.js";
import { blockValuePath } from "../../preview/block-paths.js";
import { Button } from "../ui/button.js";
import { InspectorErrorBoundary } from "./inspector-error-boundary.js";
import { selectionFieldPath } from "./types.js";
import { useVisualEdit } from "./visual-edit-context.js";

// ============================================================================
// Types
// ============================================================================

export type VisualInspectorPanelProps = {
	/** Custom class name applied to the panel root */
	className?: string;
	/**
	 * Render the Document mode body. Called when `selection.kind === "idle"`.
	 * Typically renders non-visual fields, SEO/meta, slug, status, etc.
	 */
	renderDocument?: () => React.ReactNode;
	/**
	 * Render a single field by form-field path. Called for `field`,
	 * `block-field`, `relation`, `array`, and `array-item` selections.
	 * Falls back to a placeholder when omitted.
	 */
	renderField?: (fieldPath: string) => React.ReactNode;
	/**
	 * Render the body for a whole-block selection. Receives the
	 * `blocksPath` and `blockId` so the consumer can spin up the same
	 * block field renderer used in the inline editor.
	 */
	renderBlock?: (args: {
		blocksPath: string;
		blockId: string;
	}) => React.ReactNode;
};

// ============================================================================
// Component
// ============================================================================

/**
 * Right-pane router for the Visual Edit Workspace. Reads the
 * current `VisualEditSelection` from the surrounding provider
 * and dispatches to the matching render-prop slot:
 *
 * - `idle` → `renderDocument()`
 * - `field` / `relation` / `array` → `renderField(fieldPath)`
 * - `block` → `renderBlock({ blocksPath, blockId })`
 * - `block-field` → `renderField(<blocksPath>._values.<id>.<field>)`
 * - `array-item` → `renderField(<fieldPath>.<index>)`
 *
 * Header shows a kind-aware icon + title and a back-to-document
 * button for non-idle selections. The body is wrapped in
 * `InspectorErrorBoundary` keyed on the selection's resolved
 * field path, so a misbehaving renderer doesn't unmount the
 * workspace.
 *
 * `VisualEditFormHost` passes opinionated defaults for every
 * slot. Use this component directly when you want full control
 * over the inspector body.
 */
export function VisualInspectorPanel({
	className,
	renderDocument,
	renderField,
	renderBlock,
}: VisualInspectorPanelProps) {
	const { t } = useTranslation();
	const { selection, clear } = useVisualEdit();

	const header = React.useMemo(
		() => describeSelection(selection, t),
		[selection, t],
	);

	return (
		<aside
			data-visual-inspector
			className={cn(
				"bg-card border-border-subtle flex h-full min-h-0 w-full flex-col border-l",
				className,
			)}
		>
			{/* Header */}
			<div className="bg-surface-low/80 flex min-h-12 shrink-0 items-center justify-between gap-2 border-b px-4 py-2">
				<div className="flex min-w-0 items-center gap-2.5">
					<span className="bg-surface-mid text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-md">
						<Icon icon={header.icon} className="size-3.5" />
					</span>
					<div className="min-w-0">
						<div className="truncate text-sm font-medium">{header.title}</div>
						{header.subtitle && (
							<div className="text-muted-foreground truncate text-xs">
								{header.subtitle}
							</div>
						)}
					</div>
				</div>

				{selection.kind !== "idle" && (
					<Button
						variant="ghost"
						size="sm"
						onClick={clear}
						className="shrink-0 gap-1.5"
					>
						<Icon icon="ph:arrow-left" className="h-3.5 w-3.5" />
						<span className="text-xs">
							{t("preview.backToDocument", { defaultValue: "Document" })}
						</span>
					</Button>
				)}
			</div>

			{/* Body — wrapped in an error boundary so a misbehaving
			    field component can't unmount the whole workspace.
			    The boundary resets when the user picks a different
			    selection so each target gets a fresh render. */}
			<div className="min-h-0 flex-1 overflow-y-auto">
				<InspectorErrorBoundary
					resetKey={selectionFieldPath(selection) ?? `kind:${selection.kind}`}
				>
					<InspectorBody
						renderDocument={renderDocument}
						renderField={renderField}
						renderBlock={renderBlock}
					/>
				</InspectorErrorBoundary>
			</div>
		</aside>
	);
}

// ============================================================================
// Body switch
// ============================================================================

function InspectorBody({
	renderDocument,
	renderField,
	renderBlock,
}: Pick<
	VisualInspectorPanelProps,
	"renderDocument" | "renderField" | "renderBlock"
>) {
	const { selection } = useVisualEdit();

	switch (selection.kind) {
		case "idle":
			return (
				<div className="p-4">
					{renderDocument ? renderDocument() : <DocumentPlaceholder />}
				</div>
			);

		case "field":
			return (
				<div className="p-4">
					{renderField ? (
						renderField(selection.fieldPath)
					) : (
						<FieldPlaceholder fieldPath={selection.fieldPath} />
					)}
				</div>
			);

		case "block":
			return (
				<div className="p-4">
					{renderBlock ? (
						renderBlock({
							blocksPath: selection.blocksPath,
							blockId: selection.blockId,
						})
					) : (
						<FieldPlaceholder
							fieldPath={blockValuePath(
								selection.blocksPath,
								selection.blockId,
							)}
						/>
					)}
				</div>
			);

		case "block-field": {
			const fullPath = blockValuePath(
				selection.blocksPath,
				selection.blockId,
				selection.fieldPath,
			);
			return (
				<div className="p-4">
					{renderField ? (
						renderField(fullPath)
					) : (
						<FieldPlaceholder fieldPath={fullPath} />
					)}
				</div>
			);
		}

		case "relation":
		case "array":
			return (
				<div className="p-4">
					{renderField ? (
						renderField(selection.fieldPath)
					) : (
						<FieldPlaceholder fieldPath={selection.fieldPath} />
					)}
				</div>
			);

		case "array-item": {
			const fullPath = `${selection.fieldPath}.${selection.index}`;
			return (
				<div className="p-4">
					{renderField ? (
						renderField(fullPath)
					) : (
						<FieldPlaceholder fieldPath={fullPath} />
					)}
				</div>
			);
		}
	}
}

// ============================================================================
// Helpers
// ============================================================================

type SelectionDescriptor = {
	icon: string;
	title: string;
	subtitle?: string;
};

function describeSelection(
	selection: ReturnType<typeof useVisualEdit>["selection"],
	t: ReturnType<typeof useTranslation>["t"],
): SelectionDescriptor {
	switch (selection.kind) {
		case "idle":
			return {
				icon: "ph:file-text",
				title: t("preview.documentInspector", {
					defaultValue: "Document",
				}),
			};
		case "field":
			return {
				icon: "ph:text-aa",
				title: selection.fieldPath,
			};
		case "block":
			return {
				icon: "ph:stack",
				title: t("preview.blockInspector", { defaultValue: "Block" }),
				subtitle: selection.blockId,
			};
		case "block-field":
			return {
				icon: "ph:text-aa",
				title: selection.fieldPath,
				subtitle: selection.blockId,
			};
		case "relation":
			return {
				icon: "ph:link",
				title: selection.fieldPath,
				subtitle: selection.targetCollection,
			};
		case "array":
			return {
				icon: "ph:list-numbers",
				title: selection.fieldPath,
			};
		case "array-item":
			return {
				icon: "ph:list-bullets",
				title: `${selection.fieldPath}[${selection.index}]`,
			};
	}
}

function DocumentPlaceholder() {
	const { t } = useTranslation();
	return (
		<div className="text-muted-foreground space-y-2 py-8 text-center text-sm">
			<Icon icon="ph:cursor-click" className="mx-auto h-8 w-8 opacity-60" />
			<p>
				{t("preview.documentPlaceholder", {
					defaultValue: "Click anything in the preview to start editing.",
				})}
			</p>
		</div>
	);
}

function FieldPlaceholder({ fieldPath }: { fieldPath: string }) {
	return (
		<div className="text-muted-foreground py-8 text-center text-xs">
			<code className="bg-muted rounded px-1 py-0.5">{fieldPath}</code>
		</div>
	);
}
