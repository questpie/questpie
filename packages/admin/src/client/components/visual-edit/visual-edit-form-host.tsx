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
import { ComponentRenderer } from "../component-renderer.js";
import type { PreviewPaneRef } from "../preview/preview-pane.js";
import { BlockInspectorBody } from "./block-inspector-body.js";
import { DocumentInspectorBody } from "./document-inspector-body.js";
import { hasGroupedDocumentMetadata } from "./group-fields.js";
import type { VisualEditSelection } from "./types.js";
import { useFormToPreviewPatcher } from "./use-form-to-preview-patcher.js";
import { useVisualEditPreviewBridge } from "./use-visual-edit-preview-bridge.js";
import { resolveNestedVisualEditMeta } from "./visual-edit-meta.js";
import { VisualEditProvider } from "./visual-edit-context.js";
import { VisualEditWorkspaceContent } from "./visual-edit-workspace.js";
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

/**
 * Top-level Visual Edit Workspace primitive — wraps everything a
 * collection edit page needs to drive the V2 patch protocol:
 *
 * - mounts `useResourceFormController` for the form / mutations
 *   / locking / workflow stage
 * - mounts `FormProvider` so field components inside the inspector
 *   share react-hook-form state
 * - mounts `VisualEditProvider` for selection state + click
 *   routing from the canvas
 * - wires `useVisualEditPreviewBridge` (INIT_SNAPSHOT, COMMIT,
 *   FULL_RESYNC, SELECT_TARGET, iframe-reload re-seed) and
 *   `useFormToPreviewPatcher` (form-change → PATCH_BATCH)
 * - renders `VisualEditWorkspaceContent` with sensible defaults
 *   for `renderDocument` (auto-switches between `AutoFormFields`
 *   and grouped `DocumentInspectorBody` based on field
 *   metadata), `renderField` (FieldRenderer + visualEdit.inspector
 *   override), and `renderBlock` (`BlockInspectorBody`)
 *
 * Most consumers only need to register the view via
 * `.form(({ v }) => v.visualEditForm({...}))` and never touch
 * this component directly. Reach for it when you're hosting the
 * workspace in a custom layout.
 *
 * @see {@link https://questpie.com/docs/workspace/live-preview/visual-edit}
 */
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

	// Auto-switch the document body: any field with explicit
	// `visualEdit.group` flips the default to `DocumentInspectorBody`
	// so projects that have set up grouping metadata get it without
	// extra wiring. Projects that haven't keep `AutoFormFields`,
	// preserving any sections/tabs they configured on the form layout.
	const useGroupedDocumentBody = React.useMemo(
		() =>
			hasGroupedDocumentMetadata({
				fields: controller.fields,
				schema: controller.schema,
			}),
		[controller.fields, controller.schema],
	);

	const defaultRenderDocument = React.useCallback(
		() =>
			useGroupedDocumentBody ? (
				<DocumentInspectorBody
					collection={collection}
					registry={registry}
					allCollectionsConfig={allCollectionsConfig}
				/>
			) : (
				<AutoFormFields
					collection={collection as any}
					config={controller.formConfigBridge as any}
					registry={registry}
					allCollectionsConfig={allCollectionsConfig as any}
				/>
			),
		[
			useGroupedDocumentBody,
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
			// Honour `visualEdit.inspector` overrides — server-defined
			// component reference resolved through the admin component
			// registry. The override receives the same context the
			// default renderer would, plus the resolved field path so a
			// single component can handle nested targets too.
			//
			// `resolveNestedVisualEditMeta` walks `metadata.nestedFields`
			// for object/array/blocks paths so a deeper override (e.g.
			// on `meta.seo.title`) wins over a shallower ancestor.
			const fieldSchema = controller.schema?.fields?.[fieldName];
			const dot = fieldPath.indexOf(".");
			const relativePath = dot < 0 ? "" : fieldPath.slice(dot + 1);
			const inspectorOverride = resolveNestedVisualEditMeta({
				fieldDef,
				fieldSchema: fieldSchema as any,
				relativePath,
			})?.inspector;
			if (inspectorOverride) {
				return (
					<ComponentRenderer
						reference={inspectorOverride}
						additionalProps={{
							fieldName,
							fieldPath,
							collection,
							fieldDef,
							registry,
							allCollectionsConfig,
						}}
						fallback={
							<FieldRenderer
								fieldName={fieldName}
								fieldDef={fieldDef}
								collection={collection}
								registry={registry}
								allCollectionsConfig={allCollectionsConfig as any}
							/>
						}
					/>
				);
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
		[
			allCollectionsConfig,
			collection,
			controller.fields,
			controller.schema,
			registry,
		],
	);

	const defaultRenderBlock = React.useCallback(
		({ blocksPath, blockId }: { blocksPath: string; blockId: string }) => (
			<BlockInspectorBody blocksPath={blocksPath} blockId={blockId} />
		),
		[],
	);

	const fallbackPreviewRef = React.useRef<PreviewPaneRef>(null);
	const effectivePreviewRef = previewRef ?? fallbackPreviewRef;

	// Counter incremented on every PREVIEW_READY the iframe sends.
	// Threaded into the bridge so it can re-seed with current form
	// values whenever the iframe reloads.
	const [readyTick, setReadyTick] = React.useState(0);
	const handlePreviewReady = React.useCallback(() => {
		setReadyTick((value) => value + 1);
	}, []);

	return (
		<VisualEditControllerContext.Provider value={controller}>
			<FormProvider {...controller.form}>
				<VisualEditProvider
					initialSelection={initialSelection}
					onSelectionChange={onSelectionChange}
				>
					<PreviewBridge
						controller={controller}
						previewRef={effectivePreviewRef}
						readyTick={readyTick}
					/>
					<VisualEditWorkspaceContent
						previewUrl={previewUrl}
						allowedOrigins={allowedOrigins}
						defaultBlocksPath={defaultBlocksPath}
						defaultInspectorSize={defaultInspectorSize}
						minInspectorSize={minInspectorSize}
						previewRef={effectivePreviewRef}
						onPreviewReady={handlePreviewReady}
						className={className}
						renderInspector={() => (
							<VisualInspectorPanel
								renderDocument={renderDocument ?? defaultRenderDocument}
								renderField={renderField ?? defaultRenderField}
								renderBlock={renderBlock ?? defaultRenderBlock}
							/>
						)}
					/>
				</VisualEditProvider>
			</FormProvider>
		</VisualEditControllerContext.Provider>
	);
}

/**
 * Null-rendering child that runs the preview bridge AND the
 * form-to-patch dispatcher inside the `VisualEditProvider` (for
 * the bridge's selection access) and inside `FormProvider` (for
 * the patcher's `useFormContext`).
 */
function PreviewBridge({
	controller,
	previewRef,
	readyTick,
}: {
	controller: ResourceFormController;
	previewRef: React.RefObject<PreviewPaneRef | null>;
	readyTick: number;
}) {
	useVisualEditPreviewBridge({ controller, previewRef, readyTick });
	useFormToPreviewPatcher({
		previewRef,
		fields: controller.fields,
		schema: controller.schema,
		baseline: controller.transformedItem as
			| Record<string, unknown>
			| undefined,
		disabled: !controller.isEditMode,
	});
	return null;
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
