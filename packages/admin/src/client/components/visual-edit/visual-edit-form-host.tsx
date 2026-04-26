/**
 * VisualEditFormHost
 *
 * High-level glue between `useResourceFormController` and the
 * Visual Edit Workspace primitives. Owns the react-hook-form
 * `FormProvider` so the inspector's rendered fields land on the
 * correct form state, and exposes the controller through context
 * so deeper consumers (Blocks panel, document panel, save toolbar)
 * can read the same instance without prop-drilling.
 *
 * This is intentionally a thin orchestrator — actual field
 * rendering and the document-level layout are delegated to the
 * existing `AutoFormFields` / `FieldRenderer` primitives so the
 * legacy form view and the workspace stay in sync.
 */

"use client";

import * as React from "react";
import { FormProvider } from "react-hook-form";

import type { ComponentRegistry } from "../../builder/index.js";
import { AutoFormFields } from "../../views/collection/auto-form-fields.js";
import { FieldRenderer } from "../../views/collection/field-renderer.js";
import {
	type ResourceFormController,
	type ResourceFormControllerOptions,
	useResourceFormController,
} from "../../views/collection/use-resource-form-controller.js";
import type { PreviewPaneRef } from "../preview/preview-pane.js";
import type { VisualEditSelection } from "./types.js";
import { VisualEditWorkspace } from "./visual-edit-workspace.js";
import { VisualInspectorPanel } from "./visual-inspector-panel.js";

// ============================================================================
// Controller context
// ============================================================================

const VisualEditControllerContext =
	React.createContext<ResourceFormController | null>(null);

/**
 * Read the active `ResourceFormController`. Throws when called
 * outside `VisualEditFormHost` so misuse fails loudly.
 */
export function useVisualEditController(): ResourceFormController {
	const ctx = React.useContext(VisualEditControllerContext);
	if (!ctx) {
		throw new Error(
			"useVisualEditController must be used inside <VisualEditFormHost>",
		);
	}
	return ctx;
}

/**
 * Soft variant — returns `null` if the host isn't mounted. Useful
 * for primitives that opt-in to workspace context but still render
 * inside the legacy form view.
 */
export function useVisualEditControllerOptional(): ResourceFormController | null {
	return React.useContext(VisualEditControllerContext);
}

// ============================================================================
// Host props
// ============================================================================

export type VisualEditFormHostProps = ResourceFormControllerOptions & {
	/** Preview iframe URL (null while loading) */
	previewUrl: string | null;
	/** Allowed origins for preview postMessage validation */
	allowedOrigins?: string[];
	/**
	 * Default `blocksPath` for preview clicks that come without a
	 * fully-scoped path. Forwarded to `VisualEditWorkspace`.
	 */
	defaultBlocksPath?: string;
	/** Component registry passed through to AutoFormFields/FieldRenderer */
	registry?: ComponentRegistry;
	/** Other collection configs — needed when the doc embeds others */
	allCollectionsConfig?: Record<string, unknown>;
	/**
	 * Override the inspector's Document body. Defaults to
	 * `AutoFormFields` rendering the full document layout.
	 */
	renderDocument?: () => React.ReactNode;
	/**
	 * Override the inspector's per-field body. Defaults to
	 * `FieldRenderer` resolving the field by name through the
	 * controller's fields registry.
	 */
	renderField?: (fieldPath: string) => React.ReactNode;
	/**
	 * Override the inspector's whole-block body. Phase 4 plugs the
	 * Blocks panel here; until then a placeholder is shown.
	 */
	renderBlock?: (args: {
		blocksPath: string;
		blockId: string;
	}) => React.ReactNode;
	/** Initial selection — defaults to `{ kind: "idle" }` (Document) */
	initialSelection?: VisualEditSelection;
	/** Selection observer — fires for every `select`/`clear` */
	onSelectionChange?: (selection: VisualEditSelection) => void;
	/** Default inspector size, percentage 0–100 */
	defaultInspectorSize?: number;
	/** Minimum inspector size, percentage 0–100 */
	minInspectorSize?: number;
	/** External preview ref (refresh hooks etc.) */
	previewRef?: React.RefObject<PreviewPaneRef | null>;
	/** Custom class name applied to the workspace root */
	className?: string;
};

// ============================================================================
// Component
// ============================================================================

export function VisualEditFormHost({
	collection,
	id,
	config,
	viewConfig,
	defaultValues,
	previewUrl,
	allowedOrigins,
	defaultBlocksPath,
	registry,
	allCollectionsConfig,
	renderDocument,
	renderField,
	renderBlock,
	initialSelection,
	onSelectionChange,
	defaultInspectorSize,
	minInspectorSize,
	previewRef,
	className,
}: VisualEditFormHostProps) {
	const controller = useResourceFormController({
		collection,
		id,
		config,
		viewConfig,
		defaultValues,
	});

	const defaultRenderDocument = React.useCallback(
		() => (
			<AutoFormFields
				collection={collection as any}
				config={controller.formConfigBridge as any}
				registry={registry}
				allCollectionsConfig={allCollectionsConfig as any}
			/>
		),
		[
			collection,
			controller.formConfigBridge,
			registry,
			allCollectionsConfig,
		],
	);

	const defaultRenderField = React.useCallback(
		(fieldPath: string) => {
			const fieldName = topLevelFieldName(fieldPath);
			const fieldDef = controller.fields[fieldName];
			if (!fieldDef) {
				return <UnknownFieldFallback fieldPath={fieldPath} />;
			}
			return (
				<FieldRenderer
					fieldName={fieldName}
					fieldDef={fieldDef}
					collection={collection}
					registry={registry}
					allCollectionsConfig={allCollectionsConfig as any}
				/>
			);
		},
		[allCollectionsConfig, collection, controller.fields, registry],
	);

	return (
		<VisualEditControllerContext.Provider value={controller}>
			<FormProvider {...controller.form}>
				<VisualEditWorkspace
					previewUrl={previewUrl}
					allowedOrigins={allowedOrigins}
					defaultBlocksPath={defaultBlocksPath}
					initialSelection={initialSelection}
					onSelectionChange={onSelectionChange}
					defaultInspectorSize={defaultInspectorSize}
					minInspectorSize={minInspectorSize}
					previewRef={previewRef}
					className={className}
					renderInspector={() => (
						<VisualInspectorPanel
							renderDocument={renderDocument ?? defaultRenderDocument}
							renderField={renderField ?? defaultRenderField}
							renderBlock={renderBlock}
						/>
					)}
				/>
			</FormProvider>
		</VisualEditControllerContext.Provider>
	);
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Resolve the top-level field name from a form-field path. For
 * non-block / non-array paths the name is the first dot segment;
 * for block paths the inspector currently bottoms out at the
 * block's value root and lets the block renderer take over.
 *
 * Phase 7 keeps this intentionally simple — Phase 6's
 * `visualEdit` field contract will let nested fields supply their
 * own renderer override.
 */
function topLevelFieldName(fieldPath: string): string {
	const dot = fieldPath.indexOf(".");
	return dot < 0 ? fieldPath : fieldPath.slice(0, dot);
}

function UnknownFieldFallback({ fieldPath }: { fieldPath: string }) {
	return (
		<div className="text-muted-foreground py-6 text-center text-xs">
			<p>Field not found in registry:</p>
			<code className="bg-muted mt-1 inline-block rounded px-1.5 py-0.5">
				{fieldPath}
			</code>
		</div>
	);
}
